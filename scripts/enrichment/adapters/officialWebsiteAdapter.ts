import { SourceReuseStatus, SourceType } from "@prisma/client";

import { slugify } from "../normalize";
import type { AdapterResult, LoadedTown } from "../types";

export async function runOfficialWebsiteAdapter(
  town: LoadedTown,
): Promise<AdapterResult> {
  const tourismUrl = `https://m.viaggiareinpuglia.it/en/dettaglio-localita/${slugify(town.name)}`;

  return {
    adapterName: "officialWebsiteAdapter",
    sourceChecks: [
      {
        adapter: "officialWebsiteAdapter",
        sourceName: "Official tourism portal",
        sourceType: SourceType.TOURISM_PORTAL,
        sourceUrl: tourismUrl,
        reuseStatus: SourceReuseStatus.UNKNOWN,
        status: "skipped",
        note: "Checked as a possible lead source, but skipped for storage in this pilot because explicit reusable listing rights were not confirmed.",
      },
      {
        adapter: "officialWebsiteAdapter",
        sourceName: "Chamber of commerce / registry sources",
        sourceType: SourceType.CHAMBER_OF_COMMERCE,
        reuseStatus: SourceReuseStatus.UNKNOWN,
        status: "skipped",
        note: "Skipped until an explicit open-data license or public export source is identified.",
      },
      {
        adapter: "officialWebsiteAdapter",
        sourceName: "Business websites discovered outside open datasets",
        sourceType: SourceType.OFFICIAL_WEBSITE,
        reuseStatus: SourceReuseStatus.LINK_ONLY,
        status: "skipped",
        note: "Automated harvesting from standalone business websites is disabled unless the source is explicitly reusable and allowlisted.",
      },
    ],
    listings: [],
    notes: [
      "This adapter currently documents risky-but-interesting sources so each town report is honest about what was checked and why it was skipped.",
    ],
  };
}
