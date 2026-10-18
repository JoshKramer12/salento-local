# Live financial launch runbook

This runbook prepares a later, separately approved production release. Do not use the public production database for Stripe 4242 tests. The `pay-later-test` Railway environment has its own database, test keys and webhook, Basic Auth gate, and private email sink.

## Release switches

| Switch | Purpose | Initial live-collection deployment |
| --- | --- | --- |
| `PUBLIC_LIVE_PAYMENTS_ENABLED` | Enables public live payment creation and finalization only with matching live Stripe secret and publishable keys. | `false` until the live webhook and account settings are ready. |
| `LIVE_OWNER_REFUNDS_ENABLED` | Enables live owner card refund requests. | `false` until the live refund path is validated and separately approved. |
| `LIVE_PARTNER_PAYOUTS_ENABLED` | Enables real Partner payout runs, retries and provider disbursements only when live payments are also enabled with matching live keys. | `false` until Connect, balances, holds, reconciliation and operations are validated and separately approved. |
| `PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED` | Allows simulated payments on public production with test keys. | Remove or set `false` before switching keys. |

Unset switches are closed in production. A live payment release does not open Partner payouts. Test and unverified Payment rows remain excluded from `payableCommissionWhere`, reservation, and final provider checks; do not backfill their mode from assumptions.

## Before changing production

1. Obtain separate approval for a reviewed commit, deployment, credential change, and live payment activation. Confirm `origin/main` and the Railway `production/web` deployment commit. Keep `stripe-audit-web` out of the release.
2. Resolve in-flight public test Checkout Sessions, PaymentIntents, subscriptions and webhook deliveries. The single production Stripe client and signed webhook accept one mode at a time; a late test event will fail mode verification after the key switch. On 18 October 2026, all 14 stored production subscription IDs were verified read-only as test-mode subscriptions, while 12 memberships were marked automatic/recurring-ready. Decide a guarded re-enrollment and owner communication policy before live activation; the old subscriptions cannot charge live cards, and persisted automatic status must not promise they will. Do not convert test records or charge historical customers.
3. Complete a fresh SQLite online backup from the production volume to protected storage outside that volume. Verify its hash, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, and an isolated restore. Compare migration history and run any pending additive migration against a restored clone before production. Keep customer data out of logs and version control.
4. Confirm the live Stripe account, live EUR card capability, EU customer-balance bank-transfer capability, and actual bank instructions. Register and verify `www.salentolocal.ca` as a live payment method domain; enable and device-check the desired Apple Pay and Google Pay methods. Resolve the apex domain's expired certificate if the apex is meant to serve traffic.
5. Create a live platform webhook for `/api/stripe/webhook` with the payment, invoice, refund and dispute events handled by the application. Create a separate live Connect webhook for `/api/stripe/connect-webhook` before Connect payouts. Store each matching signing secret securely in the production web service. Confirm signature rejection and delivery health without creating a financial transaction.
6. Check `APP_URL`, Resend sender/domain, support contact, reminder cron secret, the daily reminder job and 15-minute outcome retry job. Confirm legal business identity, refund terms, tax/invoicing obligations and privacy details with the owner and qualified advisers.

## Approved activation sequence

1. Close `PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED` after reconciling in-flight test payments. Deploy the reviewed code from `main` through GitHub while the production live-payment and payout switches remain off. Verify Railway `production/web` is `SUCCESS`, its commit equals `origin/main`, health is 200, and no unrelated service was deployed.
2. Install the live `sk_live_` and matching `pk_live_` credentials plus the live platform webhook secret on `production/web`; keep `PUBLIC_LIVE_PAYMENTS_ENABLED=false`, `LIVE_OWNER_REFUNDS_ENABLED=false`, and `LIVE_PARTNER_PAYOUTS_ENABLED=false`. Verify configured mode and endpoint reachability without printing values.
3. With separate approval for real transactions, enable public live payments. Perform one controlled genuine €100 card purchase through the normal owner flow. Confirm the Stripe object is `livemode=true`, one paid Payment, one published listing, one membership, one correct €50 commission, expected live wording, and idempotent webhook/polling reconciliation. Check the hold starts at that payment's actual `paidAt`.
4. Validate the live owner refund path before enabling `LIVE_OWNER_REFUNDS_ENABLED`: request, provider result, listing entitlement, commission reversal, and owner/Partner notices. Validate a normal live bank transfer in a separately approved controlled transaction: show Stripe-provided beneficiary, IBAN/BIC, reference and instructions; ensure no publication or commission until actual funds settle. Check manual renewal separately. Do not substitute a simulated bank transfer for live settlement.
5. Keep Partner disbursements closed while auditing live Connect onboarding, connected-account payout capability, available platform funds, the €50 default minimum, 14-day initial holds, renewal eligibility, reservation/idempotency, failures, refunds/disputes, negative balances, reconciliation, admin authorization, and payout notifications. Configure the live Connect webhook and `PAYOUT_JOB_SECRET` if using the internal scheduled run endpoint. Enable `LIVE_PARTNER_PAYOUTS_ENABLED` only after separate approval and a controlled live payout verification.

## Rollback

Close `LIVE_PARTNER_PAYOUTS_ENABLED` first for a payout incident, and `PUBLIC_LIVE_PAYMENTS_ENABLED` for a payment-creation incident. Reconcile all in-flight live Stripe objects and signed webhooks before any code or key rollback. Preserve the financial database and audit rows. Reverting a code commit is distinct from restoring a database; restore only for proven corruption after accounting for writes since the backup. Never use `railway up`, reset the production database, or replace its `/data` volume as a routine rollback.
