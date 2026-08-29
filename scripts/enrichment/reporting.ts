import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { slugify } from "./normalize";
import type { TownEnrichmentReport } from "./types";

export function writeTownReport(
  report: TownEnrichmentReport,
  reportsDir: string,
) {
  const townDir = path.join(reportsDir, slugify(report.town.name));
  mkdirSync(townDir, { recursive: true });

  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(townDir, `${stamp}.json`);
  const markdownPath = path.join(townDir, `${stamp}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const markdown = `# Enrichment Report: ${report.town.name}

- Mode: ${report.mode}
- Generated: ${report.generatedAt}
- Population: ${report.town.population ?? "unknown"}
- Before listings: ${report.before.listings}
- After projected listings: ${report.afterProjected.listings}
- Coverage score before: ${report.before.score}
- Coverage score after: ${report.afterProjected.score}

## Counts

- Source candidates: ${report.counts.sourceCandidates}
- Deduped candidates: ${report.counts.dedupedCandidates}
- New listings: ${report.counts.newListings}
- Matched existing listings: ${report.counts.matchedExisting}
- Records updated: ${report.counts.recordsUpdated}
- Duplicates skipped: ${report.counts.duplicatesSkipped}
- Stale/closed flagged: ${report.counts.staleOrClosedFlagged}

## Sources Used

${report.sourcesUsed.map((entry) => `- ${entry}`).join("\n") || "- None"}

## Sources Skipped

${report.sourcesSkipped.map((entry) => `- ${entry}`).join("\n") || "- None"}

## Weak Categories After Projected Run

${report.afterProjected.weakCategories.map((entry) => `- ${entry}`).join("\n") || "- None"}

## New Listings

${report.newListings
  .map(
    (listing) =>
      `- ${listing.name} (${listing.categorySlug}) from ${listing.sourceName} [confidence ${listing.confidence}]`,
  )
  .join("\n") || "- None"}

## Updated Existing Listings

${report.updates
  .map(
    (update) =>
      `- ${update.businessName}: ${update.reason} [confidence ${update.confidence}]`,
  )
  .join("\n") || "- None"}

## Duplicate Candidates Skipped

${report.duplicates
  .map(
    (duplicate) =>
      `- ${duplicate.name}: ${duplicate.reason} [score ${duplicate.score.toFixed(2)}]`,
  )
  .join("\n") || "- None"}

## Problems Remaining

${report.problemsRemaining.map((entry) => `- ${entry}`).join("\n") || "- None"}

## Notes

${report.notes.map((entry) => `- ${entry}`).join("\n") || "- None"}
`;

  writeFileSync(markdownPath, markdown);

  return {
    json: jsonPath,
    markdown: markdownPath,
  };
}
