import { lstat, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Manual cleanup of generated output in this checkout only. Database files,
// uploads, work evidence, credentials and dependencies are deliberately absent.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [".next", "coverage", "test-results", "playwright-report", "tsconfig.tsbuildinfo"];
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--delete") || args.length > 1) {
  throw new Error("usage: node scripts/cleanup-local-generated.mjs [--delete]");
}
const deleteRequested = args[0] === "--delete";

for (const name of targets) {
  const path = join(root, name);
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    throw new Error(`unexpected target type: ${name}`);
  }
  if (deleteRequested) await rm(path, { recursive: stat.isDirectory() });
  process.stdout.write(`${deleteRequested ? "removed" : "dry-run"}: ${path}\n`);
}
if (!deleteRequested) process.stdout.write("Pass --delete to remove only the listed generated targets.\n");
