import type { SourceReuseStatus, SourceType } from "@prisma/client";

export type SourcePolicy = {
  adapterName: string;
  sourceName: string;
  sourceType: SourceType;
  reuseStatus: SourceReuseStatus;
  allowedToStore: boolean;
  note: string;
};

export const sourcePolicies: Record<string, SourcePolicy> = {
  osm: {
    adapterName: "osmAdapter",
    sourceName: "OpenStreetMap / Overpass",
    sourceType: "OPENSTREETMAP",
    reuseStatus: "ALLOWED",
    allowedToStore: true,
    note: "Allowed open-data source for structured listings with attribution.",
  },
  wikidata: {
    adapterName: "wikidataAdapter",
    sourceName: "Wikidata",
    sourceType: "WIKIDATA",
    reuseStatus: "ALLOWED",
    allowedToStore: true,
    note: "CC0 structured metadata source.",
  },
  wikipedia: {
    adapterName: "wikipediaAdapter",
    sourceName: "Wikipedia",
    sourceType: "WIKIPEDIA",
    reuseStatus: "ALLOWED",
    allowedToStore: true,
    note: "Allowed for attributed metadata use; avoid copying large text blocks.",
  },
  municipality: {
    adapterName: "municipalityAdapter",
    sourceName: "Official municipality website",
    sourceType: "MUNICIPALITY",
    reuseStatus: "UNKNOWN",
    allowedToStore: false,
    note: "Check for structured public directories; skip if reuse terms or robots position is unclear.",
  },
  officialWebsite: {
    adapterName: "officialWebsiteAdapter",
    sourceName: "Official tourism or business websites",
    sourceType: "OFFICIAL_WEBSITE",
    reuseStatus: "LINK_ONLY",
    allowedToStore: false,
    note: "Link discovery is acceptable, but automated storage is skipped unless the site is explicitly reusable.",
  },
  tourismPortal: {
    adapterName: "officialWebsiteAdapter",
    sourceName: "Official tourism portal",
    sourceType: "TOURISM_PORTAL",
    reuseStatus: "UNKNOWN",
    allowedToStore: false,
    note: "Treat as review-required until the portal exposes clear reuse rights or an open dataset.",
  },
  chamber: {
    adapterName: "officialWebsiteAdapter",
    sourceName: "Chamber of commerce or registry source",
    sourceType: "CHAMBER_OF_COMMERCE",
    reuseStatus: "UNKNOWN",
    allowedToStore: false,
    note: "Skip unless an explicit open-data reuse license is confirmed.",
  },
};
