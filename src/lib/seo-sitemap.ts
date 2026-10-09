import type { PrismaClient } from "@prisma/client";

import { getPublicBusinessMembershipWhere } from "@/lib/business-membership";
import { publicUrl } from "@/lib/seo";

type SitemapDatabase = Pick<PrismaClient, "business" | "locality" | "town">;

export async function buildPublicSitemap(
  database: SitemapDatabase,
  now = new Date(),
): Promise<{ url: string }[]> {
  // Use the same membership boundary as the public Business Page. Likely-closed
  // businesses are omitted from this discovery list, as in directory search.
  const publicBusinessWhere = {
    isLikelyClosed: false,
    ...getPublicBusinessMembershipWhere(now),
  };
  const [towns, localities, businesses] = await Promise.all([
    database.town.findMany({ select: { slug: true }, orderBy: { slug: "asc" } }),
    database.locality.findMany({
      where: { businesses: { some: publicBusinessWhere } },
      select: { slug: true },
      orderBy: { slug: "asc" },
    }),
    database.business.findMany({
      where: publicBusinessWhere,
      select: { slug: true },
      orderBy: { slug: "asc" },
    }),
  ]);

  const paths = [
    "/",
    "/directory",
    "/towns",
    "/localities",
    ...towns.map(({ slug }) => `/towns/${encodeURIComponent(slug)}`),
    ...localities.map(({ slug }) => `/localities/${encodeURIComponent(slug)}`),
    ...businesses.map(({ slug }) => `/businesses/${encodeURIComponent(slug)}`),
  ];

  return paths.map((path) => ({ url: publicUrl(path) }));
}
