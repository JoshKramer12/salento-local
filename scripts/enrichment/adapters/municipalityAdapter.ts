import { SourceReuseStatus, SourceType } from "@prisma/client";

import type { AdapterResult, LoadedTown } from "../types";

function guessMunicipalityUrl(town: LoadedTown) {
  if (town.officialWebsite?.includes("comune")) {
    return town.officialWebsite;
  }

  return `https://www.comune.${town.slug}.le.it/`;
}

export async function runMunicipalityAdapter(town: LoadedTown): Promise<AdapterResult> {
  const homepageUrl = guessMunicipalityUrl(town);

  try {
    const homepageResponse = await fetch(homepageUrl, {
      headers: {
        "User-Agent": "SalentoDirectoryEnrichment/1.0",
      },
    });

    if (!homepageResponse.ok) {
      return {
        adapterName: "municipalityAdapter",
        sourceChecks: [
          {
            adapter: "municipalityAdapter",
            sourceName: "Official municipality website",
            sourceType: SourceType.MUNICIPALITY,
            sourceUrl: homepageUrl,
            reuseStatus: SourceReuseStatus.UNKNOWN,
            status: "skipped",
            note: `Official municipality homepage responded with status ${homepageResponse.status}.`,
          },
        ],
        listings: [],
        notes: [],
      };
    }

    const robotsUrl = new URL("/robots.txt", homepageUrl).toString();
    const robotsResponse = await fetch(robotsUrl, {
      headers: {
        "User-Agent": "SalentoDirectoryEnrichment/1.0",
      },
    });

    const robotsReadable = robotsResponse.ok ? "robots.txt available" : "robots.txt unavailable";

    return {
      adapterName: "municipalityAdapter",
      sourceChecks: [
        {
          adapter: "municipalityAdapter",
          sourceName: "Official municipality website",
          sourceType: SourceType.MUNICIPALITY,
          sourceUrl: homepageUrl,
          reuseStatus: SourceReuseStatus.UNKNOWN,
          status: "checked",
          note: `${robotsReadable}; no structured business directory is harvested automatically in this pilot without an explicit reusable listing section.`,
        },
      ],
      listings: [],
      notes: [
        "Municipality websites are checked for safe public context, but not scraped into business records unless they expose a clearly reusable directory.",
      ],
    };
  } catch (error) {
    return {
      adapterName: "municipalityAdapter",
      sourceChecks: [
        {
          adapter: "municipalityAdapter",
          sourceName: "Official municipality website",
          sourceType: SourceType.MUNICIPALITY,
          sourceUrl: homepageUrl,
          reuseStatus: SourceReuseStatus.UNKNOWN,
          status: "skipped",
          note:
            error instanceof Error
              ? `Municipality site check failed: ${error.message}`
              : "Municipality site check failed.",
        },
      ],
      listings: [],
      notes: [],
    };
  }
}
