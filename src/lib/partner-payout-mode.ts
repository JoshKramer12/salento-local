/** Weekly remains the default. Launch must explicitly choose one payout mode. */
export function getPartnerPayoutMode() {
  return process.env.PARTNER_PAYOUT_MODE === "cashout" ? "cashout" : "weekly";
}

export function partnerCashoutRequestsEnabled() {
  return process.env.PARTNER_CASHOUT_REQUESTS_ENABLED === "true" && getPartnerPayoutMode() === "cashout";
}
