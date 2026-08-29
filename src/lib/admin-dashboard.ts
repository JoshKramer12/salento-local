import type {
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SubmissionStatus,
  UserRole,
} from "@prisma/client";

import { isDraftLikeSubmission } from "@/lib/account";
import { prisma } from "@/lib/prisma";

const adminUserOverviewSelect = {
  accounts: {
    select: {
      provider: true,
    },
  },
  claims: {
    select: {
      id: true,
    },
  },
  createdAt: true,
  email: true,
  emailVerified: true,
  id: true,
  image: true,
  localPartnerProfile: {
    select: {
      baseTownOrArea: true,
      billingAddress: true,
      birthDate: true,
      completedAt: true,
      fullName: true,
      heardAbout: true,
      legalFullName: true,
      phone: true,
      preferredLanguage: true,
      stripeAccountStatus: true,
      stripeChargesEnabled: true,
      stripeConnectedAccountId: true,
      stripeCurrentDeadline: true,
      stripeDetailsSubmitted: true,
      stripeDisabledReason: true,
      stripeOnboardingComplete: true,
      stripePayoutAccountLast4: true,
      stripePayoutBankName: true,
      stripePayoutsEnabled: true,
      taxIdOrVatNumber: true,
      updatedAt: true,
      whatsapp: true,
    },
  },
  name: true,
  ownedBusinesses: {
    select: {
      id: true,
    },
  },
  partnerCommissions: {
    select: {
      amountCents: true,
      status: true,
      type: true,
    },
  },
  partnerPayouts: {
    select: {
      amountCents: true,
      status: true,
    },
  },
  passwordHash: true,
  profileCompleted: true,
  role: true,
  submissions: {
    select: {
      amountOwedCents: true,
      amountPaidCents: true,
      createdAt: true,
      createdBusinessId: true,
      id: true,
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      updatedAt: true,
    },
  },
  updatedAt: true,
  username: true,
} satisfies Prisma.UserSelect;

const adminUserDetailSelect = {
  ...adminUserOverviewSelect,
  claims: {
    orderBy: {
      createdAt: "desc",
    },
    select: {
      business: {
        select: {
          name: true,
          slug: true,
        },
      },
      createdAt: true,
      id: true,
      status: true,
    },
  },
  ownedBusinesses: {
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      address: true,
      category: {
        select: {
          name: true,
        },
      },
      id: true,
      name: true,
      shortDescription: true,
      slug: true,
      town: {
        select: {
          name: true,
        },
      },
      updatedAt: true,
    },
  },
  partnerCommissions: {
    orderBy: {
      createdAt: "desc",
    },
    select: {
      amountCents: true,
      business: {
        select: {
          name: true,
          slug: true,
        },
      },
      businessSubmission: {
        select: {
          businessName: true,
          id: true,
        },
      },
      createdAt: true,
      earnedAt: true,
      eligibleAt: true,
      paidAt: true,
      reversedAt: true,
      sourceEventType: true,
      status: true,
      type: true,
    },
  },
  partnerPayouts: {
    orderBy: {
      initiatedAt: "desc",
    },
    select: {
      amountCents: true,
      bankAccountLast4: true,
      bankName: true,
      failureMessage: true,
      id: true,
      initiatedAt: true,
      paidAt: true,
      status: true,
    },
  },
  submissions: {
    orderBy: {
      createdAt: "desc",
    },
    select: {
      amountOwedCents: true,
      amountPaidCents: true,
      bankTransferReference: true,
      businessName: true,
      category: {
        select: {
          name: true,
        },
      },
      createdAt: true,
      createdBusiness: {
        select: {
          slug: true,
        },
      },
      createdBusinessId: true,
      id: true,
      paymentMethod: true,
      paymentStatus: true,
      payments: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          amountCents: true,
          bankTransferReference: true,
          method: true,
          paidAt: true,
          status: true,
        },
        take: 3,
      },
      status: true,
      town: {
        select: {
          name: true,
        },
      },
      updatedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

export type AdminUserOverviewRecord = Prisma.UserGetPayload<{
  select: typeof adminUserOverviewSelect;
}>;

export type AdminUserDetailRecord = Prisma.UserGetPayload<{
  select: typeof adminUserDetailSelect;
}>;

type CommissionSummary = {
  available: number;
  debt: number;
  paid: number;
  pending: number;
  totalEarned: number;
};

type SubmissionSummary = {
  awaitingPayment: number;
  drafts: number;
  liveBusinesses: number;
  listingFeesOutstanding: number;
  listingFeesPaid: number;
  published: number;
  submissions: number;
};

export type AdminUserSummary = {
  claimCount: number;
  commissionSummary: CommissionSummary;
  createdAt: Date;
  displayName: string;
  email: string;
  emailVerified: Date | null;
  hasPassword: boolean;
  hometown: string;
  id: string;
  latestActivityAt: Date;
  linkedProviders: string[];
  phone: string;
  profileCompleted: boolean;
  role: UserRole;
  roleLabel: UserRole;
  stripeAccountStatus: string;
  updatedAt: Date;
  username: string;
  submissionSummary: SubmissionSummary;
};

function normalizeValue(value: string | null | undefined) {
  return value?.trim() || "";
}

function shouldCountAsToBePaid(status: string) {
  return status === "AVAILABLE";
}

function shouldCountAsOutstanding(status: string) {
  return status === "PENDING" || shouldCountAsToBePaid(status);
}

function summarizePartnerCommissions(
  commissions: AdminUserOverviewRecord["partnerCommissions"],
): CommissionSummary {
  return commissions.reduce(
    (summary, commission) => {
      if (commission.type === "COMMISSION" && commission.amountCents > 0) {
        if (commission.status !== "REVERSED") {
          summary.totalEarned += commission.amountCents;
        }
      }

      if (commission.status === "PENDING") {
        summary.pending += commission.amountCents;
      }

      if (shouldCountAsOutstanding(commission.status)) {
        summary.available += commission.amountCents;
      }

      if (commission.status === "PAID") {
        summary.paid += commission.amountCents;
      }

      if (commission.status === "DEBT") {
        summary.debt += Math.abs(commission.amountCents);
      }

      return summary;
    },
    {
      available: 0,
      debt: 0,
      paid: 0,
      pending: 0,
      totalEarned: 0,
    },
  );
}

function summarizeSubmissions(
  submissions: AdminUserOverviewRecord["submissions"],
  ownedBusinessCount: number,
): SubmissionSummary {
  return submissions.reduce(
    (summary, submission) => {
      const draftLike = isDraftLikeSubmission(submission);

      summary.submissions += 1;
      summary.listingFeesPaid += submission.amountPaidCents;

      if (draftLike) {
        summary.drafts += 1;
      }

      if (submission.status === "PUBLISHED") {
        summary.published += 1;
      }

      if (
        submission.paymentMethod &&
        submission.paymentStatus !== "PAID" &&
        submission.status !== "PUBLISHED"
      ) {
        summary.awaitingPayment += 1;
        summary.listingFeesOutstanding += Math.max(
          submission.amountOwedCents - submission.amountPaidCents,
          0,
        );
      }

      return summary;
    },
    {
      awaitingPayment: 0,
      drafts: 0,
      listingFeesOutstanding: 0,
      listingFeesPaid: 0,
      liveBusinesses: ownedBusinessCount,
      published: 0,
      submissions: 0,
    },
  );
}

function getLatestActivityDate(record: AdminUserOverviewRecord) {
  const submissionDates = record.submissions.flatMap((submission) => [
    submission.createdAt,
    submission.updatedAt,
  ]);
  const profileDates = record.localPartnerProfile
    ? [record.localPartnerProfile.updatedAt]
    : [];
  const dates = [record.createdAt, record.updatedAt, ...submissionDates, ...profileDates];

  return dates.reduce((latest, current) => (current > latest ? current : latest), record.createdAt);
}

function getSearchValues(record: AdminUserOverviewRecord) {
  return [
    record.username,
    record.email,
    record.name,
    record.localPartnerProfile?.fullName,
    record.localPartnerProfile?.legalFullName,
    record.localPartnerProfile?.baseTownOrArea,
    record.localPartnerProfile?.phone,
    record.localPartnerProfile?.whatsapp,
  ]
    .map((value) => normalizeValue(value).toLowerCase())
    .filter(Boolean);
}

export function buildAdminUserSummary(record: AdminUserOverviewRecord): AdminUserSummary {
  const hometown = normalizeValue(record.localPartnerProfile?.baseTownOrArea);
  const phone =
    normalizeValue(record.localPartnerProfile?.phone) ||
    normalizeValue(record.localPartnerProfile?.whatsapp);
  const displayName =
    normalizeValue(record.localPartnerProfile?.fullName) ||
    normalizeValue(record.name) ||
    record.username;

  return {
    claimCount: record.claims.length,
    commissionSummary: summarizePartnerCommissions(record.partnerCommissions),
    createdAt: record.createdAt,
    displayName,
    email: record.email,
    emailVerified: record.emailVerified,
    hasPassword: Boolean(record.passwordHash),
    hometown,
    id: record.id,
    latestActivityAt: getLatestActivityDate(record),
    linkedProviders: record.accounts.map((account) => account.provider),
    phone,
    profileCompleted: record.profileCompleted,
    role: record.role,
    roleLabel: record.role,
    stripeAccountStatus: record.localPartnerProfile?.stripeAccountStatus ?? "NOT_STARTED",
    submissionSummary: summarizeSubmissions(record.submissions, record.ownedBusinesses.length),
    updatedAt: record.updatedAt,
    username: record.username,
  };
}

export async function getAdminUserOverviewRecords() {
  return prisma.user.findMany({
    orderBy: [
      {
        role: "asc",
      },
      {
        createdAt: "desc",
      },
    ],
    select: adminUserOverviewSelect,
  });
}

export async function getAdminUserDetailRecord(userId: string) {
  return prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: adminUserDetailSelect,
  });
}

export function filterAdminUserRecords(
  records: AdminUserOverviewRecord[],
  params: {
    query?: string;
    role?: string;
  },
) {
  const normalizedQuery = normalizeValue(params.query).toLowerCase();
  const normalizedRole = normalizeValue(params.role).toUpperCase();

  return records.filter((record) => {
    if (normalizedRole && normalizedRole !== "ALL" && record.role !== normalizedRole) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return getSearchValues(record).some((value) => value.includes(normalizedQuery));
  });
}

export type AdminDashboardHighlights = {
  admins: number;
  approvedClaims: number;
  awaitingPayment: number;
  basicUsers: number;
  businessOwners: number;
  completedProfiles: number;
  drafts: number;
  getters: number;
  listingFeesOutstanding: number;
  listingFeesPaid: number;
  liveBusinesses: number;
  needsReview: number;
  openClaims: number;
  partnerCommissionsDue: number;
  partnerCommissionsPaid: number;
  partnerEarningsTotal: number;
  published: number;
  stripeReadyPartners: number;
  submissions: number;
  totalUsers: number;
  verifiedEmails: number;
};

export type AdminDashboardBreakdownItem = {
  count: number;
  key: string;
};

export type AdminDashboardContributor = {
  feesPaid: number;
  hometown: string;
  id: string;
  latestActivityAt: Date;
  liveBusinesses: number;
  published: number;
  role: UserRole;
  submissions: number;
  username: string;
};

export type AdminDashboardRecentSubmission = {
  businessName: string;
  createdAt: Date;
  id: string;
  paymentStatus: PaymentStatus;
  status: SubmissionStatus;
  townName: string;
  userRole: UserRole;
  username: string;
};

export type AdminDashboardRecentClaim = {
  businessName: string;
  createdAt: Date;
  id: string;
  status: string;
  username: string;
};

export type AdminDashboardRecentUser = {
  createdAt: Date;
  hometown: string;
  id: string;
  role: UserRole;
  source: string;
  submissions: number;
  username: string;
};

export type AdminDashboardData = {
  highlights: AdminDashboardHighlights;
  hometownBreakdown: AdminDashboardBreakdownItem[];
  paymentMethodBreakdown: AdminDashboardBreakdownItem[];
  recentClaims: AdminDashboardRecentClaim[];
  recentSubmissions: AdminDashboardRecentSubmission[];
  recentUsers: AdminDashboardRecentUser[];
  roleBreakdown: AdminDashboardBreakdownItem[];
  sourceBreakdown: AdminDashboardBreakdownItem[];
  submissionStatusBreakdown: AdminDashboardBreakdownItem[];
  topContributors: AdminDashboardContributor[];
};

function incrementBreakdown(
  map: Map<string, number>,
  key: string | null | undefined,
  amount = 1,
) {
  const normalizedKey = normalizeValue(key);

  if (!normalizedKey) {
    return;
  }

  map.set(normalizedKey, (map.get(normalizedKey) ?? 0) + amount);
}

function sortBreakdown(
  map: Map<string, number>,
  limit: number,
): AdminDashboardBreakdownItem[] {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
    .slice(0, limit);
}

const reviewStatuses = new Set<SubmissionStatus>([
  "VERIFIED",
  "PENDING_REVIEW",
  "APPROVED",
  "READY_TO_PUBLISH",
  "NEEDS_REVIEW",
]);

const openClaimStatuses = new Set([
  "REQUESTED",
  "AWAITING_VERIFICATION",
  "MANUAL_REVIEW",
  "VERIFIED",
]);

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const [records, liveBusinesses, claimCounts, recentSubmissions, recentClaims] =
    await Promise.all([
      getAdminUserOverviewRecords(),
      prisma.business.count(),
      prisma.businessClaim.groupBy({
        by: ["status"],
        _count: {
          _all: true,
        },
      }),
      prisma.businessSubmission.findMany({
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          businessName: true,
          createdAt: true,
          id: true,
          paymentStatus: true,
          status: true,
          town: {
            select: {
              name: true,
            },
          },
          user: {
            select: {
              role: true,
              username: true,
            },
          },
        },
        take: 8,
      }),
      prisma.businessClaim.findMany({
        orderBy: {
          createdAt: "desc",
        },
        select: {
          business: {
            select: {
              name: true,
            },
          },
          createdAt: true,
          id: true,
          status: true,
          user: {
            select: {
              username: true,
            },
          },
        },
        take: 8,
      }),
    ]);

  const rows = records.map(buildAdminUserSummary);
  const roleCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const hometownCounts = new Map<string, number>();
  const submissionStatusCounts = new Map<string, number>();
  const paymentMethodCounts = new Map<string, number>();

  const highlights = rows.reduce<AdminDashboardHighlights>(
    (summary, row) => {
      summary.totalUsers += 1;
      summary.submissions += row.submissionSummary.submissions;
      summary.drafts += row.submissionSummary.drafts;
      summary.published += row.submissionSummary.published;
      summary.awaitingPayment += row.submissionSummary.awaitingPayment;
      summary.listingFeesPaid += row.submissionSummary.listingFeesPaid;
      summary.listingFeesOutstanding += row.submissionSummary.listingFeesOutstanding;
      summary.partnerCommissionsDue += row.commissionSummary.available;
      summary.partnerCommissionsPaid += row.commissionSummary.paid;
      summary.partnerEarningsTotal += row.commissionSummary.totalEarned;

      if (row.profileCompleted) {
        summary.completedProfiles += 1;
      }

      if (row.emailVerified) {
        summary.verifiedEmails += 1;
      }

      if (row.role === "ADMIN") {
        summary.admins += 1;
      } else if (row.role === "GETTER") {
        summary.getters += 1;
      } else if (row.role === "BUSINESS_OWNER") {
        summary.businessOwners += 1;
      } else {
        summary.basicUsers += 1;
      }

      if (row.stripeAccountStatus === "READY") {
        summary.stripeReadyPartners += 1;
      }

      incrementBreakdown(roleCounts, row.role);

      return summary;
    },
    {
      admins: 0,
      approvedClaims: 0,
      awaitingPayment: 0,
      basicUsers: 0,
      businessOwners: 0,
      completedProfiles: 0,
      drafts: 0,
      getters: 0,
      listingFeesOutstanding: 0,
      listingFeesPaid: 0,
      liveBusinesses,
      needsReview: 0,
      openClaims: 0,
      partnerCommissionsDue: 0,
      partnerCommissionsPaid: 0,
      partnerEarningsTotal: 0,
      published: 0,
      stripeReadyPartners: 0,
      submissions: 0,
      totalUsers: 0,
      verifiedEmails: 0,
    },
  );

  for (const record of records) {
    incrementBreakdown(sourceCounts, record.localPartnerProfile?.heardAbout);
    incrementBreakdown(hometownCounts, record.localPartnerProfile?.baseTownOrArea);

    for (const submission of record.submissions) {
      incrementBreakdown(submissionStatusCounts, submission.status);

      if (submission.paymentMethod) {
        incrementBreakdown(paymentMethodCounts, submission.paymentMethod satisfies PaymentMethod);
      }

      if (reviewStatuses.has(submission.status)) {
        highlights.needsReview += 1;
      }
    }
  }

  for (const claimCount of claimCounts) {
    if (openClaimStatuses.has(claimCount.status)) {
      highlights.openClaims += claimCount._count._all;
    }

    if (claimCount.status === "APPROVED") {
      highlights.approvedClaims += claimCount._count._all;
    }
  }

  const topContributors = [...rows]
    .sort(
      (left, right) =>
        right.submissionSummary.submissions - left.submissionSummary.submissions ||
        right.submissionSummary.published - left.submissionSummary.published ||
        right.latestActivityAt.getTime() - left.latestActivityAt.getTime(),
    )
    .slice(0, 8)
    .map((row) => ({
      feesPaid: row.submissionSummary.listingFeesPaid,
      hometown: row.hometown,
      id: row.id,
      latestActivityAt: row.latestActivityAt,
      liveBusinesses: row.submissionSummary.liveBusinesses,
      published: row.submissionSummary.published,
      role: row.role,
      submissions: row.submissionSummary.submissions,
      username: row.username,
    }));

  const recentUsers = [...rows]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 8)
    .map((row) => {
      const record = records.find((entry) => entry.id === row.id);

      return {
        createdAt: row.createdAt,
        hometown: row.hometown,
        id: row.id,
        role: row.role,
        source: normalizeValue(record?.localPartnerProfile?.heardAbout),
        submissions: row.submissionSummary.submissions,
        username: row.username,
      };
    });

  return {
    highlights,
    hometownBreakdown: sortBreakdown(hometownCounts, 6),
    paymentMethodBreakdown: sortBreakdown(paymentMethodCounts, 4),
    recentClaims: recentClaims.map((claim) => ({
      businessName: claim.business.name,
      createdAt: claim.createdAt,
      id: claim.id,
      status: claim.status,
      username: claim.user.username,
    })),
    recentSubmissions: recentSubmissions.map((submission) => ({
      businessName: submission.businessName,
      createdAt: submission.createdAt,
      id: submission.id,
      paymentStatus: submission.paymentStatus,
      status: submission.status,
      townName: submission.town.name,
      userRole: submission.user.role,
      username: submission.user.username,
    })),
    recentUsers,
    roleBreakdown: sortBreakdown(roleCounts, 4),
    sourceBreakdown: sortBreakdown(sourceCounts, 6),
    submissionStatusBreakdown: sortBreakdown(submissionStatusCounts, 8),
    topContributors,
  };
}
