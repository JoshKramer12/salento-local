import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export function backupDatabase(projectRoot: string, backupDir: string) {
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const source = path.join(projectRoot, "prisma", "dev.db");
  const destination = path.join(backupDir, `dev-${timestamp}.db`);

  copyFileSync(source, destination);

  return destination;
}
