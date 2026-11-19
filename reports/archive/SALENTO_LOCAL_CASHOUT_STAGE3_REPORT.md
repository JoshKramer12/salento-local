# Salento Local — Cash Out Stage 3 implementation report

Date: 2026-11-02. Repository: `/Users/josh/Documents/Codex/2026-11-02/files-mentioned-by-the-user-redesign/work/repo`. Local branch: `feature/partner-manual-cashout-stage3`. Stage 2 baseline: `530e2dc0e2fbe3e30c0b0ec202a28eff23486ea7`. Stage 1 baseline below that: `42d64a3`. Stage 3 commit: `6d7afc0`. No push, merge, deployment, production data/configuration change, live transfer, or bank payout.

## Implemented interface

The Partner dashboard and `/dashboard/earnings` show the new Cash Out area only when `PARTNER_CASHOUT_UI_ENABLED=true`. The default is disabled, so the existing production interface continues to render. Owner and Admin routes are unchanged. The new Partner area uses the existing colors, serif headings, rounded cards, and responsive navigation. It emphasizes the net amount available, then shows historical gross live earnings, pending earnings, reserved/processing funds, previously paid commissions, and any outstanding refund adjustment. Test and unverified activity are listed separately as non-withdrawable. The account card links to the existing `/partner/payout` Stripe Connect setup flow. No payout method or onboarding data was removed.

The new read-only `getPartnerCashoutView` adapter uses Stage 1's `getPartnerWithdrawableBalance` for net eligible, reservation, debt, destination, active request, and unresolved legacy state. It does not use the old overlapping `available`/`pending` display sums to authorize requests. Pending is live paid, positive, non-reversed commission credit that does not satisfy the existing payable predicate yet. “Total earned before refunds” is explicitly gross historical live commission credit, including amounts subsequently reversed after payout; the outstanding adjustment is shown separately. “Previously paid out” is commission credit with paid history and a payout paid timestamp. These are labeled historical figures, not additive buckets. The €50 minimum and request eligibility are derived from the backend.

## Confirmation and server integration

The responsive confirmation dialog shows the full reviewed amount, Stripe Connect and masked bank details, €50 minimum, neutral fee wording, and automatic-processing explanation. It has keyboard Escape handling, focus containment, mobile scrolling, and safe-area padding. A single request key is retained in session storage through network failures, and the submit control locks immediately against double clicks. The browser submits only the key and reviewed amount. The amount is a **comparison**, never authority: the Stage 1 request transaction recalculates the complete eligible balance and rejects a mismatch before reserving exact commissions. On a changed balance, the dialog presents the new amount and requires a second review action. On success it displays the request ID, requested amount, current status, masked destination, and history link; it does not call the Stripe processor or claim payment settled.

`submitCashoutRequest` calls the existing Stage 1 `requestPartnerWithdrawal` service. The action is default-off behind `PARTNER_CASHOUT_UI_ENABLED=true`, `PARTNER_CASHOUT_REQUESTS_ENABLED=true`, and the existing Stage 2 processing/global financial gates. It revalidates the dashboard pages after success. There is no browser control for Partner ID, commission IDs, payout destination, or partial amount. The existing service checks session role, stored role/profile, live payment eligibility, debt, destination, active request, minimum, and atomic reservation. A lost response retried with the same key returns the same request.

## Withdrawal status, history, and cancellation

The earnings page reads Partner-owned withdrawals newest first in pages of ten; the dashboard shows the latest three. Each row includes requested amount/date, masked destination, current status, completion date when present, and cancellation only while the stored state permits it. Unknown provider outcomes are worded as “We're verifying the status of this payout” / “Stiamo verificando lo stato di questo pagamento.” Canceled, failed, paid, requested, processing, and action-required records remain visible. Earlier batch payouts are queried separately, excluding records linked to a withdrawal, so the same payout is not shown twice.

The cancellation control asks for confirmation and calls Stage 1's `cancelPartnerWithdrawal`. That service rechecks owner, state, and provider-start timestamp under the Partner lock and releases reservations atomically. Repeated cancellation returns the same canceled record. A race won by the worker returns a clear cannot-cancel message. Cancellation is available even when new request creation is paused, provided the UI flag is still enabled.

## Localization and responsive design

All new Partner-facing labels, explanations, errors, modal copy, history text, and button text are in English and Italian. Italian currency uses the site's existing locale formatter. The preview route has developer-only scenario controls in English; it is inaccessible in a production build and requires `PARTNER_CASHOUT_PREVIEW_ENABLED=true` in development. Its twelve synthetic states cover €0, €40, €50, €175, pending, debt, missing Stripe account, active, processing, paid, canceled, and unknown. It does not read customer data or call Stripe. In preview mode, confirmation and cancellation are simulated in the browser.

The browser preview was inspected at 320, 390, 768, and 1280 pixel widths. All four reported `document.documentElement.scrollWidth === innerWidth`. The 320 pixel English and Italian views wrapped amounts and long labels; the confirmation sheet scrolled within a 92dvh cap. The English confirmation opened and closed; synthetic confirmation displayed the submitted reference. The active Italian state disabled Cash Out and showed the cancellation control. Browser verification used the synthetic preview, not an authenticated Partner account or Stripe sandbox. A separate proxy guard returns HTTP 404 for the preview in production or when the preview flag is absent.

Screenshots from isolated synthetic data:

- [Desktop Cash Out overview](SALENTO_LOCAL_STAGE3_DESKTOP.jpg)
- [Italian mobile confirmation](SALENTO_LOCAL_STAGE3_MOBILE_REVIEW_IT.jpg)

## Files changed

- `src/lib/partner-withdrawals.ts`: transactional reviewed-amount comparison, without changing the server-selected amount or commission allocation.
- `src/lib/partner-cashout-view.ts`: authorized read-only financial and history projection, and default-off UI/request gates.
- `src/lib/partner-cashout-presenter.ts`: small client-safe eligibility reason selector.
- `src/lib/partner-cashout-fixtures.ts`: synthetic preview scenarios.
- `src/app/(account)/dashboard/earnings/cashout-actions.ts`: secured request and cancel Server Actions.
- `src/components/account/partner-cashout-panel.tsx`: bilingual dashboard, confirmation, history, debt and account UI.
- `src/app/(account)/dashboard/page.tsx`, `src/components/account/partner-dashboard.tsx`, and `src/app/(account)/dashboard/earnings/page.tsx`: default-off Partner integration; existing Owner/Admin branches and Partner sections remain.
- `src/app/dev/cashout-preview/page.tsx`: development-only preview route.
- `src/proxy.ts`: early HTTP 404 for the synthetic preview outside the explicitly enabled development environment.
- `tests/partner-withdrawals-stage1.test.ts` and `tests/partner-cashout-stage3.test.ts`: transaction comparison, projection, history, eligibility and fixture tests.

No Prisma schema or migration changed in Stage 3. No server cron, public processor route, or real provider call was added.

## Verification

- Focused Stage 1/3 tests: passed, 0 failed. The Stage 3 file includes synthetic eligibility and isolated SQLite projection/history/ownership tests; Stage 1 adds reviewed-amount and lost-response idempotency coverage.
- Full repository suite: 668 passed, 0 failed after the preview-route guard.
- TypeScript: `npm run typecheck` passed.
- Prisma validation: passed against an isolated SQLite URL.
- ESLint: 0 errors and 7 existing warnings on the latest completed run.
- Isolated SQLite production build: passed.
- Production-mode preview-route check: HTTP 404, including when the preview flag was explicitly set.
- `git diff --check`: passed.

## Limits, release blockers, and Stage 4

1. No authenticated browser end-to-end test has exercised the actual Partner dashboard, server action, cancellation, and history together. The synthetic browser preview and isolated DB tests cover these layers separately. Stage 4 should run the full flow with a synthetic Partner in an isolated environment.
2. No Stripe sandbox Connect integration has verified provider behavior, account readiness, balance/settlement, or webhooks. No live payout readiness is claimed.
3. The Stage 1/2 production-shaped migration rehearsal and historical ledger review remain outstanding. Stage 3 adds no migration.
4. `PARTNER_CASHOUT_UI_ENABLED`, `PARTNER_CASHOUT_REQUESTS_ENABLED`, and `PARTNER_WITHDRAWAL_PROCESSING_ENABLED` remain unset/default-off. The Stage 2 global real-disbursement gate still applies; no worker schedule was added.
5. Historical legacy payouts remain separately visible, but the compact legacy list is capped at the same twelve records previously shown. A deeper historical pagination/export and administrator investigation UI belong in Stage 4.
6. Stage 4 should add an isolated authenticated browser test for EN/IT, keyboard and mobile interactions, stale balance and lost-response timing; Stripe test-mode provider validation; admin exception handling/notifications; and a production-shaped backup, restore, and migration rehearsal before any release decision.

**Status:** Stage 3 Partner UI is locally implemented and ready for isolated Stage 4 integration verification. It is not ready for production activation.
