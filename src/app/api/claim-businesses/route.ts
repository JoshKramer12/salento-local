import { NextRequest, NextResponse } from "next/server";

import { defaultLocale, isLocale } from "@/lib/i18n";
import { getPublicBusinessMembershipWhere } from "@/lib/business-membership";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const localeValue = request.nextUrl.searchParams.get("locale") ?? defaultLocale;
  const locale = isLocale(localeValue) ? localeValue : defaultLocale;

  if (!query) {
    return NextResponse.json({ businesses: [] });
  }

  const businesses = await prisma.business.findMany({
    where: {
      isLikelyClosed: false,
      ...getPublicBusinessMembershipWhere(),
      ownerAccesses: {
        none: {
          userId: { not: null },
        },
      },
      ownerUserId: null,
      OR: [
        { name: { contains: query } },
        { shortDescription: { contains: query } },
        { subcategory: { contains: query } },
        { address: { contains: query } },
        { category: { name: { contains: query } } },
        { town: { name: { contains: query } } },
        { locality: { name: { contains: query } } },
      ],
    },
    include: {
      town: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [
      { isFeatured: "desc" },
      { reviewCount: "desc" },
      { rating: "desc" },
      { name: "asc" },
    ],
    take: 12,
  });

  return NextResponse.json({
    businesses: businesses.map((business) => ({
      id: business.id,
      label: `${business.name} - ${business.town.name}`,
      slug: business.slug,
      subtitle: locale === "it" ? `Comune di ${business.town.name}` : business.town.name,
    })),
  });
}
