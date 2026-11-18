# Salento Local — Cash Out operator runbook

**Status:** prepared on 18 November 2026; production Cash Out requests and sends remain off. No earlier runbook file is present on current `main`, so this is the maintained Stage 8 runbook. Every money-moving intervention, production flag/cron change, or database correction needs a separately approved operator action. Record incident owner, time, withdrawal ID, related provider IDs, reason, and evidence without copying keys or full bank data.

## Ledger interpretation

1. `REQUESTED`: Partner-authenticated request; exact commissions are reserved, no provider operation.
2. `PROCESSING`: durable transfer/payout intent and lease; inspect attempts to know which Stripe operation may have happened.
3. Stripe **transfer**: funds move to connected account; no bank-payout proof.
4. Stripe **payout**: funds are instructed to external account; `pending` is not paid.
5. `PAID`: matching provider-retrieved payout status and local settlement. Stripe can later emit a failure; preserve historical evidence.
6. `OUTCOME_UNKNOWN`/`ACTION_REQUIRED`: funds remain held and new requests blocked pending operator reconciliation. Never release or pay again from a timeout alone.
7. `FAILED_CONFIRMED`: only after an evidence-backed full transfer reversal with no bank payout attempt; review the released commissions before a new request.

## Daily control and alert thresholds

Once separately activated, run a secret-authenticated `POST /api/internal/partner-withdrawals/run?health=1` at least every five minutes and route incident keys to a deduplicating alert sink. The endpoint is read-only and returns no secret values. It is presently unscheduled. Default thresholds: request unprocessed 60 minutes, pre-payout processing 10 minutes, pending connected payout three days, reconciliation stale six hours, failed/stuck Connect webhook immediately or after its ten-minute processing lease. `OUTCOME_UNKNOWN`, `ACTION_REQUIRED`, reservation discrepancies and paid-evidence discrepancies are critical immediately. Configure minute thresholds with `PARTNER_CASHOUT_REQUEST_STALE_MINUTES`, `PARTNER_CASHOUT_PROCESSING_STALE_MINUTES`, `PARTNER_CASHOUT_PAYOUT_PENDING_MINUTES`, and `PARTNER_CASHOUT_RECONCILIATION_STALE_MINUTES` only after review. Invalid values fall back to defaults.

The alert system must deduplicate by the returned `cashout:<withdrawal>:<code>` or `cashout:webhook:<event>` key, page a named financial incident owner for critical incidents, and escalate if two scheduled runs are missing. Railway logs are diagnostic evidence, not a delivery guarantee. Monitor worker HTTP failures, sanitized `[partner-withdrawal:reconciliation]` errors, Connect webhook non-2xx/FAILED counts, Stripe API errors, volume/SQLite failures, and unexpected provider transfers. No production alert sink or missing-run watchdog was installed in Stage 8.

Daily independent reconciliation must compare local withdrawals, active commission reservations, payout runs, attempt/idempotency rows, provider transfers and reversals, connected payouts and statuses, refund debt, and Connect webhook log. Reconcile the platform and connected EUR balance movement and investigate any Stripe transfer with Cash Out metadata absent locally. The current worker reconciles known withdrawals but does not enumerate every unexpected transfer; complete that control before activation. Record a signed-off daily totals sheet and unresolved variances. Do not send another transfer to make totals match.

## Incident triage

1. **Pause new requests** if the issue could duplicate sends or misstate funds. If provider effects are uncertain, pause new processing too; keep signed webhook intake and authorized reconciliation available. Confirm which flags and scheduler actually ran before changing anything.
2. Read the withdrawal, `PartnerWithdrawalCommission`, `PartnerWithdrawalAttempt`, `PartnerWithdrawalEvent`, `PartnerPayout`, `PartnerPayoutRun`, related payment mode/status, debt recovery, and `StripeWebhookEvent`. Use a read-only DB connection and redact Partner/customer data in incident notes. Verify the exact connected account and masked destination.
3. Retrieve the Stripe transfer by recorded ID or search transfer group; retrieve each connected payout by recorded ID or metadata and attempt ID. Check mode, amount, currency, destination, status, reversal amount, failure balance transaction, and provider request logs. A missing provider object after a timeout is **not** proof it was never created.
4. Compare provider state to local state. If it agrees, run the authenticated reconciliation path, inspect resulting events, and close only after the ledger and provider balance agree. If it conflicts, retain `ACTION_REQUIRED`, block further Cash Out, and escalate to the financial owner. Record every manual decision before execution.

## Specific conditions

| Condition | Safe automated behavior | Operator action requiring evidence and approval |
|---|---|
| Request older than one hour | Health incident; worker may claim it once if activated and all gates pass. | Check scheduler, auth, flags, Partner eligibility, debt and legacy payout. Do not manually create provider objects. |
| Stale processing or provider timeout | Lease/idempotency record persists; reconciliation searches provider objects. | Review Stripe logs, object search, attempt key and account balances. Do not blindly retry a create or clear a reservation. |
| `OUTCOME_UNKNOWN` | New request blocked; reconciliation is read/settlement only. | Resolve provider identity, exact amount and destination. If no conclusive evidence, keep hold and contact Stripe support. |
| Failed or canceled bank payout | Local state becomes `ACTION_REQUIRED`; commissions remain held. | Verify current payout status and returned-funds transaction, then decide on approved retry or reversal. A failed payout alone does not prove funds returned to the platform. |
| Late `payout.failed` after paid | Paid ledger remains historically paid; new Cash Out blocked. | Reconcile bank return and provider balances, debt and prior paid entry. Never silently flip paid commissions to available. |
| Transfer reversal, especially after paid payout | `ACTION_REQUIRED`; historical paid ledger retained; newer withdrawal frozen. | Confirm reversal amount and provider transfer/payout timing, then decide a documented accounting correction. Do not automatically issue another transfer. |
| Refund/dispute after paid commission | Reversal/debt record is preserved; future eligible credits may recover debt. | Verify original payment/refund event, payout status and remaining debt. Approve any exceptional adjustment separately. |
| Missing or failed Connect webhook | Signed delivery retries; durable event log has FAILED/PROCESSING state. | Inspect Stripe endpoint delivery, signing secret *identity* (not value), mode/account, HTTP status and event ID. Replay only after confirming current provider object; avoid a second payout. |
| Worker secret or route failure | 503 when secret absent, 401 on wrong bearer; no send. | Restore secret or scheduler only with release approval. Verify no overlapping invocation and inspect in-flight attempts first. |
| SQLite/volume or process restart | Webhook lease and withdrawal lease eventually expire; durable intents survive. | Verify mount/DB identity, integrity, migration ledger, Stripe objects and event log before restarting a send worker. Test recovery in isolation first. |
| Local/Stripe disagreement | Remains held for review. | Escalate to Stripe and financial owner; preserve provider request IDs, event IDs, timestamps, balance transactions and DB snapshot. Do not overwrite local state to match an assumption. |

## Emergency pause

Under an approved incident change, turn off `PARTNER_CASHOUT_REQUESTS_ENABLED`, then `PARTNER_WITHDRAWAL_PROCESSING_ENABLED`; do not enable `PARTNER_LEGACY_PAYOUT_EXECUTION_ENABLED` as a substitute. Keep the Connect webhook endpoint and read-only/reconciliation ability available for existing obligations. If the Stripe account itself is compromised, follow Stripe's account incident procedure with the account owner. No automatic reversal or retry flag should be enabled during the pause. Communicate impact to affected Partners only through an approved support workflow.

## Database restore or code rollback

A code rollback never reverses a Stripe transfer/payout or SQLite writes. Before rollback, compare old code with the current migration schema and list all in-flight provider attempts and unprocessed webhook events. A restored DB can lose local knowledge of external provider effects: keep sends disabled, enumerate Stripe transfers/payouts and webhook events since the backup timestamp, rebuild exact durable evidence through an approved reconciliation procedure, and only then consider resuming. Restore SQLite and uploads together from an independent verified backup. Never reseed or `prisma db push` against production to recover a financial incident.
