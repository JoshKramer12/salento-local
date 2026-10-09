import type { MetadataRoute } from "next";

import { prisma } from "@/lib/prisma";
import { buildPublicSitemap } from "@/lib/seo-sitemap";

// Membership eligibility changes at the grace boundary without a database
// write, so Next must not cache this metadata route indefinitely.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildPublicSitemap(prisma);
}
