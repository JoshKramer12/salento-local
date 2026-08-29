import { SourceReuseStatus, SourceType } from "@prisma/client";

import type { AdapterResult, LoadedTown } from "../types";

type WikidataResponse = {
  entities?: Record<
    string,
    {
      claims?: Record<
        string,
        Array<{
          mainsnak?: {
            datavalue?: {
              value?: unknown;
            };
          };
        }>
      >;
    }
  >;
};

export async function runWikidataAdapter(town: LoadedTown): Promise<AdapterResult> {
  if (!town.wikidataId) {
    return {
      adapterName: "wikidataAdapter",
      sourceChecks: [
        {
          adapter: "wikidataAdapter",
          sourceName: "Wikidata",
          sourceType: SourceType.WIKIDATA,
          reuseStatus: SourceReuseStatus.ALLOWED,
          status: "skipped",
          note: "Town does not currently have a Wikidata identifier.",
        },
      ],
      listings: [],
      notes: [],
    };
  }

  const url =
    "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=" +
    encodeURIComponent(town.wikidataId);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SalentoDirectoryEnrichment/1.0",
    },
  });

  if (!response.ok) {
    return {
      adapterName: "wikidataAdapter",
      sourceChecks: [
        {
          adapter: "wikidataAdapter",
          sourceName: "Wikidata",
          sourceType: SourceType.WIKIDATA,
          sourceUrl: url,
          reuseStatus: SourceReuseStatus.ALLOWED,
          status: "skipped",
          note: `Wikidata request failed with status ${response.status}.`,
        },
      ],
      listings: [],
      notes: [],
    };
  }

  const payload = (await response.json()) as WikidataResponse;
  const claims = payload.entities?.[town.wikidataId]?.claims ?? {};
  const officialWebsiteValue = claims.P856?.[0]?.mainsnak?.datavalue?.value;
  const officialWebsite =
    typeof officialWebsiteValue === "string" ? officialWebsiteValue : undefined;

  return {
    adapterName: "wikidataAdapter",
    sourceChecks: [
      {
        adapter: "wikidataAdapter",
        sourceName: "Wikidata",
        sourceType: SourceType.WIKIDATA,
        sourceUrl: url,
        reuseStatus: SourceReuseStatus.ALLOWED,
        status: "used",
        note: officialWebsite
          ? "Used Wikidata to confirm the municipality's official website."
          : "Checked Wikidata for town metadata; no better official website was discovered.",
      },
    ],
    listings: [],
    notes: [],
    townUpdates: officialWebsite
      ? {
          officialWebsite,
        }
      : undefined,
  };
}
