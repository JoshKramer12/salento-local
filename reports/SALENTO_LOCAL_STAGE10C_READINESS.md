# Salento Local — Stage 10C readiness

**20 November 2026. Decision: B — partially ready.** No live payment or Cash Out canary is authorized by this report. Stage 10A safety code is still undeployed, Stage 10B is a plan, and the live Stripe account, subscription transition and operational controls are unverified. The first €100 canary is **not yet safe to authorize**.

## Verified baseline and scope

- GitHub `origin/main` is `042f6747d330fa713e191be2d3435a8f81b598ec`; `origin/feature/partner-cashout-stage10a-readiness` began this stage at `fcdd13b14d62e35365ab83827a1d2e4484534717`. The active checkout was clean before Stage 10C edits. No Stage 10B implementation branch or release was found in these refs.
- Read-only Railway CLI query of project `salento-local-staging`, **production** environment, `web` service: latest SUCCESS deployment `523ea2e8-a381-4df6-8f4b-09eb8ef36421`, Git SHA `042f6747d330fa713e191be2d3435a8f81b598ec`. The production services are `web`, `membership-outcome-retry-cron` and `curl`; no Cash Out scheduler appears. Variables were inspected by **name and safe classification only**: `STRIPE_SECRET_KEY` has test prefix; publishable and platform webhook keys are present; `PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED=true`. No live-payment, Connect webhook, Cash Out UI/request/processing or legacy payout enable flag is configured on `web`. This does not prove a missing flag cannot be inherited elsewhere; recheck before release.
- Source schema has a nullable `Payment.stripeLivemode` and 31 migration directories plus lockfile. Stage 10A reported 32 applied production migrations; no fresh production DB inspection or migration was attempted in Stage 10C. The protected Stage 9 backup exists; it was not opened or altered.
- Reviewed Stage 10A readiness, live Stripe matrix, Stage 10B activation plan, provider verification, monitoring and daily-close reports, relevant payment/renewal/commission/Cash Out code and isolated tests. The 19 November production snapshot and provider findings remain **historical evidence**, not a current database/provider audit.

## Financial separation and local change

Stage 10A already excludes `stripeLivemode=false` and NULL payments from live Cash Out eligibility, checks the 14-day initial hold, payment attribution, Partner debt, account mode, and provider transfer/payout identities. Signed platform/Connect webhooks reject a mode mismatch. Historical test subscriptions and customers remain mode-specific; none was canceled or relabeled.

Stage 10C found a narrower setup gap: interrupted embedded subscription operations and a stored renewal subscription could be read or resumed before checking local mode provenance. The local patch now records the configured mode when claiming a fresh embedded setup operation, rejects untagged provider/setup history under live credentials, blocks a stored renewal subscription without a matching live payment before the provider read, and checks the retrieved subscription mode. A pending historical Checkout also gets a mode check before retrieval/expiry. Regression tests cover legacy interruption, fresh live claim, and stored-subscription isolation. No schema migration or business rule changed.

The 12 previously observed active test automatic subscriptions, one failed lookup, 86 NULL-mode historical payments and four test provider-paid/local-FAILED legacy payouts remain historical findings from Stage 10A. Do not treat them as live balances or cancel them as a side effect. Their current provider/database states were not re-read today. A founder-approved transition plan must preserve owner consent and terms, segregate old test renewal obligations, and resolve the one lookup before a credential change. The four payout discrepancies block those Partners from Cash Out until manual disposition; exhaustive reconstruction of other old test payouts is not a live payment prerequisite.

## Verification and provider evidence

| Check | Stage 10C result |
|---|---|
| Focused embedded/membership/mode/recovery tests | 36 passed, 0 failed |
| Complete automated suite | 697 passed, 0 failed; isolated synthetic/provider mocks |
| Application TypeScript | Passed |
| Operational-script TypeScript | Passed with a temporary config extending the application config |
| Prisma schema | Passed with isolated URL; no migration run |
| ESLint | Passed, 0 errors and 7 existing warnings |
| Production build | Passed against a copied isolated synthetic SQLite fixture |
| Browser | 20 public smoke checks passed: EN/IT, 1440/390 px, home, directory, login, business signup entry and Pay Later. No authenticated Owner/Partner/Admin browser flow was rerun. The older 27-check script stopped at its missing seeded business fixture; this is a fixture limitation, not a passed check. |
| `git diff --check` | Passed |

Today's direct provider check was Railway's deployment and variable-name/mode classification. **No live Stripe API key or live account access was available**; live activation, country/currency, card/customer-balance/bank-transfer methods, subscriptions, refund/Connect/transfer/payout capabilities, requirements, restrictions, bank destination and live webhook subscriptions remain unverified. No Stripe charge, transfer, refund, payout, subscription cancellation or configuration call occurred. Prior Stage 8 genuine test-mode €50 transfer/payout and signed `payout.paid` delivery, and Stage 10A read-only test account inventory, are documented in [provider verification](SALENTO_LOCAL_CASHOUT_PROVIDER_VERIFICATION.md); the failed/canceled/returned payout cases remain mock-only or unproven. Synthetic tests are not evidence of real bank settlement.

## Smallest release gates

1. **Disabled safety-code deployment:** exact commit/diff review; fresh, consistent off-volume production SQLite **and uploads** backup; hash/integrity and isolated restore; migration compatibility; explicit deployment approval. Keep all money-moving gates off. Stage 10A is not in production today.
2. **Live payment readiness:** account owner performs a read-only live Stripe capability/restriction and webhook review through secure provider access; verifies EUR card and bank/customer-balance methods, subscriptions/refunds, platform/Connect webhook endpoint plans and accounting/receipt support. Agree on handling the 12 test subscriptions and old pending IDs without silent reuse. Approve the credential/configuration change separately; then review the named €100 plan.
3. **Cash Out readiness, later and separate:** verify genuinely live €50 commission after its full 14-day hold, Partner debt/refunds, live Express identity/destination/capabilities, legacy conflicts, provider failure evidence or accepted residual risk, independent no-send monitor/alerts/watchdog, daily provider/statement close, single worker and emergency stop. Approve the named €50 withdrawal separately.

No code was pushed, merged or deployed; no production data or configuration changed. The complete suite covers isolated payment/renewal/refund/Partner/Cash Out logic, including failure, retry and idempotency. Authenticated UI, genuine live payment/webhook transport and real bank settlement still require their controlled gates. Task-generated build and browser fixtures are removed after verification; no new dependency tree was installed. See [first payment plan](SALENTO_LOCAL_FIRST_LIVE_PAYMENT_PLAN.md) and [first Cash Out plan](SALENTO_LOCAL_FIRST_LIVE_CASHOUT_PLAN.md).
