import { performance } from "node:perf_hooks";

import { PrismaClient } from "@prisma/client";

import { getDirectoryCatalog } from "../../src/lib/public-data";

const prisma = new PrismaClient();

async function measure<T>(name: string, task: () => Promise<T>) {
  const before = process.memoryUsage().rss;
  const started = performance.now();
  const result = await task();
  const elapsedMs = performance.now() - started;
  const after = process.memoryUsage().rss;
  return {
    name,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    rssDeltaMiB: Number(((after - before) / 1024 / 1024).toFixed(1)),
    serializedMiB: Number((Buffer.byteLength(JSON.stringify(result)) / 1024 / 1024).toFixed(2)),
  };
}

async function main() {
  const result = [];
  result.push(await measure("directory-catalog-cold", () => getDirectoryCatalog()));
  result.push(await measure("town-page-current-query", () => prisma.town.findUnique({
    where: { slug: "audit-town-0" },
    include: {
      localities: { include: { _count: { select: { businesses: true } } } },
      businesses: {
        include: { category: true, locality: true, town: true, images: { take: 1, orderBy: { sortOrder: "asc" } }, tags: { include: { tag: true }, take: 6 } },
        orderBy: [{ isFeatured: "desc" }, { reviewCount: "desc" }, { rating: "desc" }, { name: "asc" }],
      },
    },
  })));
  result.push(await measure("locality-page-current-query", () => prisma.locality.findUnique({
    where: { slug: "audit-locality-0" },
    include: {
      town: true,
      businesses: {
        include: { town: true, locality: true, category: true, images: { take: 1, orderBy: { sortOrder: "asc" } } },
        orderBy: [{ isFeatured: "desc" }, { reviewCount: "desc" }, { rating: "desc" }, { name: "asc" }],
      },
    },
  })));
  result.push(await measure("detail-page-current-query", () => prisma.business.findUnique({
    where: { slug: "audit-business-0" },
    include: { category: true, hours: { orderBy: { dayOfWeek: "asc" } }, images: { orderBy: { sortOrder: "asc" } }, locality: true, reviews: { orderBy: { createdAt: "desc" } }, tags: { include: { tag: true } }, town: true },
  })));
  result.push(await measure("admin-users-current-query", () => prisma.user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    include: { accounts: { select: { provider: true } }, claims: { select: { id: true } }, localPartnerProfile: true, ownedBusinesses: { select: { id: true } }, partnerCommissions: { select: { amountCents: true, status: true, type: true } }, partnerPayouts: { select: { amountCents: true, status: true } }, submissions: { select: { amountOwedCents: true, amountPaidCents: true, createdAt: true, createdBusinessId: true, id: true, paymentMethod: true, paymentStatus: true, status: true, updatedAt: true } } },
  })));
  console.log(JSON.stringify(result, null, 2));
}

main().finally(() => prisma.$disconnect());
