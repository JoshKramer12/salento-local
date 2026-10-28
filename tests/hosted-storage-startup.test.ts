import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateHostedStorage } from "../scripts/validate-hosted-storage.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const startupScript = path.join(repositoryRoot, "scripts", "start-hosted.sh");

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function makeFixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "salento-hosted-storage-"));
  const root = await fs.realpath(temporary);
  const appRoot = path.join(root, "app");
  const dataRoot = path.join(root, "data");
  const databaseFile = path.join(dataRoot, "prisma", "dev.db");
  const uploadsDirectory = path.join(dataRoot, "uploads");
  const submissionsDirectory = path.join(uploadsDirectory, "submissions");
  const marker = path.join(uploadsDirectory, ".bootstrap-complete");
  await fs.mkdir(path.dirname(databaseFile), { recursive: true });
  await fs.mkdir(submissionsDirectory, { recursive: true });
  await fs.mkdir(path.join(appRoot, "public"), { recursive: true });
  await fs.writeFile(path.join(submissionsDirectory, "existing-photo.jpg"), "existing upload");

  const sqlite = spawnSync("sqlite3", [databaseFile, `
    CREATE TABLE "Business" (id TEXT PRIMARY KEY);
    CREATE TABLE "BusinessSubmission" (id TEXT PRIMARY KEY);
    CREATE TABLE "User" (id TEXT PRIMARY KEY);
    CREATE TABLE "_prisma_migrations" (migration_name TEXT, finished_at TEXT);
    INSERT INTO "_prisma_migrations" VALUES ('20260622140759_init', '2026-01-01');
  `], { encoding: "utf8" });
  assert.equal(sqlite.status, 0, sqlite.stderr);

  const options = {
    appRoot,
    dataRoot,
    databaseUrl: `file:${databaseFile}`,
    environment: {
      PERSISTENT_ROOT: dataRoot,
      APP_DATA_ROOT: dataRoot,
      RAILWAY_VOLUME_MOUNT_PATH: dataRoot,
    },
    mountInfo: `1 0 8:1 / ${dataRoot} rw,relatime - ext4 /dev/test-volume rw\n`,
    prismaPath: process.execPath,
  };

  return { root, appRoot, dataRoot, databaseFile, uploadsDirectory, submissionsDirectory, marker, options };
}

async function withFixture(callback: (fixture: Fixture) => Promise<void>) {
  const fixture = await makeFixture();
  try {
    await callback(fixture);
  } finally {
    await fs.chmod(fixture.databaseFile, 0o600).catch(() => {});
    await fs.chmod(fixture.uploadsDirectory, 0o700).catch(() => {});
    await fs.chmod(fixture.submissionsDirectory, 0o700).catch(() => {});
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
}

async function checksum(filePath: string) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function expectFailure(fixture: Fixture, code: string, overrides = {}) {
  const originalDatabase = await fs.stat(fixture.databaseFile).then(() => checksum(fixture.databaseFile)).catch(() => null);
  const originalPhoto = await checksum(path.join(fixture.submissionsDirectory, "existing-photo.jpg")).catch(() => null);
  await assert.rejects(
    validateHostedStorage({ ...fixture.options, ...overrides }),
    (error: { code?: string }) => error.code === code,
  );
  const databaseAfter = await fs.stat(fixture.databaseFile).then(() => checksum(fixture.databaseFile)).catch(() => null);
  const photoAfter = await checksum(path.join(fixture.submissionsDirectory, "existing-photo.jpg")).catch(() => null);
  assert.equal(databaseAfter, originalDatabase, "database bytes changed");
  assert.equal(photoAfter, originalPhoto, "an existing upload changed");
  await assert.rejects(fs.access(fixture.marker, constants.F_OK), { code: "ENOENT" });
}

test("valid established storage and migration history pass without changing files", async () => {
  await withFixture(async (fixture) => {
    const before = await checksum(fixture.databaseFile);
    const identity = await validateHostedStorage(fixture.options);
    assert.match(identity, /^\d+:\d+$/);
    assert.equal(await checksum(fixture.databaseFile), before);
    await assert.rejects(fs.access(fixture.marker), { code: "ENOENT" });
  });
});

test("missing volume fails before filesystem changes", async () => {
  await withFixture((fixture) => expectFailure(fixture, "VOLUME_NOT_MOUNTED", { mountInfo: "" }));
});

test("volume mounted at the wrong path fails", async () => {
  await withFixture((fixture) => expectFailure(fixture, "VOLUME_NOT_MOUNTED", {
    mountInfo: `1 0 8:1 / ${fixture.dataRoot}-wrong rw - ext4 /dev/test-volume rw\n`,
  }));
});

test("an ephemeral overlay mounted at the expected path fails", async () => {
  await withFixture((fixture) => expectFailure(fixture, "VOLUME_NOT_MOUNTED", {
    mountInfo: `1 0 8:1 / ${fixture.dataRoot} rw - overlay overlay rw\n`,
  }));
});

test("missing database fails without creating a replacement", async () => {
  await withFixture(async (fixture) => {
    await fs.unlink(fixture.databaseFile);
    await expectFailure(fixture, "DB_MISSING");
    await assert.rejects(fs.access(fixture.databaseFile), { code: "ENOENT" });
  });
});

test("zero-byte database fails without being initialized", async () => {
  await withFixture(async (fixture) => {
    await fs.writeFile(fixture.databaseFile, "");
    await expectFailure(fixture, "DB_INVALID_FILE");
    assert.equal((await fs.stat(fixture.databaseFile)).size, 0);
  });
});

test("invalid SQLite header fails", async () => {
  await withFixture(async (fixture) => {
    await fs.writeFile(fixture.databaseFile, "not a SQLite database");
    await expectFailure(fixture, "DB_INVALID_SQLITE");
  });
});

test("SQLite quick_check rejects a damaged database with a valid header", async () => {
  await withFixture(async (fixture) => {
    const damaged = Buffer.alloc(512);
    Buffer.from("SQLite format 3\0").copy(damaged);
    await fs.writeFile(fixture.databaseFile, damaged);
    await expectFailure(fixture, "DB_INTEGRITY_FAILED");
  });
});

test("unreadable database fails", async () => {
  await withFixture(async (fixture) => {
    await fs.chmod(fixture.databaseFile, 0o000);
    await assert.rejects(validateHostedStorage(fixture.options), { code: "DB_UNREADABLE" });
    await assert.rejects(fs.access(fixture.marker), { code: "ENOENT" });
  });
});

test("database URL outside the volume fails", async () => {
  await withFixture((fixture) => expectFailure(fixture, "DATABASE_URL_MISMATCH", {
    databaseUrl: `file:${fixture.root}/outside.db`,
  }));
});

test("database symlink redirect fails without touching its target", async () => {
  await withFixture(async (fixture) => {
    const target = path.join(fixture.root, "outside.db");
    await fs.rename(fixture.databaseFile, target);
    await fs.symlink(target, fixture.databaseFile);
    const before = await checksum(target);
    await expectFailure(fixture, "PATH_REDIRECTED");
    assert.equal(await checksum(target), before);
  });
});

test("database directory symlink redirect fails", async () => {
  await withFixture(async (fixture) => {
    const target = path.join(fixture.root, "outside-prisma");
    await fs.rename(path.dirname(fixture.databaseFile), target);
    await fs.symlink(target, path.dirname(fixture.databaseFile));
    await expectFailure(fixture, "PATH_REDIRECTED");
  });
});

test("missing uploads fails without recreating the directory", async () => {
  await withFixture(async (fixture) => {
    await fs.rm(fixture.uploadsDirectory, { recursive: true });
    await expectFailure(fixture, "UPLOADS_MISSING");
    await assert.rejects(fs.access(fixture.uploadsDirectory), { code: "ENOENT" });
  });
});

test("unreadable uploads fails", async () => {
  await withFixture(async (fixture) => {
    await fs.chmod(fixture.uploadsDirectory, 0o000);
    await assert.rejects(validateHostedStorage(fixture.options), { code: "UPLOADS_MISSING" });
    await fs.chmod(fixture.uploadsDirectory, 0o700);
    await assert.rejects(fs.access(fixture.marker), { code: "ENOENT" });
  });
});

test("a conflicting public uploads directory is never deleted", async () => {
  await withFixture(async (fixture) => {
    const publicUploads = path.join(fixture.appRoot, "public", "uploads");
    await fs.mkdir(publicUploads);
    await fs.writeFile(path.join(publicUploads, "keep.jpg"), "keep");
    await expectFailure(fixture, "PUBLIC_UPLOADS_CONFLICT");
    assert.equal(await fs.readFile(path.join(publicUploads, "keep.jpg"), "utf8"), "keep");
  });
});

test("missing Prisma executable fails before migration", async () => {
  await withFixture((fixture) => expectFailure(fixture, "PRISMA_MISSING", {
    prismaPath: path.join(fixture.root, "missing-prisma"),
  }));
});

test("missing read-only SQLite checker fails without changing storage", async () => {
  await withFixture((fixture) => expectFailure(fixture, "SQLITE_CLI_MISSING", {
    sqliteBinary: path.join(fixture.root, "missing-sqlite3"),
  }));
});

test("hosted db push setting is rejected", async () => {
  await withFixture((fixture) => expectFailure(fixture, "SCHEMA_SYNC_UNSAFE", {
    environment: { ...fixture.options.environment, DATABASE_SCHEMA_SYNC: "push" },
  }));
});

test("missing migration history fails", async () => {
  await withFixture(async (fixture) => {
    const result = spawnSync("sqlite3", [fixture.databaseFile, 'DELETE FROM "_prisma_migrations";']);
    assert.equal(result.status, 0);
    await expectFailure(fixture, "DB_MIGRATION_HISTORY_INVALID");
  });
});

async function makeStartupHarness() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "salento-startup-shell-")));
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.mkdir(path.join(root, "public"));
  await fs.mkdir(path.join(root, "node_modules", ".bin"), { recursive: true });
  await fs.mkdir(path.join(root, "bin"));
  await fs.copyFile(startupScript, path.join(root, "scripts", "start-hosted.sh"));
  const traceFile = path.join(root, "trace.log");
  await fs.writeFile(path.join(root, "bin", "node"),
    "#!/bin/sh\nprintf 'validate\\n' >> \"$TRACE_FILE\"\nif [ \"${MOCK_PREFLIGHT_EXIT:-0}\" != 0 ]; then exit \"$MOCK_PREFLIGHT_EXIT\"; fi\nif [ \"${MOCK_IDENTITY_CHANGE:-0}\" = 1 ] && [ \"$(grep -c '^validate$' \"$TRACE_FILE\")\" -gt 1 ]; then printf '10:21\\n'; else printf '10:20\\n'; fi\n",
    { mode: 0o755 });
  await fs.writeFile(path.join(root, "node_modules", ".bin", "prisma"),
    "#!/bin/sh\nprintf 'prisma:%s\\n' \"$*\" >> \"$TRACE_FILE\"\nexit \"$MOCK_PRISMA_EXIT\"\n", { mode: 0o755 });
  await fs.writeFile(path.join(root, "node_modules", ".bin", "next"),
    "#!/bin/sh\nprintf 'next:%s\\n' \"$*\" >> \"$TRACE_FILE\"\n", { mode: 0o755 });
  return { root, traceFile };
}

test("a migration failure stops startup without resolve or Next", async () => {
  const harness = await makeStartupHarness();
  try {
    const result = spawnSync("sh", [path.join(harness.root, "scripts", "start-hosted.sh")], {
      encoding: "utf8",
      env: { PATH: `${path.join(harness.root, "bin")}:${process.env.PATH}`, TRACE_FILE: harness.traceFile, MOCK_PRISMA_EXIT: "17" },
    });
    assert.equal(result.status, 17);
    assert.equal(await fs.readFile(harness.traceFile, "utf8"), "validate\nprisma:migrate deploy\n");
    await assert.rejects(fs.access(path.join(harness.root, "public", "uploads", ".bootstrap-complete")), { code: "ENOENT" });
  } finally {
    await fs.rm(harness.root, { recursive: true, force: true });
  }
});

test("a failed preflight stops startup before uploads linking or Prisma", async () => {
  const harness = await makeStartupHarness();
  try {
    const result = spawnSync("sh", [path.join(harness.root, "scripts", "start-hosted.sh")], {
      encoding: "utf8",
      env: {
        PATH: `${path.join(harness.root, "bin")}:${process.env.PATH}`,
        TRACE_FILE: harness.traceFile,
        MOCK_PRISMA_EXIT: "0",
        MOCK_PREFLIGHT_EXIT: "23",
      },
    });
    assert.equal(result.status, 23);
    assert.equal(await fs.readFile(harness.traceFile, "utf8"), "validate\n");
    await assert.rejects(fs.lstat(path.join(harness.root, "public", "uploads")), { code: "ENOENT" });
  } finally {
    await fs.rm(harness.root, { recursive: true, force: true });
  }
});

test("a changed database identity after migration stops before Next", async () => {
  const harness = await makeStartupHarness();
  try {
    const result = spawnSync("sh", [path.join(harness.root, "scripts", "start-hosted.sh")], {
      encoding: "utf8",
      env: {
        PATH: `${path.join(harness.root, "bin")}:${process.env.PATH}`,
        TRACE_FILE: harness.traceFile,
        MOCK_PRISMA_EXIT: "0",
        MOCK_IDENTITY_CHANGE: "1",
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DB_REPLACED/);
    assert.equal(await fs.readFile(harness.traceFile, "utf8"), "validate\nprisma:migrate deploy\nvalidate\n");
  } finally {
    await fs.rm(harness.root, { recursive: true, force: true });
  }
});

test("a valid startup runs deploy before Next and checks identity again", async () => {
  const harness = await makeStartupHarness();
  try {
    const result = spawnSync("sh", [path.join(harness.root, "scripts", "start-hosted.sh")], {
      encoding: "utf8",
      env: { PATH: `${path.join(harness.root, "bin")}:${process.env.PATH}`, TRACE_FILE: harness.traceFile, MOCK_PRISMA_EXIT: "0" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fs.readFile(harness.traceFile, "utf8"), "validate\nprisma:migrate deploy\nvalidate\nnext:start -H 0.0.0.0 -p 3000\n");
  } finally {
    await fs.rm(harness.root, { recursive: true, force: true });
  }
});

test("local development uses Next dev without the hosted startup script", async () => {
  const packageFile = JSON.parse(await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.match(packageFile.scripts.dev, /next dev/);
  assert.doesNotMatch(packageFile.scripts.dev, /start-hosted/);
});
