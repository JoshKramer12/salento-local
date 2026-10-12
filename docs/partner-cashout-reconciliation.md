# Cash-out reconciliation controls and remaining accounting work

Status: local implementation and mocked-provider tests only. No production migration, provider payout, or bank transfer was performed.

## Modes and authority

`PARTNER_CASHOUT_REQUESTS_ENABLED=true` permits new requests only with `PARTNER_PAYOUT_MODE=cashout`. `PARTNER_CASHOUT_PROCESSING_ENABLED=true` additionally permits Admin dispatch. `PARTNER_CASHOUT_RECONCILIATION_ENABLED=true` independently permits Admin reconciliation of existing withdrawals and the secret-authenticated historical PayPal polling endpoint. All three flags default to disabled. The reconciliation flag does not authorize a new Stripe or PayPal transfer, payout, or weekly run. Signed Stripe Connect webhooks continue to reconcile known payouts independently of these flags. New cash-out payout continuation additionally requires the processing flag, because it creates an external payout from an already recorded transfer.

The historical PayPal monitor is `POST /api/internal/partner-payouts/reconcile`, authenticated with `PAYOUT_JOB_SECRET` as a Bearer token. It polls only existing weekly `PROCESSING` records with a stored `providerBatchId`; it never calls a payout creation API. In cash-out mode, a failed/returned item moves to `ACTION_REQUIRED` while its commissions remain reserved. In weekly mode, the prior release behavior remains. This endpoint is not configured on Railway by this change.

Cookie-authenticated withdrawal POST routes require an explicit same-origin `Origin` header. The secret-authenticated internal polling route and signed provider webhooks use their existing non-cookie authentication mechanisms.

## Stripe

For new dispatches, `stripeTransferRecordedAt` is written only after the transfer creation response and local transfer reference are recorded. `payoutDispatchStartedAt` is written before the first payout creation call. A timeout after that marker can be reconciled by querying Stripe but cannot trigger a second payout creation. Existing historical rows retain NULL markers and cannot use the continuation action.

The Admin **Continue existing Stripe payout** action is available only for a new, recorded transfer with no payout attempt marker. The server retrieves the transfer and connected account, checks amount, currency, destination, transfer group, metadata, reversal state, and payout eligibility, and rejects ambiguous payout listings. It rechecks reservation, debt, refund, dispute, and payment attribution in a transaction, durably claims the payout attempt, then uses the original request-based payout idempotency key. A crash after the claim leaves the request blocked for reconciliation. The action never creates a second transfer.

A provider-reported failed/canceled payout remains `FAILED` with its commissions reserved. If later authoritative provider status conflicts with the local terminal state, the conflict is recorded once in the audit trail and shown for review; the terminal financial status is not silently overwritten.

## PayPal

The deterministic `sender_batch_id` is recorded before the API call. If the response times out without a batch ID, the request remains held. An Admin can attach a batch ID found in PayPal records only when the current provider response matches the batch ID, sender batch ID, single recipient, item ID, amount in cents, and currency. Ordinary reconciliation checks the same attribution before applying a provider status. The attachment action is read-only toward PayPal and does not resend funds. If the batch cannot be found or attribution is incomplete, the hold remains for manual investigation. PayPal documents duplicate protection for a sender batch ID within 30 days; this code does not use a new identifier or automatically retry a timed-out payout. See [PayPal Payouts documentation](https://developer.paypal.com/docs/payouts/standard/integrate-api/customize/).

Historical weekly PayPal payouts can be monitored in cash-out mode through the separate endpoint above. The provider batch ID, sender batch ID, item ID, amount, currency, and item count must match the recorded payout before a result is applied. Missing or mismatched attribution moves the payout to `ACTION_REQUIRED` and keeps its commissions reserved. Failed historical items also remain reserved in cash-out mode pending financial review. Late success after a locally failed withdrawal is audited as conflicting evidence rather than changing status or releasing reservations.

## Manual bank returns and unresolved release design

A verified return after `PAID` creates one `PartnerManualBankReturn` row with bank return reference, amount, encrypted evidence, Admin actor, and timestamp. An identical repeat is idempotent; a different return conflicts. The original payout, paid commissions, and audit history remain intact. The Admin page displays that accounting correction is pending.

The current ledger has no safe independent withdrawable-credit instrument for a returned **paid** bank transfer. Reclassifying the original paid commissions would erase settlement history, while adding a regular commission would invent earnings and could bypass refund/debt checks. Therefore this change **does not restore withdrawable eligibility** after a bank return. A separate reviewed accounting design should introduce a return credit tied uniquely to the verified return, cap it to the returned amount, account for later refunds/reversals/debt, keep the original paid rows immutable, and prevent concurrent or repeated payout of the credit. Rehearse that design against cases with post-payment refunds, debt, and partial returns before any release action is approved.

Likewise, no Admin override releases reservations for `FAILED` or `ACTION_REQUIRED` provider withdrawals. Release needs conclusive nonpayment evidence, including any Stripe transfer reversal or PayPal return, plus checks for late settlement and contingent reversals. The existing hold is the safe state until that narrower accounting workflow is designed and tested. Do not change a paid withdrawal back to requested or initiate another provider transfer as a workaround.
