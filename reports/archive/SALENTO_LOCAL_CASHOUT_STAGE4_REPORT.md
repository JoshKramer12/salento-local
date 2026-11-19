# Salento Local — Cash Out Stage 4 verification report

Date: 2026-11-03. Branch: `feature/partner-manual-cashout-stage4-verification`. Baseline: Stage 3 commit `6d7afc0ffa49912ecc001b38862dda767bcb62fb` (Stage 2 `530e2dc`, Stage 1 `42d64a3`). Final Stage 4 commit: `ab520c4`. Nothing was pushed, merged, deployed, or enabled in production.

## Executive summary

**Production release decision: NOT READY.** An authenticated Partner created and canceled a Cash Out request through the actual UI and Server Actions against isolated SQLite data. A stale balance required reconfirmation; English and Italian layouts were inspected. Database state confirmed exact reservations and release. This is an **accounting/UI integration simulation**, not a payment-provider end-to-end result. No actual Stripe transfer, connected-account payout, or signed Connect webhook was exercised. A fresh migration replay still fails in an older migration. The production database backup, restore, migration ledger, and live Connect configuration remain unverified.

## Isolation and scope

- A new temporary local database under `/tmp/salento-stage4-isolated.jTQfaG/` was created with `prisma db push`. Synthetic `example.test` Partner and Owner records, businesses, payments, commissions, and payout history were inserted. The fixture intentionally marks its **synthetic** payment rows as live-eligible to test the unchanged Stage 1 predicate; it is not a Stripe test-mode payment and never contacted Stripe. The local server had **no Stripe API key, no worker secret, no email credentials, and no worker schedule**.
- The Railway CLI reported **no linked project**, so the earlier Railway test service, its database separation, webhooks, email sink, jobs, uploads, and current data could not be verified. It was not used or changed.
- The existing Stripe CLI profile has a test key, but its account was not proven separate from the public site's test ledger. It was **not used**. A new CLI profile attempted fresh sandbox provisioning; automatic provisioning failed and offered browser signup. No Stripe API resource or sandbox account was created, and no key or verification code is included here. Actual Stripe tests are **BLOCKED** pending an explicitly isolated test account, test keys, Connect capability, and isolated webhook secret.
- External network activity was limited to public Stripe documentation and an unsuccessful fresh-sandbox provisioning attempt. No production database, production volume, customer data, Railway setting, Stripe setting, or financial API object was accessed or changed.

## Authenticated browser and financial database checks

The local server used the Stage 4 database, `PARTNER_CASHOUT_UI_ENABLED=true`, `PARTNER_CASHOUT_REQUESTS_ENABLED=true`, and `PARTNER_WITHDRAWAL_PROCESSING_ENABLED=true`. The internal worker secret was absent, so the worker route returned HTTP 503 and no provider operation could start. These flags were set only for the local process.

| Check | Result and evidence |
|---|---|
| Partner authentication and dashboard | Actual credentials login for a synthetic GETTER succeeded. Dashboard showed €100 available, €50 in a 14-day hold, €0 reserved, €0 paid, and masked bank last four `4821`. Dedicated earnings page showed the same values. |
| Confirmation | Actual modal showed full €100, Stripe Connect, synthetic bank name, masked account, €50 minimum, neutral fee text, and processing explanation. Cancel closed it. |
| Request and reservation | Confirming in the browser created exactly **one** `REQUESTED` withdrawal for 10,000 cents and two 5,000-cent allocation rows. Both commissions became `RESERVED`; available became €0 and reserved €100. `PartnerWithdrawalAttempt=0` and `PartnerPayout=0`. |
| Cancellation | Browser confirmation and Stage 1 action changed the withdrawal to `CANCELED`, cleared the active slot, released both allocations exactly once, restored €100 available, and retained the history row. No provider attempt was made. |
| Hold and stale amount | While an Italian confirmation showed €100, the third synthetic commission's isolated eligibility timestamps were advanced beyond its 14-day hold. The server rejected the stale amount, showed €150, required a separate review action, and then created one new 15,000-cent request. The old canceled request remained in history. Three allocations totaling 15,000 cents were reserved; there was one active withdrawal and still zero provider attempts. |
| Refund debt | A second authenticated synthetic Partner had a historical `PAID` 5,000-cent payout, an exactly-once `DEBT` reversal of −5,000 cents, €0 available, and a disabled Cash Out button. The dashboard explained that future earnings offset debt and the bank account is not charged. This historical payout is **synthetic evidence**, not an actual Stripe payout. |
| Authorization | After sign-out, visiting `/dashboard/earnings` redirected the browser to login. The Stage 1/2 isolated tests cover Partner ownership, other roles, admin controls, worker secret, and session checks; those roles were not all exercised in this browser run. |
| Responsive and language | Actual authenticated dashboard inspected at 375, 390, 430, 768, and 1280 CSS pixels; `scrollWidth === innerWidth` at each. English and Italian labels, EUR formatting, history, active-state message, and mobile confirmation were visibly checked. The 390-pixel Italian dialog was 624px high in an 844px viewport and the final action remained visible. |

Screenshots from the authenticated **synthetic local** browser flow:

- [Desktop English — active withdrawal](SALENTO_LOCAL_STAGE4_DESKTOP_EN.jpg)
- [Mobile English — active withdrawal](SALENTO_LOCAL_STAGE4_MOBILE_EN.jpg)
- [Mobile Italian — available/history](SALENTO_LOCAL_STAGE4_MOBILE_IT.jpg)
- [Italian mobile confirmation](SALENTO_LOCAL_STAGE4_CONFIRMATION_IT.jpg)
- [Italian active withdrawal](SALENTO_LOCAL_STAGE4_ACTIVE_IT.jpg)
- [English refund debt](SALENTO_LOCAL_STAGE4_DEBT_EN.jpg)

The full Owner signup → payment → verified commission → Stripe Connect onboarding → actual provider-paid withdrawal journey was **not** completed. Existing test-mode payments remain `stripeLivemode=false` and cannot authorize the real-disbursement ledger. The synthetic fixture is confined to the local database; no production eligibility rule was changed.

## Stripe sandbox, webhooks, faults, refunds, and cancellation

**Actual Stripe test-mode transfer: BLOCKED. Actual Stripe test-mode payout: BLOCKED. Actual signed Connect webhook: BLOCKED.** There are no Stripe object IDs to record. The production processor requires live-mode evidence and is not a safe way to treat a test-mode commission as live. No test-only withdrawal rail was added without a verified isolated provider account. Stripe says test-key payouts simulate provider behavior and do not send money to a bank; even a future successful sandbox run would not prove a real deposit ([Stripe payout API](https://docs.stripe.com/api/payouts/create), [Stripe automated testing](https://docs.stripe.com/automated-testing)).

The repository's deterministic Stage 1/2 tests passed for whole-balance reservation, idempotent lost-response retry, refund/request races, debt allocation and recovery, pre- and post-provider cancellation, duplicate workers, expired leases, transfer/payout timeout after acceptance, webhook-before-response, duplicate/out-of-order webhook handling, failed payout retention, admin-gated reversal/retry, and legacy batch exclusion. These tests assert isolated financial rows and use a **mock provider**. They do not establish real Stripe API behavior, actual webhook delivery, test-mode account readiness, bank settlement, or long-term idempotency retention. Unlisted fault cases from the Stage 4 brief, including provider rate limits and a genuinely expired Stripe idempotency record, remain unverified against Stripe.

Refund scenarios A/B and debt recovery D/E have deterministic Stage 1 database coverage. Scenario C has both Stage 1/2 database coverage and the authenticated synthetic debt display above, without a real paid Stripe payout. Scenario F has Stage 1/2 tests for refund before claim, during transfer, and after transfer/payout; actual provider timing across all requested boundaries remains partial. Cancellation before provider start passed in the authenticated browser; worker-claim races and post-start denial passed only with deterministic mocks.

The new Stage 4 gate test verifies that default configuration pauses requests, worker sends, and legacy sends; even with all release flags set, production **test-mode** Stripe keys cannot enable withdrawal or legacy disbursements. In the isolated process, the legacy send flag stayed off. No legacy send was executed. Historical payout reads and legacy webhook handling have existing regression coverage, but no provider replay was run in Stage 4.

## Migration rehearsal and backup/restore

There are **31 checked-in migrations**. The Stage 1 migration adds four tables with checks, foreign keys, and unique active-owner/request keys. Stage 2 adds nullable columns, a new attempt table, checks, and uniqueness for provider object/idempotency keys. Neither rewrites existing financial rows. Older migrations do contain table rebuilds and assumptions that must be reviewed against a genuine production snapshot.

A database created from the **pre-Stage-1 Prisma schema** was populated with a historical paid payout and a separate debt commission. Applying the exact Stage 1 and Stage 2 SQL succeeded. `PRAGMA integrity_check` returned `ok`, `foreign_key_check` was empty, the 5,000-cent paid payout and −5,000-cent debt survived, and the current Prisma client read those rows and wrote a new withdrawal. This is a representative schema compatibility check, **not** `prisma migrate deploy` against an authentic production migration ledger.

An independent full-history replay on a new empty SQLite database **FAILED** at `20260730143000_structured_business_addresses` with Prisma P3018, `no such table: BusinessSubmission`. This pre-existing defect was reproduced. No historical migration file or migration ledger was altered. A sanitized production-shaped snapshot, its migration ledger, off-volume backup, and a reviewed plan for the old replay defect are required before production migration approval.

For an isolated restore rehearsal, Python's SQLite online `Connection.backup` copied the active Stage 4 database consistently; a synthetic upload SVG was copied with it. The backup was restored into a separate directory. Database and upload SHA-256 hashes matched; `integrity_check=ok`, `foreign_key_check=[]`, and both withdrawal rows and the 15,000-cent reserved balance survived. The production Next build started locally against the restored database; `/api/health` and `/login` returned 200, the developer preview returned 404, and authenticated login rendered the restored withdrawal history. A deferred Stripe Connect sync logged `stripe_secret_key_missing` because the deliberately isolated process had no Stripe key, so this is **not** a full provider-integrated startup check. This proves a **local procedure**, not that production currently has a complete backup or has ever been restored.

## Worker, operations, and notifications

The worker route requires `PARTNER_WITHDRAWAL_WORKER_SECRET`; with none set it returned HTTP 503. Code uses constant-time secret comparison, a five-minute lease, bounded batches of at most ten, durable transfer/payout intents, and separate reconciliation callable with `?reconcile=1` even while new sends are paused. Default-off `PARTNER_WITHDRAWAL_PROCESSING_ENABLED` and the global real-disbursement gate remain. No production schedule exists. Provider rate-limit behavior, operational alerts, stuck-withdrawal dashboards, runbook drills, and exact schedule credentials remain unverified. The existing legacy batch route is separate and stays default-off.

Proposed future configuration, **not activated**: one secret-protected POST worker every 2–5 minutes, and a separate secret-protected reconciliation POST (`?reconcile=1`) every 2–5 minutes; keep legacy batch execution disabled. Monitor `OUTCOME_UNKNOWN`, `ACTION_REQUIRED`, leases older than five minutes, failed webhook events, and attempted sends by idempotency key. Pause new requests and processing flags while leaving reconciliation reachable for in-flight operations. Investigate a stuck request by withdrawal ID, its immutable attempts, payout/transfer IDs, Stripe current objects, webhook log, and commission allocations before any admin reversal or retry. Do not infer that an absent Stripe search result proves no payout.

No Cash Out request/completion/cancellation email sender was found in the new implementation. Existing membership and legacy payout delivery code was not triggered. Cash Out notifications are follow-up work, with a private sink test before activation; the current UI history is the status channel.

## Regression results and changes

- Full safe Node/tsx suite: **669 passed, 0 failed, 0 skipped** after the Stage 4 flag test. The 668 Stage 3 baseline also passed unchanged before adding that test.
- TypeScript: passed. Prisma schema validation: passed. ESLint: 0 errors, 7 existing warnings. Isolated SQLite production build: passed. `git diff --check`: passed.
- New files: `scripts/stage4-seed-browser.ts`, `scripts/stage4-seed-debt-browser.ts` (fail-closed local fixtures that require an isolated `/tmp` URL, explicit test marker/password, non-production environment, and no Stripe key), and `tests/partner-cashout-stage4-flags.test.ts`.
- **New Cash Out defect found/fixed:** none. **Existing release defect reproduced:** full historical migration replay P3018; not changed because altering migration history without a real production-shaped snapshot and ledger review would be unsafe. No financial production code was changed.

## Production readiness matrix

`PASS` means the stated local check was completed; it does not imply production activation.

| Area | Result | Principal limit |
|---|---|---|
| Commission accounting | PARTIAL | Isolated ledger tests; no actual Owner Stripe purchase-to-commission journey. |
| Debt recovery | PARTIAL | Exact local database scenarios; no actual paid payout/refund evidence. |
| Withdrawal reservations | PASS | Browser request plus database allocations/cancellation; no live provider. |
| Stripe transfer idempotency | PARTIAL | Durable intent and mock crash tests; actual Stripe blocked. |
| Stripe payout idempotency | PARTIAL | Mock retry/reconciliation tests; actual Stripe blocked. |
| Webhook reconciliation | PARTIAL | Mock out-of-order/duplicate tests; signed Connect delivery blocked. |
| Refund/payout concurrency | PARTIAL | Deterministic races; provider timing blocked. |
| Partner authorization | PARTIAL | Partner/visitor browser plus role tests; all roles not browser-tested. |
| Admin authorization | PARTIAL | Existing isolated role tests; no deployed endpoint test. |
| Partner browser experience | PARTIAL | Authenticated request/cancel/history passed; provider completion untested. |
| Mobile usability | PASS | Authenticated 375/390/430/768/1280 rendering, Italian confirmation, no overflow. |
| English/Italian localization | PASS | Both locales checked in authenticated dashboard and modal. |
| Stripe sandbox integration | BLOCKED | No verified isolated Connect sandbox/test credentials/webhook. |
| Legacy batch safety | PARTIAL | Default-off gate and existing tests; no provider replay. |
| Migration compatibility | FAIL | Populated schema-only check passed; fresh full-history replay P3018 remains. |
| Backup and restore | PARTIAL | Local SQLite/uploads restore passed; production backup/restore unknown. |
| Worker readiness | PARTIAL | Auth/lease/reconcile code tested; no schedule or operational drill. |
| Feature flag safety | PASS | Default-off and production test-key gate verified. |
| Operational monitoring | BLOCKED | No configured alerts/production job evidence. |
| Production deployment readiness | BLOCKED | Stripe, migration, backup, monitoring, and authorization gaps remain. |

## Required next actions before any release decision

1. Provision and document an **isolated Stripe Connect test account** with its own test keys, connected account, bank destination, webhook secret, and private event sink. Add a test-only allocation path that can never run under live credentials; then exercise actual transfer, payout, retrieval, idempotency, and signed webhooks. Keep the production live-eligibility predicate unchanged.
2. Obtain an authorized sanitized production-shaped SQLite snapshot **with migration ledger and representative payout/debt rows**. Verify an independent off-volume database-and-uploads backup and isolated restore, then rehearse `prisma migrate deploy` and application read/write. Resolve or document the old fresh-replay recovery path without rewriting historical migrations casually.
3. Establish a separately authorized worker schedule, secret rotation/ownership, reconciliation cadence, alerts, exception queue, and stuck-withdrawal runbook. Test pause/resume and provider outage drills.
4. Complete the actual Owner signup/payment/commission hold and Connect onboarding journey in an isolated test environment, and all-role browser authorization coverage. Verify no real customer email delivery.
5. Only after these gates pass, review the separate [production release checklist](SALENTO_LOCAL_CASHOUT_PRODUCTION_RELEASE_CHECKLIST.md) and seek explicit release authorization.
