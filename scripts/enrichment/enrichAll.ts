import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { disconnectEnrichmentPrisma, runTownEnrichment } from "./enrichTown";

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
      continue;
    }

    args.set(key, next);
    index += 1;
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const write = args.get("write") === true;
  const limit = Number(args.get("limit") ?? 0);
  const towns = await prisma.town.findMany({
    orderBy: {
      name: "asc",
    },
    select: {
      name: true,
    },
  });

  const selected = limit > 0 ? towns.slice(0, limit) : towns;
  const reports = [];

  for (const town of selected) {
    reports.push(
      await runTownEnrichment({
        townName: town.name,
        dryRun: !write,
        backupOnWrite: false,
        reportsDir: path.join(process.cwd(), "reports", "enrichment"),
      }),
    );
  }

  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        townsProcessed: selected.length,
        reports: reports.map((report) => ({
          town: report.town.name,
          before: report.before.score,
          after: report.afterProjected.score,
          newListings: report.counts.newListings,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectEnrichmentPrisma();
    await prisma.$disconnect();
  });
