import path from "node:path";

import { backupDatabase } from "./backup";

const backupPath = backupDatabase(
  process.cwd(),
  path.join(process.cwd(), "reports", "backups"),
);

console.log(
  JSON.stringify(
    {
      backupPath,
    },
    null,
    2,
  ),
);
