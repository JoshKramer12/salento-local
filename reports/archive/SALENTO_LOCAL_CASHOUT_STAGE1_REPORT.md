# Salento Local — Cash Out Stage 1 implementation report

Date: 2026-11-02. Local branch: `feature/partner-manual-cashout-stage1` from `2782534c9f5dc07602862a89c20bfeea0c691671`. No push, merge, deployment, production migration, configuration change, or provider disbursement was performed.

## Summary and scope

Stage 1 now has a server-side, Prisma-backed withdrawal request and debt recovery foundation. It calculates an authoritative balance from eligible, verified live payments; reserves the complete net balance in one transaction; enforces a €50 minimum and one active request; supports idempotent pre-processing cancellation; and invalidates a pending request if a refunded commission changes its amount. The ordinary USER direct-URL path to the admin earnings overview is closed. There is no Cash Out UI, API route, Server Action, worker, or Stripe transfer/payout call in the new withdrawal module.

The existing partner dashboard display balance remains a display calculation. The new `getPartnerWithdrawableBalance` service is the authorization calculation for future Cash Out entry points.

## Files

Modified:

- `prisma/schema.prisma` — additive models, enum, and relations.
- `src/lib/partner-ledger.ts` — shared per-Partner mutation lock, refund invalidation and recovery-voiding, and legacy batch exclusion for Partners in the new ledger.
- `src/app/(account)/dashboard/earnings/page.tsx` — explicit role routing before the admin query.
- `tests/payment-business-linkage.test.ts` — refund mock updated for the new transactional safeguards.

Added:

- `prisma/migrations/20261102210000_partner_manual_cashout_stage1/migration.sql`.
- `src/lib/partner-withdrawals.ts`.
- `src/lib/earnings-access.ts`.
- `tests/partner-withdrawals-stage1.test.ts`.
- `tests/earnings-access.test.ts`.

## Data model and migration

`PartnerWithdrawal` stores the Partner, idempotency key, status, full requested amount, gross/recovery snapshot, Stripe Connect account reference and verified timestamp, optional existing `PartnerPayout` execution link, and lifecycle timestamps. `PartnerWithdrawalCommission` records the exact credit amount reserved and later released. `PartnerWithdrawalEvent` records each implemented transition. `PartnerDebtRecovery` links each negative paid-commission reversal to the eligible positive commission that repays it; a voided recovery remains in history. All amounts use integer cents.

The migration creates only these four tables and indexes. A nullable unique `activePartnerUserId` enforces one active withdrawal per Partner at the database level; a separate unique `(partnerUserId, requestKey)` enforces request idempotency. SQL checks enforce positive allocation amounts, a withdrawal of at least 5000 cents, and active-owner identity. It does not rewrite existing financial tables or amounts.

Migration verification used a throwaway SQLite database generated from the exact pre-change Prisma schema at the branch base, then applied the SQL with foreign keys enabled. The four new tables existed, `PRAGMA quick_check` returned `ok`, and `PRAGMA foreign_key_check` was empty. The repository's historical migration replay defect prevents treating a fresh full-history replay as production proof. No production clone or production migration was used. A production-shaped backup/clone, migration ledger review, and restore rehearsal remain release gates.

## Authoritative balance

At one transaction timestamp, the service selects positive, unreserved, live-mode EUR commissions with paid payments and the existing 14-day initial-payment hold and refund hold predicate. It verifies exact Payment, Business, Submission, Membership, and Partner attribution. It checks Stripe Connect readiness and a status sync no older than 24 hours, the existing real-disbursement gate, active withdrawal, and unresolved legacy payout records. Historical paid payouts are never counted as spendable; reserved payout/withdrawal commissions are excluded from the request pool and reported separately.

It returns gross eligible cents, eligible unreserved cents after credited debt recovery, debt recovered on those credits, outstanding debt, reserved cents, net eligible cents floored at zero, and withdrawable cents. Withdrawable is zero when the net amount is below €50 or another safety gate fails. The browser does not supply an amount. Existing `getPartnerBalanceSummary().available` is never used to authorize a request.

## Debt and refunds

The existing unique `REVERSAL/DEBT` rows remain the source of paid-commission debt. An unpaid commission is reversed without creating debt; a paid commission retains its historical `PAID` status and payout, while its exactly-once reversal records the negative debt. The new service validates each debt against its original paid commission and paid payout. Inconsistent or unverifiable historical debt fails closed for review.

`recoverEligiblePartnerDebt` allocates oldest outstanding debt against eligible unreserved commissions, in cents, under the same Partner lock. It supports multiple debts, multiple credits, and partial recovery. The allocation is durable and idempotent; a later refund of a recovery credit voids that allocation and reopens the debt. Recovery is a separate transaction before a withdrawal request so it remains recorded even when the remaining net amount is below €50. The balance calculation subtracts still-outstanding debt even before recovery is invoked, preventing an overstated cash-out. Stage 2 must call the recovery service when newly held credits become eligible; Stage 1 adds no scheduler.

If a refund reverses an allocated commission before provider processing, the whole request becomes `INVALIDATED`, all its reservations are released, and the Partner must confirm a newly calculated amount. The request is never silently reduced. If a future provider attempt has begun, the request becomes `OUTCOME_UNKNOWN` and its withdrawal allocation remains unreleased for reconciliation. The refunded commission itself is reversed; Stage 2 must determine from provider evidence whether money was sent and create any resulting paid-commission debt before clearing the active slot.

## Request lifecycle and concurrency

Implemented transitions are creation as `REQUESTED`, Partner cancellation from `REQUESTED` or `READY_FOR_PROCESSING` to `CANCELED`, and refund invalidation to `INVALIDATED` or `OUTCOME_UNKNOWN`. `PROCESSING`, `PAID`, `ACTION_REQUIRED`, and `FAILED_CONFIRMED` are schema states reserved for Stage 2. No Stage 1 path marks a request paid.

The request service authenticates the session-derived GETTER, rechecks the User and completed Partner profile in the database, then takes a write lock on that Partner profile. It rechecks debt, destination, legacy payout state, active request, and full balance inside the transaction. It creates the withdrawal, atomically changes each exact commission from eligible to `RESERVED`, and writes allocations and event; any failure rolls back the whole transaction. The unique active slot and idempotency key are final database guards. Cancellation checks ownership, status, provider-start timestamp, and execution link before releasing the reservations, and repeat cancellation returns the existing canceled record.

The existing weekly batch reservation now takes the same Partner lock. It skips any Partner with new withdrawal history, debt, or recovery allocations because its gross all-commission calculation cannot represent partial debt repayment. Existing batch behavior for Partners outside the new ledger remains intact. This conservative exclusion is a Stage 2 integration point: the old batch must be retired or explicitly reconciled for Partners switching to Cash Out. Unresolved historical `SCHEDULED`, `PROCESSING`, `FAILED`, `CANCELED`, or attempted `ACTION_REQUIRED` payout records block new requests for operator review.

Design choices requiring Stage 2 review: a Stripe Connect readiness snapshot expires after 24 hours; request keys must be 16–128 URL-safe characters; and ambiguous legacy payout records block instead of being automatically released. These are conservative implementation limits, not founder-defined payout policy. Debt recovery is recorded before a withdrawal transaction so a below-minimum request cannot undo legitimate recovery.

## Admin access

The earnings page routes `GETTER` to the Partner view and `ADMIN` to the admin overview. `BUSINESS_OWNER` and `USER` redirect to `/dashboard` before the admin data query. The role decision has a four-role regression test. Existing admin actions and navigation were not changed.

## Verification

- Prisma schema validation and client generation: passed.
- TypeScript typecheck: passed.
- ESLint: passed with 0 errors and 7 pre-existing warnings outside the Stage 1 changes.
- Next production build against an isolated database: passed.
- `git diff --check`: passed.
- Focused Stage 1 tests: 13 passed, 0 failed. These cover minimum/full amount, idempotency, ownership and role checks, unpaid and paid refunds, held and partial recovery across multiple debts and credits, refund of a recovery credit, withdrawal invalidation, concurrent requests, request/refund and recovery/request races, legacy batch/request race, stale destination and unresolved payout blocks, transaction rollback, provider-start cancellation denial, and in-flight refund uncertainty.
- Full repository suite on the final code: 640 passed, 0 failed, 0 skipped.

No tests contacted a live financial provider. Stage 1's new service contains no transfer, payout, or network call. The build and migration tests used throwaway local SQLite databases.

## Remaining work and risks for Stage 2

1. Add a narrow authenticated Partner entry point and UI, using the service's session-derived identity and server-selected amount. Do not expose arbitrary Partner IDs, amounts, or dates as authority.
2. Implement an automatic Stripe Connect worker with claim/lease or compare-and-set semantics, stable provider idempotency keys, a fresh provider readiness and commission/amount check, and an immutable execution record linked to `PartnerPayout`. A provider timeout must become `OUTCOME_UNKNOWN` and hold reservations until reconciliation proves the outcome.
3. Implement confirmed paid/failed/action-required transitions and exact provider-webhook reconciliation; release a confirmed failed reservation only after evidence that no funds remain in flight. Preserve historical payout records and the active-slot invariant.
4. Reconcile or retire the weekly legacy batch for Partners moved to Cash Out. Review blocked historical payout/debt rows and migrate only with evidence. The present conservative guard can leave such Partners unable to request until reviewed.
5. Run a production-shaped migration rehearsal with a backup and migration ledger; verify Stripe live-mode release controls and historical data before any rollout. No live disbursement should be enabled by this Stage 1 branch.
6. Test actual Stage 2 provider timing, webhook delays, cancellation/process races, and reconciliation against Stripe test mode before production release. Stage 1 tests simulate the provider-start state but do not execute a provider call.

**Stage 1 conclusion:** the local accounting and request foundation is implemented and verified. Stage 2 can build on it, subject to the release gates above. This branch is not a deployable automatic payout feature.
