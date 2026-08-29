export function buildDraftLikeSubmissionWhere(userId: string) {
  return {
    userId,
    OR: [
      {
        status: "DRAFT" as const,
      },
      {
        status: "AWAITING_PAYMENT" as const,
      },
      {
        paymentMethod: {
          not: null,
        },
        paymentStatus: {
          not: "PAID" as const,
        },
        status: {
          not: "PUBLISHED" as const,
        },
      },
    ],
  };
}
