#!/usr/bin/env node
// Explicit clean-install path. The hosted startup script never calls this file.
import { existsSync } from "node:fs";
import { copyFile, cp, mkdtemp, readFile, rm, lstat, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prisma = join(root, "node_modules", ".bin", "prisma");
const schema = join(root, "prisma", "schema.prisma");
const baseline = join(root, "prisma", "clean-install", "migrations", "20261012190000_current_schema_baseline", "migration.sql");
const destination = process.argv[2];

if (!destination || !isAbsolute(destination) || process.argv.length !== 3) {
  throw new Error("Usage: npm run db:init-clean -- /absolute/path/to/new.db");
}
const databaseFile = resolve(destination);
if (!existsSync(prisma)) throw new Error("Install dependencies before initializing a database");
try {
  await lstat(databaseFile);
  throw new Error("Refusing to touch an existing database path");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const work = await mkdtemp(join(tmpdir(), "salento-clean-schema-"));
try {
  const generated = spawnSync(prisma, ["migrate", "diff", "--from-empty", "--to-schema-datamodel", schema, "--script"], {
    cwd: root, encoding: "utf8", env: { ...process.env, DATABASE_URL: `file:${databaseFile}` },
  });
  if (generated.status !== 0) throw new Error(generated.stderr || "Unable to generate schema baseline");
  if (generated.stdout.trim() !== (await readFile(baseline, "utf8")).trim()) {
    throw new Error("Clean baseline differs from the current Prisma schema; regenerate and review it first");
  }
  await copyFile(schema, join(work, "schema.prisma"));
  await cp(join(root, "prisma", "clean-install", "migrations"), join(work, "migrations"), { recursive: true });
  // Check again after preparation. Never point Prisma at a pre-existing file.
  try {
    await lstat(databaseFile);
    throw new Error("Database path appeared during preparation; refusing to continue");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Prisma's SQLite migrate engine requires an existing empty file. Exclusive
  // creation closes the time-of-check race and cannot truncate another file.
  const handle = await open(databaseFile, "wx", 0o600);
  await handle.close();
  const result = spawnSync(prisma, ["migrate", "deploy", "--schema", join(work, "schema.prisma")], {
    cwd: root, encoding: "utf8", env: { ...process.env, DATABASE_URL: `file:${databaseFile}` },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Clean migration failed");
  process.stdout.write(result.stdout);
} finally {
  await rm(work, { recursive: true, force: true });
}
