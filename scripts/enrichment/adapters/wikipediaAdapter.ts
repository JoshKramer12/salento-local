import { SourceReuseStatus, SourceType } from "@prisma/client";

import type { AdapterResult, LoadedTown } from "../types";

type WikipediaSummary = {
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
  extract?: string;
  thumbnail?: {
    source?: string;
  };
  title?: string;
};

export async function runWikipediaAdapter(town: LoadedTown): Promise<AdapterResult> {
  const title = town.wikipediaTitle ?? town.name;
  const url = `https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SalentoDirectoryEnrichment/1.0",
    },
  });

  if (!response.ok) {
    return {
      adapterName: "wikipediaAdapter",
      sourceChecks: [
        {
          adapter: "wikipediaAdapter",
          sourceName: "Wikipedia",
          sourceType: SourceType.WIKIPEDIA,
          sourceUrl: url,
          reuseStatus: SourceReuseStatus.ALLOWED,
          status: "skipped",
          note: `Wikipedia summary request failed with status ${response.status}.`,
        },
      ],
      listings: [],
      notes: [],
    };
  }

  const payload = (await response.json()) as WikipediaSummary;
  const pageUrl = payload.content_urls?.desktop?.page;

  return {
    adapterName: "wikipediaAdapter",
    sourceChecks: [
      {
        adapter: "wikipediaAdapter",
        sourceName: "Wikipedia",
        sourceType: SourceType.WIKIPEDIA,
        sourceUrl: pageUrl ?? url,
        reuseStatus: SourceReuseStatus.ALLOWED,
        status: "used",
        note: "Used Wikipedia to confirm town context and available lead image metadata.",
      },
    ],
    listings: [],
    notes: [],
    townUpdates: {
      imageUrl: payload.thumbnail?.source,
      sourceUrl: pageUrl ?? town.sourceUrl ?? undefined,
    },
  };
}
