import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CategoryGroup,
  Prisma,
  PrismaClient,
  VerificationStatus,
} from "@prisma/client";

import { runMunicipalityAdapter } from "./adapters/municipalityAdapter";
import { runOfficialWebsiteAdapter } from "./adapters/officialWebsiteAdapter";
import { runOsmAdapter } from "./adapters/osmAdapter";
import { runWikidataAdapter } from "./adapters/wikidataAdapter";
import { runWikipediaAdapter } from "./adapters/wikipediaAdapter";
import { backupDatabase } from "./backup";
import { summarizeCoverage } from "./coverageReport";
import { dedupeCandidates, matchAgainstExisting } from "./dedupe";
import { normalizeName, slugify } from "./normalize";
import { writeTownReport } from "./reporting";
import type {
  AdapterResult,
  CandidateListing,
  LoadedTown,
  TownEnrichmentReport,
  TownRunOptions,
} from "./types";

const prisma = new PrismaClient();

export async function disconnectEnrichmentPrisma() {
  await prisma.$disconnect();
}

async function loadTown(input: string) {
  const towns = await prisma.town.findMany({
    include: {
      aliases: true,
    },
  });
  const normalized = normalizeName(input);
  const townMatch = towns.find(
    (town) =>
      normalizeName(town.name) === normalized || town.slug === slugify(input),
  );

  const resolvedTownId =
    townMatch?.id ??
    towns.find((town) => town.aliases.some((alias) => normalizeName(alias.name) === normalized))
      ?.id;

  if (!resolvedTownId) {
    return null;
  }

  return prisma.town.findUnique({
    where: {
      id: resolvedTownId,
    },
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
        orderBy: {
          name: "asc",
        },
      },
    },
  }) as Promise<LoadedTown | null>;
}

async function ensureCategories() {
  const existing = await prisma.category.findMany();
  const bySlug = new Map(existing.map((category) => [category.slug, category]));

  if (!bySlug.has("services")) {
    const created = await prisma.category.create({
      data: {
        slug: "services",
        name: "Services",
        icon: "briefcase",
        description: "Everyday practical services, fuel, health, banking, and public-facing useful stops.",
        group: CategoryGroup.SERVICE,
        featured: false,
      },
    });
    bySlug.set(created.slug, created);
  }

  return bySlug;
}

function buildBusinessSlug(name: string, townSlug: string, sourceKey?: string) {
  return slugify(`${name}-${townSlug}-${sourceKey ?? "listing"}`);
}

function buildFieldMask(candidate: CandidateListing) {
  return [
    "name",
    "categorySlug",
    candidate.subcategory ? "subcategory" : null,
    candidate.address ? "address" : null,
    candidate.latitude ? "latitude" : null,
    candidate.longitude ? "longitude" : null,
    candidate.phone ? "phone" : null,
    candidate.email ? "email" : null,
    candidate.website ? "website" : null,
    candidate.socialLinks ? "socialLinks" : null,
    candidate.openingHoursText ? "openingHoursText" : null,
    candidate.imageUrl ? "imageUrl" : null,
    candidate.localityName ? "localityName" : null,
  ].filter(Boolean);
}

function shouldProtectExisting(existing: LoadedTown["businesses"][number]) {
  return (
    existing.verificationStatus === VerificationStatus.OWNER_VERIFIED ||
    existing.verificationStatus === VerificationStatus.COMMUNITY_VERIFIED
  );
}

function chooseVerificationStatus(
  existing: LoadedTown["businesses"][number],
  candidate: CandidateListing,
) {
  if (shouldProtectExisting(existing)) {
    return existing.verificationStatus;
  }

  if (candidate.isLikelyClosed) {
    return VerificationStatus.REPORTED_STALE;
  }

  if (candidate.confidence >= existing.sourceConfidence) {
    return candidate.verificationStatus;
  }

  return existing.verificationStatus;
}

function isGenericCategory(slug: string) {
  return ["shops", "services", "things-to-do"].includes(slug);
}

function buildBusinessUpdateData(
  existing: LoadedTown["businesses"][number],
  candidate: CandidateListing,
  categoryId: string,
  localityId?: string,
) {
  const protect = shouldProtectExisting(existing);
  const data: Prisma.BusinessUpdateInput = {
    lastEnrichedAt: new Date(),
    lastVerifiedAt: new Date(),
    sourceConfidence: Math.max(existing.sourceConfidence, candidate.confidence),
    verificationStatus: chooseVerificationStatus(existing, candidate),
    isLikelyClosed: candidate.isLikelyClosed || existing.isLikelyClosed,
  };
  const reasons: string[] = [];

  if (!existing.subcategory && candidate.subcategory) {
    data.subcategory = candidate.subcategory;
    reasons.push("filled subcategory");
  }

  if ((!existing.phone || existing.phone.trim() === "") && candidate.phone) {
    data.phone = candidate.phone;
    reasons.push("filled phone");
  }

  if ((!existing.email || existing.email.trim() === "") && candidate.email) {
    data.email = candidate.email;
    reasons.push("filled email");
  }

  if ((!existing.website || existing.website.trim() === "") && candidate.website) {
    data.website = candidate.website;
    reasons.push("filled website");
  }

  if ((!existing.socialLinks || Object.keys((existing.socialLinks as object) ?? {}).length === 0) && candidate.socialLinks) {
    data.socialLinks = candidate.socialLinks;
    reasons.push("filled social links");
  }

  if ((!existing.openingHoursText || existing.openingHoursText.trim() === "") && candidate.openingHoursText) {
    data.openingHoursText = candidate.openingHoursText;
    reasons.push("filled opening hours");
  }

  const genericAddress = !existing.address || /, Puglia$/i.test(existing.address);
  if ((genericAddress || !existing.address) && candidate.address) {
    data.address = candidate.address;
    reasons.push("improved address");
  }

  if (protect === false && candidate.categorySlug !== existing.category.slug) {
    if (isGenericCategory(existing.category.slug) && !isGenericCategory(candidate.categorySlug)) {
      data.category = {
        connect: {
          id: categoryId,
        },
      };
      reasons.push(`refined category ${existing.category.slug} -> ${candidate.categorySlug}`);
    }
  }

  if (!existing.localityId && localityId) {
    data.locality = {
      connect: {
        id: localityId,
      },
    };
    reasons.push("linked locality");
  }

  if ((!existing.shortDescription || existing.shortDescription.trim() === "") && candidate.shortDescription) {
    data.shortDescription = candidate.shortDescription;
    reasons.push("filled short description");
  }

  if ((!existing.description || existing.description.trim() === "") && candidate.description) {
    data.description = candidate.description;
    reasons.push("filled description");
  }

  if (!existing.sourceUrl && candidate.sourceUrl) {
    data.sourceUrl = candidate.sourceUrl;
    reasons.push("filled source URL");
  }

  if ((!existing.externalSource || existing.externalSource.trim() === "") && candidate.sourceName) {
    data.externalSource = candidate.sourceName;
  }

  if (candidate.latitude && candidate.longitude && !protect && existing.sourceConfidence < candidate.confidence) {
    data.latitude = candidate.latitude;
    data.longitude = candidate.longitude;
  }

  if (candidate.latitude && candidate.longitude && (!existing.mapsUrl || existing.mapsUrl.trim() === "")) {
    data.mapsUrl = `https://maps.google.com/?q=${candidate.latitude},${candidate.longitude}`;
  }

  return {
    data,
    reasons,
  };
}

async function upsertBusinessSource(
  businessId: string,
  candidate: CandidateListing,
  isPrimary: boolean,
) {
  const existingSource = await prisma.businessSource.findFirst({
    where: {
      businessId,
      sourceType: candidate.sourceType,
      sourceUrl: candidate.sourceUrl,
    },
  });

  if (existingSource) {
    await prisma.businessSource.update({
      where: {
        id: existingSource.id,
      },
      data: {
        sourceKey: candidate.sourceKey,
        license: candidate.license,
        reuseStatus: candidate.reuseStatus,
        confidence: candidate.confidence,
        isPrimary,
        fieldMask: buildFieldMask(candidate) as Prisma.InputJsonValue,
        payload: candidate.rawData,
        lastSeenAt: new Date(),
        lastCheckedAt: new Date(),
      },
    });
    return;
  }

  await prisma.businessSource.create({
    data: {
      businessId,
      sourceType: candidate.sourceType,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      sourceKey: candidate.sourceKey,
      license: candidate.license,
      reuseStatus: candidate.reuseStatus,
      confidence: candidate.confidence,
      isPrimary,
      fieldMask: buildFieldMask(candidate) as Prisma.InputJsonValue,
      payload: candidate.rawData,
    },
  });
}

async function ensureBusinessImage(businessId: string, candidate: CandidateListing) {
  if (!candidate.imageUrl) {
    return;
  }

  const existingImage = await prisma.businessImage.findFirst({
    where: {
      businessId,
      url: candidate.imageUrl,
    },
  });

  if (existingImage) {
    return;
  }

  await prisma.businessImage.create({
    data: {
      businessId,
      url: candidate.imageUrl,
      alt: `${candidate.name} image`,
      sortOrder: 0,
    },
  });
}

function mergeTownUpdates(
  updates: Array<{
    imageUrl?: string;
    officialWebsite?: string;
    practicalInfoAppend?: string;
    sourceUrl?: string;
  }>,
) {
  return updates.reduce(
    (accumulator, update) => ({
      imageUrl: accumulator.imageUrl ?? update.imageUrl,
      officialWebsite: accumulator.officialWebsite ?? update.officialWebsite,
      sourceUrl: accumulator.sourceUrl ?? update.sourceUrl,
      practicalInfoAppend:
        accumulator.practicalInfoAppend ?? update.practicalInfoAppend,
    }),
    {} as {
      imageUrl?: string;
      officialWebsite?: string;
      practicalInfoAppend?: string;
      sourceUrl?: string;
    },
  );
}

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

function buildProjectedTown(
  town: LoadedTown,
  newCandidates: CandidateListing[],
  matches: ReturnType<typeof matchAgainstExisting>["matches"],
) {
  const clonedBusinesses = town.businesses.map((business) => ({ ...business }));

  for (const match of matches) {
    const business = clonedBusinesses.find((entry) => entry.id === match.business.id);
    if (!business) {
      continue;
    }

    business.sourceConfidence = Math.max(business.sourceConfidence, match.candidate.confidence);
    business.verificationStatus = chooseVerificationStatus(business, match.candidate);
    business.isLikelyClosed = business.isLikelyClosed || match.candidate.isLikelyClosed;
    business.phone = business.phone || match.candidate.phone || null;
    business.email = business.email || match.candidate.email || null;
    business.website = business.website || match.candidate.website || null;
    business.openingHoursText =
      business.openingHoursText || match.candidate.openingHoursText || null;
    business.address =
      /, Puglia$/i.test(business.address) && match.candidate.address
        ? match.candidate.address
        : business.address;
  }

  const firstCategoryBySlug = new Map(
    town.businesses.map((business) => [business.category.slug, business.category]),
  );

  for (const candidate of newCandidates.filter((entry) => entry.isLikelyClosed === false)) {
    const category =
      firstCategoryBySlug.get(candidate.categorySlug) ??
      ({
        id: `projected-${candidate.categorySlug}`,
        slug: candidate.categorySlug,
        name: candidate.categorySlug,
        icon: "map",
        description: candidate.categorySlug,
        group: CategoryGroup.SERVICE,
        featured: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as LoadedTown["businesses"][number]["category"]);

    clonedBusinesses.push({
      id: `projected-${candidate.sourceKey ?? slugify(candidate.name)}`,
      slug: buildBusinessSlug(candidate.name, town.slug, candidate.sourceKey),
      sourceKey: candidate.sourceKey ?? null,
      externalSource: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      name: candidate.name,
      subcategory: candidate.subcategory ?? null,
      shortDescription: candidate.shortDescription ?? "",
      description: candidate.description ?? "",
      address: candidate.address ?? `${town.name}, Puglia`,
      phone: candidate.phone ?? null,
      email: candidate.email ?? null,
      website: candidate.website ?? null,
      socialLinks: candidate.socialLinks ?? null,
      openingHoursText: candidate.openingHoursText ?? null,
      rating: 0,
      reviewCount: 0,
      priceLevel: null,
      isFeatured: false,
      isOpenNow: false,
      verificationStatus: candidate.verificationStatus,
      sourceConfidence: candidate.confidence,
      lastVerifiedAt: new Date(),
      lastEnrichedAt: new Date(),
      isLikelyClosed: candidate.isLikelyClosed,
      mapsUrl:
        candidate.latitude && candidate.longitude
          ? `https://maps.google.com/?q=${candidate.latitude},${candidate.longitude}`
          : null,
      heroImageSeed: `${slugify(candidate.name)}-${town.slug}-enriched`,
      latitude: candidate.latitude ?? town.latitude,
      longitude: candidate.longitude ?? town.longitude,
      ownerUserId: null,
      rawTags: candidate.rawData ?? null,
      categoryId: category.id,
      townId: town.id,
      localityId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      category,
      locality: null,
      sources: [],
      images: [],
      hours: [],
      reviews: [],
      feedback: [],
      tags: [],
    } as LoadedTown["businesses"][number]);
  }

  return {
    ...town,
    businesses: clonedBusinesses,
  } as LoadedTown;
}

export async function runTownEnrichment(options: TownRunOptions) {
  const town = await loadTown(options.townName);
  if (!town) {
    throw new Error(`Town not found for "${options.townName}".`);
  }

  const beforeCoverage = summarizeCoverage(town);
  const adapters = [
    runWikidataAdapter,
    runWikipediaAdapter,
    runMunicipalityAdapter,
    runOfficialWebsiteAdapter,
    runOsmAdapter,
  ] as const;

  const adapterResults: AdapterResult[] = [];
  for (const adapter of adapters) {
    adapterResults.push(await adapter(town));
  }

  const sourceChecks = adapterResults.flatMap((result) => result.sourceChecks);
  const sourceCandidates = adapterResults.flatMap((result) => result.listings);
  const townUpdates = mergeTownUpdates(
    adapterResults
      .map((result) => result.townUpdates)
      .filter(
        (
          update,
        ): update is NonNullable<(typeof adapterResults)[number]["townUpdates"]> =>
          Boolean(update),
      ),
  );

  const candidateDedupe = dedupeCandidates(sourceCandidates);
  const existingMatch = matchAgainstExisting(candidateDedupe.accepted, town.businesses);
  const conflictSourceKeys = existingMatch.unmatched
    .map((candidate) => candidate.sourceKey)
    .filter((sourceKey): sourceKey is string => Boolean(sourceKey));
  const globalConflicts = conflictSourceKeys.length
    ? await prisma.business.findMany({
        where: {
          sourceKey: {
            in: conflictSourceKeys,
          },
        },
        include: {
          town: {
            select: {
              name: true,
            },
          },
        },
      })
    : [];
  const globalConflictBySourceKey = new Map(
    globalConflicts
      .filter((business): business is typeof business & { sourceKey: string } => Boolean(business.sourceKey))
      .map((business) => [business.sourceKey, business]),
  );
  const globallyConflictedCandidates = existingMatch.unmatched.filter(
    (candidate) => candidate.sourceKey && globalConflictBySourceKey.has(candidate.sourceKey),
  );
  const newCandidates = existingMatch.unmatched.filter(
    (candidate) =>
      !candidate.isLikelyClosed &&
      !(candidate.sourceKey && globalConflictBySourceKey.has(candidate.sourceKey)),
  );
  const staleCandidates = existingMatch.matches.filter(
    (match) => match.candidate.isLikelyClosed,
  );
  const projectedTown = buildProjectedTown(town, newCandidates, existingMatch.matches);
  const afterProjectedCoverage = summarizeCoverage(projectedTown);

  const report: TownEnrichmentReport = {
    town: {
      name: town.name,
      slug: town.slug,
      province: town.province,
      population: town.population,
    },
    mode: options.dryRun ? "dry-run" : "write",
    generatedAt: new Date().toISOString(),
    before: beforeCoverage,
    afterProjected: afterProjectedCoverage,
    counts: {
      sourceCandidates: sourceCandidates.length,
      dedupedCandidates: candidateDedupe.accepted.length,
      newListings: newCandidates.length,
      matchedExisting: existingMatch.matches.length,
      duplicatesSkipped: candidateDedupe.duplicates.length + globallyConflictedCandidates.length,
      staleOrClosedFlagged: staleCandidates.length,
      recordsUpdated: 0,
    },
    sourcesChecked: sourceChecks,
    sourcesUsed: sourceChecks
      .filter((entry) => entry.status === "used")
      .map((entry) => `${entry.sourceName}: ${entry.note}`),
    sourcesSkipped: sourceChecks
      .filter((entry) => entry.status === "skipped")
      .map((entry) => `${entry.sourceName}: ${entry.note}`),
    notes: adapterResults.flatMap((result) => result.notes),
    newListings: newCandidates.map((candidate) => ({
      name: candidate.name,
      categorySlug: candidate.categorySlug,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      confidence: candidate.confidence,
    })),
    updates: existingMatch.matches.map((match) => ({
      businessName: match.business.name,
      reason: match.reason,
      confidence: match.candidate.confidence,
    })),
    duplicates: candidateDedupe.duplicates.map((duplicate) => ({
      name: duplicate.candidate.name,
      reason: duplicate.reason,
      score: duplicate.score,
    })).concat(
      globallyConflictedCandidates.map((candidate) => ({
        name: candidate.name,
        reason: `Source key already belongs to ${globalConflictBySourceKey.get(candidate.sourceKey ?? "")?.name} in ${globalConflictBySourceKey.get(candidate.sourceKey ?? "")?.town.name}`,
        score: 1,
      })),
    ),
    problemsRemaining: [
      ...afterProjectedCoverage.weakCategories.map(
        (slug) => `Category still weak after projected run: ${slug}`,
      ),
      ...globallyConflictedCandidates.map(
        (candidate) =>
          `Global source-key conflict requires review before creating ${candidate.name}.`,
      ),
      ...(sourceChecks.some((entry) => entry.sourceName.includes("tourism") && entry.status === "skipped")
        ? ["Official tourism portal data remains unmerged pending clearer reuse terms."]
        : []),
      ...(newCandidates.length === 0
        ? ["No safe new listings were found from the approved sources in this pilot run."]
        : []),
    ],
  };

  mkdirSync(options.reportsDir, { recursive: true });

  if (options.dryRun) {
    report.reportPaths = writeTownReport(report, options.reportsDir);
    return report;
  }

  const backupPath = options.backupOnWrite
    ? backupDatabase(process.cwd(), path.join(process.cwd(), "reports", "backups"))
    : null;
  const categories = await ensureCategories();
  const localityByName = new Map(
    town.localities.map((locality) => [normalizeName(locality.name), locality]),
  );
  const existingSlugs = new Set(
    (await prisma.business.findMany({
      select: {
        slug: true,
      },
    })).map((business) => business.slug),
  );

  if (Object.keys(townUpdates).length) {
    await prisma.town.update({
      where: {
        id: town.id,
      },
      data: {
        imageUrl: town.imageUrl ?? townUpdates.imageUrl,
        officialWebsite: town.officialWebsite ?? townUpdates.officialWebsite,
        sourceUrl: town.sourceUrl ?? townUpdates.sourceUrl,
        practicalInfo:
          townUpdates.practicalInfoAppend &&
          !town.practicalInfo.includes(townUpdates.practicalInfoAppend)
            ? `${town.practicalInfo}\n\n${townUpdates.practicalInfoAppend}`
            : undefined,
      },
    });
  }

  let recordsUpdated = 0;

  for (const match of existingMatch.matches) {
    const category = categories.get(match.candidate.categorySlug);
    if (!category) {
      continue;
    }

    const localityId = match.candidate.localityName
      ? localityByName.get(normalizeName(match.candidate.localityName))?.id
      : undefined;
    const update = buildBusinessUpdateData(
      match.business,
      match.candidate,
      category.id,
      localityId,
    );

    await prisma.business.update({
      where: {
        id: match.business.id,
      },
      data: update.data,
    });

    await upsertBusinessSource(match.business.id, match.candidate, false);
    await ensureBusinessImage(match.business.id, match.candidate);
    recordsUpdated += 1;
  }

  for (const candidate of newCandidates) {
    const category = categories.get(candidate.categorySlug);
    if (!category) {
      continue;
    }

    const localityId = candidate.localityName
      ? localityByName.get(normalizeName(candidate.localityName))?.id
      : undefined;
    let slug = buildBusinessSlug(candidate.name, town.slug, candidate.sourceKey);
    while (existingSlugs.has(slug)) {
      slug = `${slug}-${Math.floor(Math.random() * 10000)}`;
    }
    existingSlugs.add(slug);

    const created = await prisma.business.create({
      data: {
        slug,
        sourceKey: candidate.sourceKey,
        externalSource: candidate.sourceName,
        sourceUrl: candidate.sourceUrl,
        name: candidate.name,
        subcategory: candidate.subcategory,
        shortDescription:
          candidate.shortDescription ?? `${candidate.categorySlug} listing`,
        description: candidate.description ?? candidate.shortDescription ?? candidate.name,
        address: candidate.address ?? `${town.name}, Puglia`,
        phone: candidate.phone,
        email: candidate.email,
        website: candidate.website,
        socialLinks: candidate.socialLinks,
        openingHoursText: candidate.openingHoursText,
        verificationStatus: candidate.verificationStatus,
        sourceConfidence: candidate.confidence,
        lastVerifiedAt: new Date(),
        lastEnrichedAt: new Date(),
        isLikelyClosed: false,
        mapsUrl:
          candidate.latitude && candidate.longitude
            ? `https://maps.google.com/?q=${candidate.latitude},${candidate.longitude}`
            : null,
        heroImageSeed: `${slugify(candidate.name)}-${town.slug}-enriched`,
        latitude: candidate.latitude ?? town.latitude,
        longitude: candidate.longitude ?? town.longitude,
        rawTags: candidate.rawData,
        categoryId: category.id,
        townId: town.id,
        localityId,
      },
    });

    await upsertBusinessSource(created.id, candidate, true);
    await ensureBusinessImage(created.id, candidate);
    recordsUpdated += 1;
  }

  const refreshedTown = await loadTown(town.name);
  if (!refreshedTown) {
    throw new Error("Town disappeared after enrichment write.");
  }

  report.before = beforeCoverage;
  report.afterProjected = summarizeCoverage(refreshedTown);
  report.counts.recordsUpdated = recordsUpdated;
  report.notes = [
    ...report.notes,
    backupPath ? `SQLite backup created at ${backupPath}` : "No backup requested.",
  ];
  report.reportPaths = writeTownReport(report, options.reportsDir);

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const townName = String(args.get("town") ?? "");

  if (!townName) {
    throw new Error('Pass a town name with --town "Martano".');
  }

  const write = args.get("write") === true;
  const dryRun = write ? false : true;

  const report = await runTownEnrichment({
    townName,
    dryRun,
    backupOnWrite: true,
    reportsDir: path.join(process.cwd(), "reports", "enrichment"),
  });

  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await disconnectEnrichmentPrisma();
    });
}
