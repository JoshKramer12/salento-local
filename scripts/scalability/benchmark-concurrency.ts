import { performance } from "node:perf_hooks";

import { PrismaClient } from "@prisma/client";

import { getDirectoryPage } from "../../src/lib/public-data";

const prisma = new PrismaClient();

async function runReadBatch(label: string, concurrency: number, task: () => Promise<unknown>) {
  const started = performance.now();
  const results = await Promise.allSettled(Array.from({ length: concurrency }, task));
  const elapsedMs = performance.now() - started;
  return {
    label, concurrency, elapsedMs: Number(elapsedMs.toFixed(1)),
    errors: results.filter((result) => result.status === "rejected").length,
  };
}

async function main() {
  const reads = [];
  for (const concurrency of [1, 5, 10, 20]) {
    reads.push(await runReadBatch("directory-town-category", concurrency, () => getDirectoryPage({ townSlugs: ["audit-town-0"], category: "restaurants" })));
    reads.push(await runReadBatch("directory-partial-search", concurrency, () => getDirectoryPage({ query: "restaurants audit 99" })));
  }
  const writeStarted = performance.now();
  const writeResults = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => prisma.businessSubmission.create({
    data: {
      id: `audit-write-submission-r2-${index}`, userId: "audit-partner-000000", status: "DRAFT", businessName: `Concurrent draft ${index}`,
      townId: "audit-town-000000", localityId: "audit-locality-000000", categoryId: "audit-category-000000", address: "1 Audit Via",
      googleMapsUrl: "https://audit.invalid/maps", phone: "+390830000000", whatsapp: "+390830000000", email: `draft-${index}@audit.invalid`,
      openingHours: "09:00-18:00", shortDescription: "Synthetic write benchmark.", longDescription: "Synthetic write benchmark.", ownerName: "Audit Owner", ownerPhone: "+390830000000", ownerEmail: `draft-${index}@audit.invalid`,
    },
  })));
  const writeElapsedMs = performance.now() - writeStarted;
  const updatesStarted = performance.now();
  const updateResults = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => prisma.businessSubmission.update({
    where: { id: `audit-write-submission-r2-${index}` }, data: { shortDescription: `Updated draft ${index}` },
  })));
  console.log(JSON.stringify({ reads, writes: {
    concurrentCreates: { elapsedMs: Number(writeElapsedMs.toFixed(1)), errors: writeResults.filter((result) => result.status === "rejected").length },
    concurrentUpdates: { elapsedMs: Number((performance.now() - updatesStarted).toFixed(1)), errors: updateResults.filter((result) => result.status === "rejected").length },
  } }, null, 2));
}

main().finally(() => prisma.$disconnect());
