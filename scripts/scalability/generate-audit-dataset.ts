import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BATCH_SIZE = 1_000;
const BUSINESS_COUNT = 100_000;
const PARTNER_COUNT = 10_000;
const SUBMISSION_COUNT = 30_000;
const REVIEW_COUNT = 100_000;
const IMAGE_COUNT = 80_000;
const PAYMENT_COUNT = 18_000;
const COMMISSION_COUNT = 18_000;
const PAYOUT_COUNT = 4_000;

function id(prefix: string, index: number) {
  return `audit-${prefix}-${index.toString().padStart(6, "0")}`;
}

function dateBeforeDays(days: number) {
  return new Date(Date.UTC(2026, 7, 27 - (days % 720), (days * 7) % 24, 0, 0));
}

async function insertInBatches<T>(items: T[], insert: (data: T[]) => Promise<unknown>) {
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    await insert(items.slice(start, start + BATCH_SIZE));
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes("scalability-audit")) {
    throw new Error("Refusing to generate data outside the isolated scalability-audit database.");
  }

  const categories = [
    ["restaurants", "Restaurants", "FOOD"], ["cafes", "Cafes", "FOOD"],
    ["bakeries", "Bakeries", "FOOD"], ["wine-bars", "Wine bars", "FOOD"],
    ["services", "Services", "SERVICE"], ["pharmacies", "Pharmacies", "ESSENTIAL"],
    ["wellness", "Wellness", "SERVICE"], ["shops", "Shops", "SHOPPING"],
    ["markets", "Markets", "SHOPPING"], ["hotels", "Hotels", "STAY"],
    ["b-and-b", "Bed and breakfasts", "STAY"], ["beaches", "Beaches", "BEACH"],
    ["museums", "Museums", "TOURISM"], ["tours", "Tours", "TOURISM"],
    ["nightlife", "Nightlife", "TOURISM"], ["transport", "Transport", "SERVICE"],
    ["family", "Family", "TOURISM"], ["artisan", "Artisan", "SHOPPING"],
    ["events", "Events", "TOURISM"], ["outdoors", "Outdoors", "TOURISM"],
  ] as const;

  await prisma.category.createMany({
    data: categories.map(([slug, name, group], index) => ({
      id: id("category", index), slug, name, group, icon: "map-pin", description: `${name} in Salento`, featured: index < 7,
    })),
  });
  await prisma.town.createMany({
    data: Array.from({ length: 120 }, (_, index) => ({
      id: id("town", index), slug: `audit-town-${index}`, name: `Audit Town ${index}`, province: "LE", shortDescription: `Synthetic town ${index}`,
      intro: "Synthetic benchmark data.", history: "Synthetic benchmark data.", practicalInfo: "Synthetic benchmark data.",
      heroImageSeed: `town-${index}`, latitude: 40.0 + index / 10_000, longitude: 18.0 + index / 10_000, featured: index < 12,
    })),
  });
  await prisma.locality.createMany({
    data: Array.from({ length: 360 }, (_, index) => ({
      id: id("locality", index), slug: `audit-locality-${index}`, name: `Audit Locality ${index}`,
      shortDescription: "Synthetic locality.", intro: "Synthetic benchmark data.", practicalInfo: "Synthetic benchmark data.", heroImageSeed: `locality-${index}`,
      latitude: 40.0 + index / 10_000, longitude: 18.0 + index / 10_000, townId: id("town", Math.floor(index / 3)), featured: index < 36,
    })),
  });

  const partners = Array.from({ length: PARTNER_COUNT }, (_, index) => ({
    id: id("partner", index), email: `partner-${index}@audit.invalid`, username: `audit-partner-${index}`, name: `Audit Partner ${index}`,
    passwordHash: "benchmark-only", role: "GETTER" as const, profileCompleted: true, createdAt: dateBeforeDays(index), updatedAt: dateBeforeDays(index),
  }));
  await insertInBatches(partners, (data) => prisma.user.createMany({ data }));
  await insertInBatches(partners, (data) => prisma.localPartnerProfile.createMany({
    data: data.map((partner, index) => ({
      id: `profile-${partner.id}`, userId: partner.id, fullName: partner.name ?? "Audit Partner", legalFullName: partner.name ?? "Audit Partner",
      phone: `+39083${String(index).padStart(7, "0")}`, baseTownOrArea: `Audit Town ${index % 120}`, preferredLanguage: index % 5 ? "it" : "en",
      billingAddress: `${index} Audit Via, Salento`, taxIdOrVatNumber: `AUDIT${String(index).padStart(8, "0")}`,
      understandsNoCash: true, understandsNoPricing: true, understandsNoNegotiation: true, understandsDirectPayment: true,
      completedAt: dateBeforeDays(index), partnerOnboardingCompletedAt: dateBeforeDays(index), stripeAccountStatus: index % 4 === 0 ? "READY" : "NOT_STARTED",
    })),
  }));

  const businesses = Array.from({ length: BUSINESS_COUNT }, (_, index) => {
    const townIndex = index % 120;
    const categoryIndex = (index * 7) % categories.length;
    const localityIndex = townIndex * 3 + (index % 3);
    return {
      id: id("business", index), slug: `audit-business-${index}`, sourceKey: `audit-source-${index}`, externalSource: "AUDIT",
      name: `${categories[categoryIndex][1]} Audit ${index}`, subcategory: index % 3 ? categories[categoryIndex][0] : null,
      shortDescription: `Representative synthetic ${categories[categoryIndex][1].toLowerCase()} listing ${index}.`, description: "Synthetic data used exclusively for scalability testing.",
      address: `${index % 500} Via Audit, Audit Town ${townIndex}`, rating: (index % 41) / 10, reviewCount: index % 20,
      priceLevel: index % 5 || null, isFeatured: index % 97 === 0, isOpenNow: index % 3 === 0,
      verificationStatus: index % 10 === 0 ? "OWNER_VERIFIED" as const : "OPEN_DATA" as const, sourceConfidence: index % 101,
      isLikelyClosed: index % 50 === 0, heroImageSeed: `business-${index}`, latitude: 40 + townIndex / 1000, longitude: 18 + localityIndex / 1000,
      categoryId: id("category", categoryIndex), townId: id("town", townIndex), localityId: index % 17 === 0 ? null : id("locality", localityIndex),
      ownerUserId: index % 5 === 0 ? id("partner", index % PARTNER_COUNT) : null, createdAt: dateBeforeDays(index), updatedAt: dateBeforeDays(index * 3),
    };
  });
  await insertInBatches(businesses, (data) => prisma.business.createMany({ data }));

  await insertInBatches(Array.from({ length: IMAGE_COUNT }, (_, index) => ({
    id: id("image", index), businessId: id("business", index % BUSINESS_COUNT), url: `https://audit.invalid/images/${index}.jpg`, alt: `Audit image ${index}`, sortOrder: index % 4,
  })), (data) => prisma.businessImage.createMany({ data }));
  await insertInBatches(Array.from({ length: REVIEW_COUNT }, (_, index) => ({
    id: id("review", index), businessId: id("business", (index * 13) % BUSINESS_COUNT), authorName: `Reviewer ${index}`, title: `Review ${index}`,
    body: "Synthetic review for database query and detail-page pagination benchmarks.", rating: ((index % 41) + 10) / 10, createdAt: dateBeforeDays(index),
  })), (data) => prisma.review.createMany({ data }));

  const submissions = Array.from({ length: SUBMISSION_COUNT }, (_, index) => ({
    id: id("submission", index), userId: id("partner", index % PARTNER_COUNT), status: index % 6 === 0 ? "DRAFT" as const : index % 4 === 0 ? "PUBLISHED" as const : "PAYMENT_CONFIRMED" as const,
    businessName: `Submitted Audit Business ${index}`, townId: id("town", index % 120), localityId: index % 9 ? id("locality", (index % 120) * 3 + (index % 3)) : null,
    categoryId: id("category", index % categories.length), address: `${index} Audit Via`, googleMapsUrl: "https://maps.example.invalid", phone: "+390830000000",
    whatsapp: "+390830000000", email: `owner-${index}@audit.invalid`, openingHours: "Mon-Sun 09:00-18:00", shortDescription: "Synthetic submission.", longDescription: "Synthetic submission.",
    ownerName: `Owner ${index}`, ownerPhone: "+390830000000", ownerEmail: `owner-${index}@audit.invalid`, paymentMethod: index % 3 === 0 ? "BANK_TRANSFER" as const : "ONLINE" as const,
    paymentStatus: index % 4 === 0 ? "PENDING_PAYMENT" as const : "PAID" as const, createdBusinessId: index % 3 ? id("business", index % BUSINESS_COUNT) : null,
    createdAt: dateBeforeDays(index), updatedAt: dateBeforeDays(index * 2),
  }));
  await insertInBatches(submissions, (data) => prisma.businessSubmission.createMany({ data }));

  const payments = Array.from({ length: PAYMENT_COUNT }, (_, index) => ({
    id: id("payment", index), businessSubmissionId: id("submission", index % SUBMISSION_COUNT), businessId: id("business", index % BUSINESS_COUNT),
    userId: id("partner", index % PARTNER_COUNT), partnerUserId: id("partner", index % PARTNER_COUNT), amountCents: 10000, method: index % 4 ? "STRIPE_CHECKOUT" as const : "BANK_TRANSFER" as const,
    status: "PAID" as const, stripeCheckoutSessionId: `audit-checkout-${index}`, stripePaymentIntentId: `audit-intent-${index}`, paidAt: dateBeforeDays(index), createdAt: dateBeforeDays(index), updatedAt: dateBeforeDays(index),
  }));
  await insertInBatches(payments, (data) => prisma.payment.createMany({ data }));

  await prisma.partnerPayoutRun.createMany({
    data: Array.from({ length: 40 }, (_, index) => ({ id: id("payout-run", index), runKey: `audit-run-${index}`, scheduledFor: dateBeforeDays(index * 14), status: "COMPLETED" as const })),
  });
  const payouts = Array.from({ length: PAYOUT_COUNT }, (_, index) => ({
    id: id("payout", index), payoutRunId: id("payout-run", index % 40), partnerUserId: id("partner", index % PARTNER_COUNT), localPartnerProfileId: `profile-${id("partner", index % PARTNER_COUNT)}`,
    amountCents: 5000 + (index % 5) * 5000, status: "PAID" as const, paidAt: dateBeforeDays(index), initiatedAt: dateBeforeDays(index), stripeTransferId: `audit-transfer-${index}`, stripePayoutId: `audit-payout-${index}`,
  }));
  await insertInBatches(payouts, (data) => prisma.partnerPayout.createMany({ data }));
  await insertInBatches(Array.from({ length: COMMISSION_COUNT }, (_, index) => ({
    id: id("commission", index), partnerUserId: id("partner", index % PARTNER_COUNT), businessSubmissionId: id("submission", index % SUBMISSION_COUNT),
    businessId: id("business", index % BUSINESS_COUNT), paymentId: id("payment", index % PAYMENT_COUNT), payoutId: index % 3 ? id("payout", index % PAYOUT_COUNT) : null,
    amountCents: index % 20 === 0 ? -5000 : 5000, type: index % 20 === 0 ? "REVERSAL" as const : "COMMISSION" as const,
    status: index % 3 === 0 ? "AVAILABLE" as const : index % 3 === 1 ? "PAID" as const : "PENDING" as const, sourceKey: `audit-commission-${index}`,
    earnedAt: dateBeforeDays(index), eligibleAt: dateBeforeDays(index), paidAt: index % 3 === 1 ? dateBeforeDays(index) : null, createdAt: dateBeforeDays(index), updatedAt: dateBeforeDays(index),
  })), (data) => prisma.partnerCommission.createMany({ data }));

  const counts = await Promise.all([
    prisma.user.count(), prisma.business.count(), prisma.businessSubmission.count(), prisma.review.count(), prisma.businessImage.count(), prisma.payment.count(), prisma.partnerCommission.count(), prisma.partnerPayout.count(),
  ]);
  console.log(JSON.stringify({ users: counts[0], businesses: counts[1], submissions: counts[2], reviews: counts[3], images: counts[4], payments: counts[5], commissions: counts[6], payouts: counts[7] }));
}

main().finally(() => prisma.$disconnect());
