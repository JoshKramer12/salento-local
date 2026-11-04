type DraftLike = {
  status: string;
  paymentMethod: string | null;
  paymentStatus: string;
  payLaterInvitation: {
    revokedAt: Date | null;
    declinedAt: Date | null;
    completedAt: Date | null;
  } | null;
};

// Keep this presentation split independent of the persisted draft query and payment transitions.
export function isAwaitingPartnerPayment(submission: DraftLike) {
  const invitation = submission.payLaterInvitation;
  const activeInvitation = Boolean(invitation && !invitation.revokedAt && !invitation.declinedAt && !invitation.completedAt);
  return activeInvitation || submission.status === "AWAITING_PAYMENT" ||
    (submission.paymentMethod !== null && ["PENDING_PAYMENT", "AWAITING_BANK_TRANSFER", "FAILED"].includes(submission.paymentStatus));
}
