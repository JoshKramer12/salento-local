import type { CategoryGroup, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getPublicBusinessMembershipWhere } from "@/lib/business-membership";
import { homeCategorySlugs } from "@/lib/site";

// Membership eligibility is time-sensitive at the grace boundary. Do not
// retain public discovery results past the request that evaluated it.
const PUBLIC_DATA_REVALIDATE_SECONDS = 0;
const thingsToDoGroups: CategoryGroup[] = ["TOURISM", "BEACH", "STAY"];
const PUBLIC_DATA_REVALIDATE_MS = PUBLIC_DATA_REVALIDATE_SECONDS * 1000;

function createMemoryCache<T>(loader: () => Promise<T>) {
  let cachedValue:
    | {
        expiresAt: number;
        value: T;
      }
    | null = null;
  let pendingPromise: Promise<T> | null = null;

  return async () => {
    const now = Date.now();

    if (cachedValue && cachedValue.expiresAt > now) {
      return cachedValue.value;
    }

    if (!pendingPromise) {
      pendingPromise = loader()
        .then((value) => {
          cachedValue = {
            expiresAt: Date.now() + PUBLIC_DATA_REVALIDATE_MS,
            value,
          };
          return value;
        })
        .finally(() => {
          pendingPromise = null;
        });
    }

    return pendingPromise;
  };
}

const getTownCountMaps = createMemoryCache(
  async () => {
    const [businessCounts, thingsToDoCounts] = await Promise.all([
      prisma.business.groupBy({
        by: ["townId"],
        where: {
          isLikelyClosed: false,
          ...getPublicBusinessMembershipWhere(),
        },
        _count: {
          _all: true,
        },
      }),
      prisma.business.groupBy({
        by: ["townId"],
        where: {
          isLikelyClosed: false,
          ...getPublicBusinessMembershipWhere(),
          category: {
            group: {
              in: thingsToDoGroups,
            },
          },
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    return {
      businessCountByTownId: Object.fromEntries(
        businessCounts.map((item) => [item.townId, item._count._all]),
      ) as Record<string, number>,
        thingsToDoCountByTownId: Object.fromEntries(
        thingsToDoCounts.map((item) => [item.townId, item._count._all]),
      ) as Record<string, number>,
    };
  },
);

const getHomePageDataCached = createMemoryCache(
  async () => {
    const [categories, featuredTowns, featuredBusinesses, featuredLocalities, townCount, localityCount, businessCount, townCounts] =
      await Promise.all([
        prisma.category.findMany({
          where: {
            slug: {
              in: [...homeCategorySlugs],
            },
          },
          select: {
            id: true,
            name: true,
            slug: true,
            _count: {
              select: {
                businesses: { where: getPublicBusinessMembershipWhere() },
              },
            },
          },
        }),
        prisma.town.findMany({
          where: {
            featured: true,
          },
          select: {
            featured: true,
            heroImageSeed: true,
            id: true,
            imageUrl: true,
            name: true,
            province: true,
            shortDescription: true,
            slug: true,
          },
          orderBy: {
            name: "asc",
          },
          take: 6,
        }),
        prisma.business.findMany({
          where: {
            isFeatured: true,
            isLikelyClosed: false,
            ...getPublicBusinessMembershipWhere(),
          },
          select: {
            address: true,
            category: {
              select: {
                group: true,
                id: true,
                name: true,
                slug: true,
              },
            },
            heroImageSeed: true,
            id: true,
            images: {
              select: {
                alt: true,
                url: true,
              },
              orderBy: {
                sortOrder: "asc",
              },
              take: 1,
            },
            locality: {
              select: {
                heroImageSeed: true,
                id: true,
                imageUrl: true,
                name: true,
                slug: true,
              },
            },
            name: true,
            priceLevel: true,
            rating: true,
            reviewCount: true,
            shortDescription: true,
            slug: true,
            town: {
              select: {
                heroImageSeed: true,
                id: true,
                imageUrl: true,
                name: true,
                slug: true,
              },
            },
          },
          orderBy: [{ sourceConfidence: "desc" }, { name: "asc" }],
          take: 6,
        }),
        prisma.locality.findMany({
          where: {
            businesses: {
              some: getPublicBusinessMembershipWhere(),
            },
          },
          select: {
            featured: true,
            heroImageSeed: true,
            id: true,
            imageUrl: true,
            name: true,
            placeType: true,
            shortDescription: true,
            slug: true,
            town: {
              select: {
                heroImageSeed: true,
                imageUrl: true,
                name: true,
                slug: true,
              },
            },
          },
          orderBy: [{ featured: "desc" }, { name: "asc" }],
          take: 16,
        }),
        prisma.town.count(),
        prisma.locality.count(),
        prisma.business.count({ where: getPublicBusinessMembershipWhere() }),
        getTownCountMaps(),
      ]);

    return {
      businessCount,
      categories,
      featuredBusinesses,
      featuredLocalities,
      featuredTowns: featuredTowns.map((town) => ({
        ...town,
        businessCount: townCounts.businessCountByTownId[town.id] ?? 0,
        thingsToDoCount: townCounts.thingsToDoCountByTownId[town.id] ?? 0,
      })),
      localityCount,
      townCount,
    };
  },
);

const getTownsIndexDataCached = createMemoryCache(
  async () => {
    const [towns, localities, townCounts] = await Promise.all([
      prisma.town.findMany({
        select: {
          featured: true,
          heroImageSeed: true,
          id: true,
          imageUrl: true,
          name: true,
          province: true,
          region: true,
          shortDescription: true,
          slug: true,
        },
        orderBy: [{ featured: "desc" }, { name: "asc" }],
      }),
      prisma.locality.findMany({
        select: {
          _count: {
            select: {
              businesses: { where: getPublicBusinessMembershipWhere() },
            },
          },
          featured: true,
          heroImageSeed: true,
          id: true,
          imageUrl: true,
          name: true,
          placeType: true,
          shortDescription: true,
          slug: true,
          town: {
            select: {
              heroImageSeed: true,
              imageUrl: true,
              name: true,
              region: true,
              slug: true,
            },
          },
        },
        where: {
          businesses: {
            some: getPublicBusinessMembershipWhere(),
          },
        },
        orderBy: [{ featured: "desc" }, { name: "asc" }],
      }),
      getTownCountMaps(),
    ]);

    return {
      localities,
      towns: towns.map((town) => ({
        ...town,
        businessCount: townCounts.businessCountByTownId[town.id] ?? 0,
        thingsToDoCount: townCounts.thingsToDoCountByTownId[town.id] ?? 0,
      })),
    };
  },
);

const getLocalitiesIndexDataCached = createMemoryCache(
  async () =>
    prisma.locality.findMany({
      select: {
        _count: {
          select: {
            businesses: { where: getPublicBusinessMembershipWhere() },
          },
        },
        featured: true,
        heroImageSeed: true,
        id: true,
        imageUrl: true,
        name: true,
        placeType: true,
        shortDescription: true,
        slug: true,
        town: {
          select: {
            heroImageSeed: true,
            imageUrl: true,
            name: true,
            region: true,
            slug: true,
          },
        },
      },
      where: {
        businesses: {
          some: getPublicBusinessMembershipWhere(),
        },
      },
      orderBy: [{ featured: "desc" }, { name: "asc" }],
    }),
);

async function loadDirectoryCatalog() {
  const [towns, localities, categories] = await Promise.all([
      prisma.town.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.locality.findMany({
        select: {
          name: true,
          slug: true,
          townId: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.category.findMany({
        select: {
          group: true,
          name: true,
          slug: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
    ]);

  return {
    categories,
    localities,
    towns,
  };
}

type DirectoryCatalog = Awaited<ReturnType<typeof loadDirectoryCatalog>>;

let directoryCatalogCache:
  | {
      expiresAt: number;
      value: DirectoryCatalog;
    }
  | null = null;
let directoryCatalogPromise: Promise<DirectoryCatalog> | null = null;

export async function getHomePageData() {
  return getHomePageDataCached();
}

export async function getTownsIndexData() {
  return getTownsIndexDataCached();
}

export async function getLocalitiesIndexData() {
  return getLocalitiesIndexDataCached();
}

export async function getDirectoryCatalog() {
  const now = Date.now();

  if (directoryCatalogCache && directoryCatalogCache.expiresAt > now) {
    return directoryCatalogCache.value;
  }

  if (!directoryCatalogPromise) {
    directoryCatalogPromise = loadDirectoryCatalog()
      .then((value) => {
        directoryCatalogCache = {
          expiresAt: Date.now() + PUBLIC_DATA_REVALIDATE_MS,
          value,
        };
        return value;
      })
      .finally(() => {
        directoryCatalogPromise = null;
      });
  }

  return directoryCatalogPromise;
}

const directoryPageSize = 24;
const categoryGroups: CategoryGroup[] = [
  "FOOD", "SERVICE", "SHOPPING", "TOURISM", "STAY", "BEACH", "ESSENTIAL",
];

export type DirectoryPageFilters = {
  category?: string;
  locality?: string;
  page?: number;
  query?: string;
  sort?: string;
  townSlugs?: string[];
};

export async function getDirectoryPage(filters: DirectoryPageFilters) {
  const categoryValue = filters.category?.trim() ?? "";
  const group = categoryValue.startsWith("group:")
    ? categoryValue.slice("group:".length) as CategoryGroup
    : null;
  const query = filters.query?.trim() ?? "";
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const townSlugs = (filters.townSlugs ?? []).filter(Boolean).slice(0, 12);
  const where: Prisma.BusinessWhereInput = {
    isLikelyClosed: false,
    ...getPublicBusinessMembershipWhere(),
    ...(townSlugs.length ? { town: { slug: { in: townSlugs } } } : {}),
    ...(filters.locality ? { locality: { slug: filters.locality } } : {}),
    ...(group && categoryGroups.includes(group)
      ? { category: { group } }
      : categoryValue && !group
        ? { category: { slug: categoryValue } }
        : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { shortDescription: { contains: query } },
            { address: { contains: query } },
            { subcategory: { contains: query } },
            { category: { name: { contains: query } } },
            { town: { name: { contains: query } } },
            { locality: { name: { contains: query } } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.BusinessOrderByWithRelationInput[] =
    filters.sort === "alphabetical" ? [{ name: "asc" }]
      : filters.sort === "alphabetical-desc" ? [{ name: "desc" }]
        : filters.sort === "price-asc" ? [{ priceLevel: "asc" }, { name: "asc" }]
          : filters.sort === "price-desc" ? [{ priceLevel: "desc" }, { name: "asc" }]
            : [{ isFeatured: "desc" }, { reviewCount: "desc" }, { rating: "desc" }, { name: "asc" }];
  const select = {
    address: true, category: { select: { group: true, id: true, name: true, slug: true } }, id: true,
    isFeatured: true, isOpenNow: true, locality: { select: { id: true, name: true, slug: true } }, name: true,
    priceLevel: true, rating: true, reviewCount: true, shortDescription: true, slug: true,
    town: { select: { id: true, name: true, slug: true } },
  } satisfies Prisma.BusinessSelect;
  const [total, businesses] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.findMany({ where, select, orderBy, skip: (page - 1) * directoryPageSize, take: directoryPageSize }),
  ]);
  const images = businesses.length ? await prisma.businessImage.findMany({
    where: { businessId: { in: businesses.map((business) => business.id) } },
    select: { alt: true, businessId: true, url: true }, orderBy: [{ businessId: "asc" }, { sortOrder: "asc" }],
  }) : [];
  const firstImageByBusinessId = new Map<string, { alt: string; url: string }>();
  for (const image of images) if (!firstImageByBusinessId.has(image.businessId)) firstImageByBusinessId.set(image.businessId, image);
  return {
    businesses: businesses.map((business) => ({ ...business, images: firstImageByBusinessId.has(business.id) ? [firstImageByBusinessId.get(business.id)!] : [], searchText: "" })),
    page, pageSize: directoryPageSize, total,
  };
}
