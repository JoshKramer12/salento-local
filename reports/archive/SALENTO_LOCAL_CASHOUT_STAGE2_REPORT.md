# Salento Local — Cash Out Stage 2 implementation report

Date: 2026-11-02. Repository: `/Users/josh/Documents/Codex/2026-11-02/files-mentioned-by-the-user-redesign/work/repo`. Local branch: `feature/partner-manual-cashout-stage2`. Stage 2 local commit: `530e2dc0e2fbe3e30c0b0ec202a28eff23486ea7` (“Build automatic partner cash-out processing and reconciliation”); working tree clean. Exact Stage 1 baseline: local commit `42d64a3` (“Build partner cash-out accounting foundation”), made from the previously uncommitted Stage 1 work verified with 640 passing tests. Stage 2 builds on that commit; the original production/main baseline was `2782534c9f5dc07602862a89c20bfeea0c691671`.

## Status

The automatic backend processes a valid Stage 1 withdrawal locally with deterministic Stripe mocks: one platform transfer, one connected-account bank payout, and paid settlement only after the provider payout is confirmed. It has an authenticated, bounded internal worker route, but no cron or public Partner action is activated. It has not been tested against Stripe sandbox or a real provider, and is **not ready for production deployment**.

The strongest invariant is deliberately conservative: once an intent for either Stripe leg exists, a crash, timeout, replay, or expired worker lease cannot cause an automatic second call for that leg. An unconfirmed operation stays reserved until provider evidence or operator investigation resolves it.

## Files changed

Modified:

- `prisma/schema.prisma` — attempt enums/model, withdrawal lease, external destination, and reconciliation fields.
- `src/lib/partner-ledger.ts` — separate default-off gate for the unsafe legacy batch execution path.
- `src/app/api/stripe/connect-webhook/route.ts` — route signed payout events with withdrawal metadata to the new processor; preserve legacy handling for other payouts.

Added:

- `prisma/migrations/20261102230000_partner_cashout_processing/migration.sql`.
- `src/lib/partner-withdrawal-provider.ts` — Stripe adapter and narrow mockable evidence interface.
- `src/lib/partner-withdrawal-processing.ts` — claim, processing, reconciliation, settlement, reversal, retry, and worker services.
- `src/lib/partner-withdrawal-admin.ts` — role-checked inspection, investigation, reconciliation, transfer reversal, and payout retry functions.
- `src/lib/partner-withdrawal-worker-auth.ts` — constant-time worker-secret comparison shared with route tests.
- `src/app/api/internal/partner-withdrawals/run/route.ts` — secret-guarded POST worker entry point; `?reconcile=1` runs read-only provider reconciliation even when sends are paused.
- `tests/partner-withdrawal-processing-stage2.test.ts` — synthetic SQLite and deterministic provider fault tests.

No dashboard, Cash Out button, payout cron, Railway setting, Stripe setting, or public processing route was added.

## Database and migration

`PartnerWithdrawalAttempt` records the immutable withdrawal/operation/sequence, amount, currency, connected account, unique Stripe idempotency key, provider object ID, intent timestamp, outcome, error code, and reconciliation timestamp. Operations are `TRANSFER`, `PAYOUT`, and `TRANSFER_REVERSAL`. A payout retry creates the next sequence; it never reuses a failed attempt under a new identity. A unique `(withdrawalId, operation, sequence)` key and unique idempotency/provider-object IDs are database guards. `PartnerWithdrawal` adds a processing lease, exact external bank account ID captured before the transfer, and last reconciliation time.

The SQL migration only adds nullable columns, a new table, indexes, and a positive-amount/sequence check. It was applied to a **populated synthetic Stage 1 schema** in an isolated SQLite database. A pre-existing withdrawal row was preserved, the new columns were null on that row, `PRAGMA quick_check` returned `ok`, and `PRAGMA foreign_key_check` was empty. The repository's historical fresh-database migration replay defect remains; no production clone, migration ledger, or customer data was used. A production-shaped restore and migration rehearsal remain mandatory before deployment.

## Automatic processing and two Stripe legs

The worker selects up to ten pending requests in creation order. Before a Stripe send, it checks the global real-disbursement gate and the separate `PARTNER_WITHDRAWAL_PROCESSING_ENABLED=true` switch. Both must pass. It checks the immutable Stage 1 amount and allocations, Partner role/onboarding, live paid Payment, hold/refund status, exact Business/Submission/Membership attribution, outstanding debt, legacy payout conflict, EUR, connected-account readiness, and unchanged masked destination. The Stripe adapter then verifies the connected account and resolves one default EUR external bank account; the exact bank account ID is persisted and passed explicitly to the payout call.

A database transaction takes the shared Partner write lock, creates a dedicated `PartnerPayoutRun` and `PartnerPayout`, links reserved commissions, records a unique transfer intent, marks provider processing started, and acquires a lease **before** the transfer API call. Transfer metadata and transfer group carry the withdrawal and payout IDs. After transfer evidence is saved, a separate durable payout intent is recorded before the connected-account payout call. Each payout also carries its attempt ID in Stripe metadata. A provider-accepted payout remains `PROCESSING` until its retrieved current status is `paid`; only then are the withdrawal, payout, run, and exact commission allocations marked paid.

Stripe's API v1 can prune idempotency keys after at least 24 hours, so a stable key alone is insufficient for crash recovery ([Stripe idempotency reference](https://docs.stripe.com/api/idempotent_requests)). The processor never reissues an existing intent automatically. Transfer reconciliation searches by its unique transfer group; payout reconciliation searches the connected account for its exact attempt metadata, then validates amount, currency, connected account, destination, live mode, and payout/withdrawal IDs. Absence or multiple matches are treated as inconclusive, not proof of failure. A known object is retrieved by ID. The worker can resume the payout leg after confirmed transfer evidence, without making another platform transfer.

The processing lease blocks concurrent workers while fresh. An expired lease does **not** authorize a repeated provider call when an intent exists. A second worker gets a reconcile result. The request idempotency key and Stage 1 unique active slot remain intact.

## Webhooks, failures, refunds, and debt

The existing Connect route still verifies Stripe signatures and mode and uses the durable `StripeWebhookEvent` deduplication/processing claim. Withdrawal payout events require a connected account ID and exact withdrawal, payout, and attempt metadata. The handler retrieves the current payout from Stripe before changing financial state, so duplicate or out-of-order event payloads do not override current provider evidence. Events without withdrawal metadata keep the existing legacy handler.

Timeouts and ambiguous exceptions set `OUTCOME_UNKNOWN`, retain all allocations and original intent identity, and cannot trigger a blind resend. A failed/canceled bank payout keeps the platform transfer and all reservations. A late `failed` status after `paid` moves the withdrawal and payout to `ACTION_REQUIRED`, preserves the historical paid rows, and blocks new cash-outs through the unresolved-payout gate. A newer unprocessed request is invalidated; a newer in-flight request is frozen. This rare late-return case requires operator reconciliation before any accounting correction.

A refund before the provider claim invalidates the Stage 1 request and sends nothing. A refund after processing begins leaves allocations held and marks the request uncertain. If Stripe later confirms the bank payout paid, reversed allocated commissions become paid historical commissions and their existing reversals become `DEBT`; Stage 1's durable recovery then offsets that debt against future eligible credits. If the transfer is fully reversed before any bank payout attempt, a separate, administrator-authorized recovery operation can mark `FAILED_CONFIRMED` and release only the still-valid reserved credits. A failed or uncertain reversal leaves funds held.

## Narrow admin recovery and legacy compatibility

Admin functions recheck the authenticated user's stored `ADMIN` role. They can inspect exact attempts/allocations/events, add an investigation reason, request reconciliation, request a transfer reversal only if no bank payout attempt exists, and retry **only the bank payout leg** after Stripe reports `failed` **and** supplies `failure_balance_transaction`, which Stripe defines as the transaction returning funds to the connected balance ([Stripe Payout object](https://docs.stripe.com/api/payouts/object)). Reversal and retry have separate default-off switches. There is no unrestricted force payout or amount-edit capability. A changed external bank account fails closed and requires a new reviewed request.

The legacy batch processor currently releases reservations after some ambiguous provider errors. Stage 2 therefore gates **new legacy execution** behind `PARTNER_LEGACY_PAYOUT_EXECUTION_ENABLED=true` as well as the existing global gate. The switch is not enabled here or in production. Historical payout records and the signed legacy Connect webhook handler remain available. Stage 1's shared Partner lock still prevents a new withdrawal and a legacy batch from reserving the same commission. Before re-enabling legacy sends, its uncertain failure handling needs a separate repair and review.

## Verification

- Focused Stage 2 synthetic/mock tests: 21 passed, 0 failed. Cases include automatic two-leg success, idempotency keys, duplicate workers, expired lease, lost transfer and payout responses, provider object recovery, webhook-before-response, duplicate/out-of-order events, wrong account/amount/currency, refund before/during/after processing, paid-refund debt, transfer reversal success/failure, confirmed failed-payout retry, missing return evidence, late bank failure, admin/worker authorization, global gate, and legacy gate.
- Full repository test suite: 661 passed, 0 failed in the final rerun.
- TypeScript: passed.
- Prisma validation: passed.
- Additive migration on synthetic populated Stage 1 schema: passed.
- ESLint: 0 errors, 7 existing warnings.
- Next production build against isolated SQLite: passed. The first build caught a Next.js route-export restriction; moving the testable worker-secret helper to a library module resolved it, and the final build passed.
- `git diff --check`: passed.

Every Stripe operation in tests used a deterministic in-memory provider. No Stripe sandbox account, live account, or bank received an API call from these tests. Stripe's documented Connect payout states and delayed failure behavior were checked against [official Connect payout guidance](https://docs.stripe.com/connect/manage-connected-account-payouts).

## Limitations and production blockers

1. No Stripe sandbox integration run has validated actual Connect permissions, connected-account manual-payout scheduling, external-bank selection, balance availability/settlement, webhook delivery, and the exact installed Stripe SDK behavior. Mock success is not provider readiness.
2. No production-shaped backup/restore and migration-ledger rehearsal has occurred. The historical migration replay defect remains.
3. No production worker secret, schedule, feature release, or live-disbursement authorization exists. The new worker, retry, and reversal switches are default off. The global disbursement gate remains authoritative.
4. The legacy batch send path remains gated off by default. Its old failure/release behavior must be repaired before enabling it again; historical reads and webhooks remain.
5. A late `paid → failed` bank return or contradictory older payout attempt stays `ACTION_REQUIRED` with paid history preserved and new requests blocked. An operator needs verified provider balance and ledger evidence before correcting those historical rows. The code does not guess or automatically debit a Partner.
6. A missing transfer/payout object after a timed-out call is not treated as proof of non-creation. The attempt stays reserved for investigation; this may delay a Partner cash-out but prevents double sending.
7. Stage 3 must add the Partner-facing authoritative balance, confirmation, request/cancel actions, and withdrawal history without exposing processing endpoints. An administrator investigation UI, notifications, and clear legacy-vs-withdrawal history presentation are also outstanding. Provider sandbox verification and production release review must precede any live rollout.

**Production status:** untouched. No push, merge, deployment, production database migration, Railway/Stripe setting change, real transfer, real bank payout, or production cron occurred.
