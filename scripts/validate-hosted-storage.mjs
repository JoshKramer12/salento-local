import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");
const REQUIRED_TABLES = ["Business", "BusinessSubmission", "User", "_prisma_migrations"];

export class HostedStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HostedStorageError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new HostedStorageError(code, message);
}

export function findMount(mountInfo, mountPath) {
  for (const line of mountInfo.split("\n")) {
    const fields = line.split(" ");
    const separator = fields.indexOf("-");
    if (separator < 0 || fields[4] !== mountPath) continue;

    return {
      options: fields[5]?.split(",") ?? [],
      filesystem: fields[separator + 1],
      source: fields[separator + 2],
    };
  }

  return null;
}

async function existingPath(filePath, kind, code) {
  let stat;
  try {
    stat = await fs.lstat(filePath, { bigint: true });
  } catch {
    fail(code, `${kind} is missing or inaccessible`);
  }

  if (stat.isSymbolicLink() || (await fs.realpath(filePath)) !== filePath) {
    fail("PATH_REDIRECTED", `${kind} must not resolve through a symlink`);
  }

  return stat;
}

async function existingDirectory(filePath, kind, code) {
  const stat = await existingPath(filePath, kind, code);
  if (!stat.isDirectory()) fail(code, `${kind} is not a directory`);

  try {
    await fs.access(filePath, constants.R_OK | constants.W_OK | constants.X_OK);
    const directory = await fs.opendir(filePath);
    await directory.close();
  } catch {
    fail(code, `${kind} is inaccessible`);
  }
}

function sqliteReadOnly(sqliteBinary, databaseFile, query, failureCode) {
  const result = spawnSync(
    sqliteBinary,
    ["-readonly", "-batch", "-noheader", databaseFile, query],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
  );

  if (result.error?.code === "ENOENT") {
    fail("SQLITE_CLI_MISSING", "the read-only SQLite checker is unavailable");
  }
  if (result.error || result.status !== 0) {
    fail(failureCode, "the database failed a read-only SQLite check");
  }

  return result.stdout.trim();
}

export async function validateHostedStorage({
  appRoot,
  dataRoot,
  databaseUrl,
  environment = process.env,
  mountInfo,
  sqliteBinary = "sqlite3",
  prismaPath = path.join(appRoot, "node_modules", ".bin", "prisma"),
}) {
  if (!path.isAbsolute(dataRoot) || path.normalize(dataRoot) !== dataRoot) {
    fail("DATA_ROOT_INVALID", "the persistent data root must be an absolute canonical path");
  }
  for (const name of ["PERSISTENT_ROOT", "APP_DATA_ROOT", "RAILWAY_VOLUME_MOUNT_PATH"]) {
    if (environment[name] && environment[name] !== dataRoot) {
      fail("DATA_ROOT_MISMATCH", `${name} does not match the expected volume mount`);
    }
  }
  if (environment.DATABASE_SCHEMA_SYNC && environment.DATABASE_SCHEMA_SYNC !== "migrate") {
    fail("SCHEMA_SYNC_UNSAFE", "hosted startup requires Prisma migrate deploy");
  }

  const databaseDirectory = path.join(dataRoot, "prisma");
  const databaseFile = path.join(databaseDirectory, "dev.db");
  const uploadsDirectory = path.join(dataRoot, "uploads");
  const submissionsDirectory = path.join(uploadsDirectory, "submissions");
  if (databaseUrl !== `file:${databaseFile}`) {
    fail("DATABASE_URL_MISMATCH", "DATABASE_URL must target the persistent SQLite database");
  }

  const mount = findMount(mountInfo, dataRoot);
  if (!mount || !mount.options.includes("rw") || ["overlay", "tmpfs", "aufs"].includes(mount.filesystem)) {
    fail("VOLUME_NOT_MOUNTED", "the expected writable persistent volume is not mounted");
  }

  await existingDirectory(dataRoot, "persistent volume", "VOLUME_INACCESSIBLE");
  await existingDirectory(databaseDirectory, "database directory", "DB_DIRECTORY_MISSING");
  const databaseStat = await existingPath(databaseFile, "database file", "DB_MISSING");
  if (!databaseStat.isFile() || databaseStat.size === 0n) {
    fail("DB_INVALID_FILE", "the database must be a nonempty regular file");
  }

  let handle;
  try {
    handle = await fs.open(databaseFile, "r");
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || !header.equals(SQLITE_HEADER)) {
      fail("DB_INVALID_SQLITE", "the database does not have a SQLite header");
    }
  } catch (error) {
    if (error instanceof HostedStorageError) throw error;
    fail("DB_UNREADABLE", "the database cannot be opened read-only");
  } finally {
    await handle?.close();
  }

  if (sqliteReadOnly(sqliteBinary, databaseFile, "PRAGMA quick_check(1);", "DB_INTEGRITY_FAILED") !== "ok") {
    fail("DB_INTEGRITY_FAILED", "the database failed SQLite quick_check");
  }
  const tables = sqliteReadOnly(
    sqliteBinary,
    databaseFile,
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
    "DB_SCHEMA_INVALID",
  ).split("\n");
  if (REQUIRED_TABLES.some((table) => !tables.includes(table))) {
    fail("DB_SCHEMA_INVALID", "the database is missing essential application tables");
  }
  const appliedMigrations = sqliteReadOnly(
    sqliteBinary,
    databaseFile,
    'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL;',
    "DB_MIGRATION_HISTORY_INVALID",
  );
  if (!/^\d+$/.test(appliedMigrations) || Number(appliedMigrations) < 1) {
    fail("DB_MIGRATION_HISTORY_INVALID", "the database has no completed migration history");
  }

  await existingDirectory(uploadsDirectory, "uploads directory", "UPLOADS_MISSING");
  await existingDirectory(submissionsDirectory, "submission uploads directory", "UPLOADS_MISSING");

  const publicUploads = path.join(appRoot, "public", "uploads");
  try {
    const stat = await fs.lstat(publicUploads);
    if (!stat.isSymbolicLink() || (await fs.readlink(publicUploads)) !== uploadsDirectory) {
      fail("PUBLIC_UPLOADS_CONFLICT", "public uploads must point to the persistent uploads directory");
    }
  } catch (error) {
    if (error instanceof HostedStorageError) throw error;
    if (error?.code !== "ENOENT") {
      fail("PUBLIC_UPLOADS_CONFLICT", "public uploads cannot be inspected");
    }
  }

  try {
    await fs.access(prismaPath, constants.X_OK);
  } catch {
    fail("PRISMA_MISSING", "the Prisma migration executable is unavailable");
  }

  return `${databaseStat.dev}:${databaseStat.ino}`;
}

async function main() {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataRoot = "/data";
  const databaseUrl = process.env.DATABASE_URL ?? `file:${dataRoot}/prisma/dev.db`;
  const mountInfo = await fs.readFile("/proc/self/mountinfo", "utf8");
  const identity = await validateHostedStorage({
    appRoot,
    dataRoot,
    databaseUrl,
    mountInfo,
  });
  process.stdout.write(`${identity}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const code = error instanceof HostedStorageError ? error.code : "PREFLIGHT_ERROR";
    const message = error instanceof HostedStorageError ? error.message : "the storage check could not complete";
    console.error(`Hosted storage preflight failed [${code}]: ${message}`);
    process.exitCode = 1;
  });
}
