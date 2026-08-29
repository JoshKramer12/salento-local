import type {
  Business,
  BusinessSource,
  Category,
  Locality,
  Prisma,
  SourceReuseStatus,
  SourceType,
  Town,
  VerificationStatus,
} from "@prisma/client";

export type LoadedTown = Town & {
  aliases: { name: string; slug: string }[];
  localities: Locality[];
  businesses: Array<
    Business & {
      category: Category;
      locality: Locality | null;
      sources: BusinessSource[];
    }
  >;
};

export type SourceCheck = {
  adapter: string;
  sourceName: string;
  sourceType: SourceType;
  sourceUrl?: string;
  reuseStatus: SourceReuseStatus;
  status: "checked" | "skipped" | "used";
  note: string;
};

export type CandidateListing = {
  sourceType: SourceType;
  sourceName: string;
  sourceUrl: string;
  sourceKey?: string;
  reuseStatus: SourceReuseStatus;
  license?: string;
  name: string;
  categorySlug: string;
  subcategory?: string;
  townName: string;
  localityName?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  website?: string;
  socialLinks?: Prisma.InputJsonValue;
  openingHoursText?: string;
  shortDescription?: string;
  description?: string;
  imageUrl?: string;
  confidence: number;
  verificationStatus: VerificationStatus;
  isLikelyClosed: boolean;
  staleReason?: string;
  rawData?: Prisma.InputJsonValue;
  discoveredAt: string;
};

export type AdapterTownUpdates = {
  imageUrl?: string;
  officialWebsite?: string;
  practicalInfoAppend?: string;
  sourceUrl?: string;
};

export type AdapterResult = {
  adapterName: string;
  sourceChecks: SourceCheck[];
  listings: CandidateListing[];
  notes: string[];
  townUpdates?: AdapterTownUpdates;
};

export type DedupeCandidateMatch = {
  candidate: CandidateListing;
  duplicateOf: CandidateListing;
  score: number;
  reason: string;
};

export type ExistingMatch = {
  candidate: CandidateListing;
  business: LoadedTown["businesses"][number];
  score: number;
  reason: string;
};

export type CoverageCategory = {
  slug: string;
  count: number;
  expected: boolean;
  weak: boolean;
};

export type CoverageSummary = {
  score: number;
  listings: number;
  listingsPer1000: number;
  averageConfidence: number;
  averageFieldCompleteness: number;
  categoryBreadth: number;
  categories: CoverageCategory[];
  weakCategories: string[];
};

export type TownEnrichmentReport = {
  town: {
    name: string;
    slug: string;
    province: string;
    population: number | null;
  };
  mode: "dry-run" | "write";
  generatedAt: string;
  before: CoverageSummary & {
    listings: number;
  };
  afterProjected: CoverageSummary & {
    listings: number;
  };
  counts: {
    sourceCandidates: number;
    dedupedCandidates: number;
    newListings: number;
    matchedExisting: number;
    duplicatesSkipped: number;
    staleOrClosedFlagged: number;
    recordsUpdated: number;
  };
  sourcesChecked: SourceCheck[];
  sourcesUsed: string[];
  sourcesSkipped: string[];
  notes: string[];
  newListings: Array<{
    name: string;
    categorySlug: string;
    sourceName: string;
    sourceUrl: string;
    confidence: number;
  }>;
  updates: Array<{
    businessName: string;
    reason: string;
    confidence: number;
  }>;
  duplicates: Array<{
    name: string;
    reason: string;
    score: number;
  }>;
  problemsRemaining: string[];
  reportPaths?: {
    json: string;
    markdown: string;
  };
};

export type TownRunOptions = {
  dryRun: boolean;
  backupOnWrite: boolean;
  reportsDir: string;
  townName: string;
};
