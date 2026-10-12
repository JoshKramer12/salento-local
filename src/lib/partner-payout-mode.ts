/** Weekly remains the default. Launch must explicitly choose one payout mode. */
export function getPartnerPayoutMode() {
  return process.env.PARTNER_PAYOUT_MODE === "cashout" ? "cashout" : "weekly";
}

export function partnerCashoutRequestsEnabled() {
  return process.env.PARTNER_CASHOUT_REQUESTS_ENABLED === "true" && getPartnerPayoutMode() === "cashout";
}

/** Allows settlement of existing dispatches during a payout pause.
 * This never authorizes a new provider payout. Absent/false is disabled. */
export function partnerCashoutReconciliationEnabled() {
  return process.env.PARTNER_CASHOUT_RECONCILIATION_ENABLED === "true";
}
