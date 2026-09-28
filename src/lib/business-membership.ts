import type { Prisma, PrismaClient } from "@prisma/client";

import { LISTING_OFFER } from "@/lib/listing-offer";

export const BUSINESS_MEMBERSHIP_PERIOD_DAYS = 365;
export const BUSINESS_MEMBERSHIP_GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BusinessMembershipStatus = "ACTIVE" | "GRACE" | "EXPIRED";

export function isBusinessMembershipPublic(params: {
  entitlementRevokedAt?: Date | null;
  graceEndsAt?: Date | null;
  now?: Date;
}) {
  // Imported directory records predate paid memberships and remain public.
  // Once a membership exists, its grace boundary is authoritative.
  if (!params.graceEndsAt) return true;
  if (params.entitlementRevokedAt) return false;
  return (params.now ?? new Date()) < params.graceEndsAt;
}

export function getPublicBusinessMembershipWhere(now = new Date())
  : Prisma.BusinessWhereInput {
  return {
    AND: [
      {
        OR: [
          { membership: { is: null } },
          {
            membership: {
              is: {
                entitlementRevokedAt: null,
                graceEndsAt: { gt: now },
              },
            },
          },
        ],
      },
    ],
  };
}

export function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function getBusinessMembershipStatus(params: {
  currentPeriodEnd: Date;
  entitlementRevokedAt?: Date | null;
  graceEndsAt: Date;
  now?: Date;
}): BusinessMembershipStatus {
  if (params.entitlementRevokedAt) return "EXPIRED";
  const now = params.now ?? new Date();

  if (now < params.currentPeriodEnd) return "ACTIVE";
  if (now < params.graceEndsAt) return "GRACE";
  return "EXPIRED";
}

export function getBusinessMembershipPeriod(params: {
  currentPeriodEnd?: Date | null;
  entitlementRevokedAt?: Date | null;
  graceEndsAt?: Date | null;
  paidAt: Date;
}) {
  const status =
    params.currentPeriodEnd && params.graceEndsAt
      ? getBusinessMembershipStatus({
          currentPeriodEnd: params.currentPeriodEnd,
          entitlementRevokedAt: params.entitlementRevokedAt,
          graceEndsAt: params.graceEndsAt,
          now: params.paidAt,
        })
      : null;
  const currentPeriodStart =
    status === "ACTIVE" || status === "GRACE"
      ? params.currentPeriodEnd!
      : params.paidAt;
  const currentPeriodEnd = addUtcDays(
    currentPeriodStart,
    BUSINESS_MEMBERSHIP_PERIOD_DAYS,
  );

  return {
    currentPeriodEnd,
    currentPeriodStart,
    graceEndsAt: addUtcDays(currentPeriodEnd, BUSINESS_MEMBERSHIP_GRACE_DAYS),
  };
}

type MembershipDb = Prisma.TransactionClient | PrismaClient;

/**
 * Creates the initial, business-scoped membership only after an authoritative
 * payment finalizer has published the submission. The unique businessId and
 * no-op update make webhook delivery and status-sync retries idempotent.
 */
export async function ensureInitialBusinessMembership(params: {
  automaticRenewal?: boolean;
  businessId: string;
  db: MembershipDb;
  paidAt: Date;
  submissionId: string;
  stripeCustomerId?: string | null;
  stripeCancelAtPeriodEnd?: boolean | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: string | null;
}) {
  const submission = await params.db.businessSubmission.findUnique({
    where: { id: params.submissionId },
    select: {
      user: {
        select: {
          id: true,
          role: true,
        },
      },
    },
  });

  if (!submission) return null;

  const period = getBusinessMembershipPeriod({ paidAt: params.paidAt });

  return params.db.businessMembership.upsert({
    where: { businessId: params.businessId },
    create: {
      annualPriceCents: LISTING_OFFER.annualPriceCents,
      automaticRenewal: Boolean(params.automaticRenewal && params.stripeSubscriptionId),
      businessId: params.businessId,
      currentPeriodEnd: period.currentPeriodEnd,
      currentPeriodStart: period.currentPeriodStart,
      graceEndsAt: period.graceEndsAt,
      originatingPartnerUserId:
        submission.user.role === "GETTER" ? submission.user.id : null,
      recurringPaymentReady: Boolean(params.automaticRenewal && params.stripeSubscriptionId),
      stripeCustomerId: params.stripeCustomerId ?? null,
      stripeSubscriptionId: params.stripeSubscriptionId ?? null,
      stripeCancelAtPeriodEnd: Boolean(params.stripeCancelAtPeriodEnd),
      stripeSubscriptionStatus: params.stripeSubscriptionId ? params.stripeSubscriptionStatus ?? "active" : null,
    },
    update: params.stripeSubscriptionId ? {
      automaticRenewal: Boolean(params.automaticRenewal),
      recurringPaymentReady: Boolean(params.automaticRenewal),
      stripeCustomerId: params.stripeCustomerId ?? undefined,
      stripeSubscriptionId: params.stripeSubscriptionId,
      stripeCancelAtPeriodEnd: params.stripeCancelAtPeriodEnd ?? undefined,
      stripeSubscriptionStatus: params.stripeSubscriptionStatus ?? "active",
    } : {},
  });
}
