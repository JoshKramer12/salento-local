import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { summarizeCoverage } from "./coverageReport";
import { slugify } from "./normalize";
import type { LoadedTown } from "./types";

const prisma = new PrismaClient();

async function main() {
  const towns = (await prisma.town.findMany({
    include: {
      aliases: {
        select: {
          name: true,
          slug: true,
        },
      },
      localities: true,
      businesses: {
        include: {
          category: true,
          locality: true,
          sources: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  })) as LoadedTown[];

  const rows = towns.map((town) => {
    const summary = summarizeCoverage(town);
    return {
      town: town.name,
      province: town.province,
      population: town.population,
      ...summary,
    };
  });

  const sorted = [...rows].sort((left, right) => left.score - right.score);
  const reportsDir = path.join(process.cwd(), "reports", "coverage");
  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(reportsDir, `${stamp}.json`);
  const markdownPath = path.join(reportsDir, `${stamp}.md`);

  writeFileSync(jsonPath, JSON.stringify(sorted, null, 2));

  const markdown = `# Town Coverage Report

Generated: ${new Date().toISOString()}

## Weakest Towns

${sorted
  .slice(0, 25)
  .map(
    (row) =>
      `- ${row.town} (${row.province}) score ${row.score}, listings ${row.listings}, weak categories: ${row.weakCategories.join(", ") || "none"}`,
  )
  .join("\n")}
`;
  writeFileSync(markdownPath, markdown);

  console.log(
    JSON.stringify(
      {
        towns: sorted.length,
        weakest: sorted.slice(0, 10).map((row) => ({
          town: row.town,
          score: row.score,
          listings: row.listings,
          weakCategories: row.weakCategories,
        })),
        reportPaths: {
          json: jsonPath,
          markdown: markdownPath,
          slug: slugify(stamp),
        },
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
    await prisma.$disconnect();
  });
