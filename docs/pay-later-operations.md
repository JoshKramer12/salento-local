# Pay Later operations and release gate

## Scope

Pay Later adds an invitation to an existing Partner `BusinessSubmission`. The submission's
`userId` remains the original Partner. Sending or resending an invitation creates neither a
payment nor a commission. After the verified owner selects a payment method, the method is
locked on the submission and the existing initial Stripe or bank transfer flow is used. The
existing paid payment finalizer publishes the listing, creates the membership, and creates
the €50 commission. Its 14 day hold is based on the paid payment timestamp.
Invitation links put the token in the URL fragment (`/pay-later#invite=...`); the browser
sends it in a POST body after the page loads so it is not included in HTTP request paths.

## Configuration

- `PAY_LATER_ENABLED=true` enables the Partner UI, owner routes and reminder job. Keep it
  absent or `false` until production checks pass. Setting it back to `false` is the immediate
  feature rollback; existing data and payment records remain intact.
- `PAY_LATER_TOKEN_SECRET`: a unique random secret of at least 32 characters. The code can
  fall back to `OWNER_ACCESS_TOKEN_SECRET`, but production should use a dedicated value.
  Do not change it while active invitations exist without a reissue plan.
- `APP_URL`: the canonical public HTTPS origin used in emails and WhatsApp links.
- `RESEND_API_KEY` and `RESEND_FROM`: mandatory production email provider configuration.
  Verify the sender's domain is authenticated. SMTP fallback is useful only for local tests.
- `SUPPORT_EMAIL` or `SMTP_REPLY_TO`: support contact displayed in invitation and reminder mail.
- Existing Stripe secret and publishable keys, webhook secret, and bank transfer country
  configuration remain required for the corresponding payment methods.
- `MEMBERSHIP_REMINDER_CRON_SECRET`: protects the existing
  `POST /api/internal/membership-reminders` endpoint. Its normal daily invocation now also
  runs Pay Later reminders. Calls with `?outcomes=only` intentionally skip reminders.

## Scheduler

Keep the existing 15-minute `membership-outcome-retry-cron` service on
`?outcomes=only`. It does not run reminders. The separate daily `curl` service already
invokes the same endpoint **without** `?outcomes=only` at 07:00 UTC, with
`Authorization: Bearer <MEMBERSHIP_REMINDER_CRON_SECRET>`. Use the same secret as the web
service. Do not add another daily reminder caller. Database reminder records, claim leases,
and Resend idempotency keys guard against retries and concurrent runs. Resend retains
idempotency keys for 24 hours. The first attempt timestamp is persisted; if an invitation
or reminder remains unacknowledged after 23 hours, automatic retries stop with
`delivery_uncertain_requires_review`. Reconcile that record against provider delivery
logs before any manual reissue or database remediation. Never restart its automatic
retry without confirming whether the earlier message was accepted.
Reminder milestones are elapsed UTC days 3, 6, 13, 20, 27 and 34 after the first accepted
invitation email. Dates shown to Partners use Europe/Rome.

## Database rollout

The migration `20261013160000_add_pay_later_invitations` is additive: five nullable
`BusinessSubmission` columns, two new tables, and indexes. No existing financial table is
reset or backfilled. It applies cleanly to an isolated schema-only clone of observed
production, and the resulting schema has no diff against `schema.prisma`.

The repository's historical migrations do **not** replay on a fresh empty database:
`20260730143000_structured_business_addresses` fails because `BusinessSubmission` is absent
at that point in the chain. This predates Pay Later. Before production deployment, compare
the actual production `_prisma_migrations` history and schema against the current branch,
then apply the additive migration on a non-production clone of that exact state. Never reset
or truncate production tables to resolve the history. The separate cash-out branch contains
unmerged October 12 migrations; reconcile the two histories if it is merged first, without
shipping its unfinished payout behavior.

## Recovery and rollback

If email acceptance fails, the invitation remains saved and the daily job retries it using
the same generation and Resend idempotency key within the provider's 24-hour window.
After 23 hours of uncertainty, retries halt for operator review. A Partner can resend from
the dashboard;
that rotates the link and invalidates the prior session. An owner reminder opt-out persists
through a resend to the same recipient. A Partner correction requires revoking the active
link, editing the saved draft, and sending a new mandatory email. A payment setup failure
leaves the method locked; retries after a two minute lease reuse existing online resource
keys or a deterministic Pay Later bank transfer key. Do not switch methods while a payment
resource may exist. Investigate Stripe and the saved payment before manual remediation.

To roll back before activation, keep the flag off. After activation, first set the flag
off; the Pay Later reminder job then exits without sending. Keep both existing Railway
cron services running because they also handle membership reminders and payment outcomes.
Restore application code only after checking in-flight payments and webhook finalization;
leave the additive database migration in place if any invitation or payment may depend on it.
Do not delete invitation or financial rows.

## Production release gate

1. Full tests, TypeScript, lint and build pass on the exact release commit.
2. Production migration history and a clone migration are verified, including cash-out
   compatibility and existing financial records.
3. Correct GitHub repository, Railway web service and cron service are identified.
4. Resend credentials, authenticated domain, support contact, canonical URL, Stripe keys,
   token secret, cron secret and feature flag are verified on the production services.
5. Webhook payment exclusivity, original Partner attribution and 14 day commission hold are
   checked without live charges or payouts.
6. Deploy with `PAY_LATER_ENABLED=false`, check service health and routes, then enable it.
   Confirm the deployed commit, scheduler and email provider state before reporting it live.

If any check fails, keep the flag off and do not deploy or claim the feature is live.

## Production read-only audit — 14 October 2026

The Railway project is named `salento-local-staging`, but its `production` environment's
`web` service is the live `https://www.salentolocal.ca` site. It deploys
`JoshKramer12/salento-local` from `main`; the active commit at audit time was
`3cacce011a0dfb43dc68cd7708f5538902c0ba89`. Its SQLite database is
`/data/prisma/dev.db` on the `web-volume` volume mounted at `/data`. The separate
`stripe-audit-web` service is not a release target.

The production database has 24 completed migrations and one rolled-back historical
attempt; all 24 completed migration checksums match this repository. The July 30
`structured_business_addresses` migration is completed in production. A fresh database
cannot replay the repository history because no earlier migration creates
`BusinessSubmission`; the table already exists in production. This is a fresh-replay
defect, not a Pay Later conflict with the observed production schema. Do not edit or
resolve that historical migration as part of this release.

A schema-only SQLite clone was built from production `sqlite_master` definitions and
`_prisma_migrations` metadata. It contains no customer rows. The Pay Later migration
applied through `prisma migrate deploy`; Prisma then reported no schema difference.
Synthetic linked records for User, Business, BusinessSubmission, Payment,
BusinessMembership, LocalPartnerProfile, PartnerPayoutRun, PartnerPayout, and
PartnerCommission retained every pre-existing column value. SQLite integrity and
foreign-key checks passed. Production row counts and integrity were read without
exporting customer data. This is strong structural evidence, but it is not a substitute
for a pre-deployment production volume backup.

`RESEND_API_KEY`, `RESEND_FROM`, support contact, canonical `APP_URL`, Stripe keys, and the
web/cron shared secret are present. Resend's API reports `salentolocal.ca` verified with
sending enabled. `APP_URL` is `https://www.salentolocal.ca`, and that host's health route
returns 200. The production Stripe secret and publishable keys are both **test-mode**;
confirm the intended payment mode and configure the corresponding live credentials and
webhook endpoint before enabling paid production membership. `PAY_LATER_TOKEN_SECRET` is
absent. The active 15-minute cron targets `?outcomes=only`, so Pay Later reminders are not
scheduled. The production volume has no backups or backup schedule. The apex
`salentolocal.ca` currently resolves away from Railway and presents an expired TLS
certificate; Railway reports its apex traffic DNS record requires an update. These
were the findings at the initial audit. No production setting or database was changed then.

The Pay Later branch is based on the active `main` commit and adds only the October 13
Pay Later migration. It contains none of the separate, unmerged cash-out migrations.

## Follow-up release audit — 14 October 2026

The authenticated Stripe dashboard shows the Salento Local sandbox account
`acct_1TqwSuRTjKpCuoPH` and an unfinished live-account activation flow for
`acct_1TqwSiEoijjMObZa`. Railway production still has matching `sk_test_` and `pk_test_`
credentials. The sandbox account reports `charges_enabled=false` and
`details_submitted=false`. Its enabled **test-mode** payment webhook targets the actual
Railway `web` service domain, `web-production-6f26e.up.railway.app`, and includes the
payment, invoice, refund and dispute events used by the application. Live credentials
and a live webhook cannot be verified or installed before the live account is activated.
The owner must complete Stripe's required business verification, bank information and
legal acceptance; do not substitute test keys for live payment readiness.

The daily Railway `curl` cron was already present at this follow-up audit, scheduled
`0 7 * * *` UTC. Its target is the normal membership reminder endpoint on the production
`web` domain. Its secret matches both the web service and the 15-minute outcomes-only
cron. Recent daily runs exited successfully, including 14 October. Preserve both jobs.

A dedicated random `PAY_LATER_TOKEN_SECRET` was added to `production/web` with deploys
skipped; its presence and minimum length were verified without displaying its value.
`PAY_LATER_ENABLED` remains absent. Resend still reports `salentolocal.ca` verified and
sending enabled; the configured sender is `hello@salentolocal.ca`, reply-to/support is
`support@salentolocal.ca`, and `APP_URL` is `https://www.salentolocal.ca`. No test email
was sent because no recipient was explicitly designated.

Railway's native backup API refused a manual volume backup because this workspace is on
the Hobby plan. A consistent SQLite `VACUUM INTO` copy was instead created at
`/data/prisma/paylater-predeploy-20261014.db`, with mode 0600, then downloaded into
this task's private audit directory outside the repository. The 15,441,920-byte backup
was restored into an isolated database. Both backup and restore passed SQLite integrity
and foreign-key checks. The current Pay Later migration applied to that restored copy.
Every pre-existing column value in User, Business, BusinessSubmission, Payment,
BusinessMembership, PartnerCommission, PartnerPayout and LocalPartnerProfile matched the
backup after migration. All 24 completed production migration checksums match local files.
No customer row was printed or included in version control. Repeat the online backup
immediately before any future production migration; the existing copy is a recovery
checkpoint for this audit, not an indefinitely current pre-deployment backup.

## Exact release sequence after the blockers are resolved

The controlled testing phase and public launch are separate gates. The production site
must retain its existing test keys until the owner separately approves live charges.

1. Keep the production Stripe keys and webhook in their current test mode. The live Stripe
   account reports Payments and Payouts active in its account status, but no live key or
   live webhook belongs in production during controlled testing. Do not make a live charge
   as a test. Stripe's setup guide can show incomplete suggestions even when the account
   status has no active verification tasks; recheck status before public launch.
2. The apex DNS correction is independent of Pay Later because invitations use the valid
   canonical `www` origin. Correct the apex if it should serve the site; do not alter the
   working `www` domain during this release.
3. Immediately before migration, repeat the SQLite online backup to a unique filename,
   copy it to protected storage outside the Railway volume, verify integrity and an
   isolated restore, and record its hash and timestamp. Railway native backups and
   schedules require a Pro workspace here; do not rely on them on Hobby.
4. Verify the configured `PAY_LATER_TOKEN_SECRET` remains present and persistent. Keep
   `PAY_LATER_ENABLED=false` for initial deployment. Never print or rotate the token
   secret while invitations are active.
5. Preserve the existing 15-minute outcomes-only cron and the existing daily `curl`
   service at 07:00 UTC. Confirm the daily caller targets the normal production endpoint
   exactly once with the shared secret. Do not manually trigger it to test with customers.

6. After the owner approves a change to the production website and financial database,
   recheck `main`, cash-out exclusion, migration checksums, SQLite integrity, and
   aggregate counts. Run all tests, TypeScript, lint, and production build on the exact
   release commit. Push the Pay Later branch, merge only its reviewed changes into
   `main`, and confirm Railway deploys that exact commit to `production/web`.
7. `scripts/start-hosted.sh` runs `prisma migrate deploy` against the mounted SQLite
   volume before Next starts. Confirm the Pay Later migration is recorded as completed,
   schema diff is empty, old aggregate counts have not fallen, integrity and foreign-key
   checks pass, and the web health route returns 200. Reverify the daily cron as described
   in step 5, including its next run. Leave
   the feature flag off until these checks pass.
8. Enable `PAY_LATER_ENABLED=true` on `production/web` only after the owner approves
   exposing this functionality to real customers. Confirm the new deployment,
   Partner UI, owner route, and existing payment routes. Use a synthetic/non-customer
   invitation for UI checks only; do not send a real customer email or initiate a live
   Stripe charge as a test. Monitor the first natural daily cron run for success and
   duplicate reminder records.

If a release check fails, stop before the next step. To disable Pay Later, set
`PAY_LATER_ENABLED=false` and deploy the changed variable. Keep both pre-existing cron
services running, and keep the additive schema and existing invitation/payment data. If code
rollback is required, reconcile any in-flight Stripe payments and webhooks first; the
payment finalizer must remain available. A volume backup restore is only for catastrophic
data corruption after assessing all intervening financial transactions, never the normal
feature rollback. The 14 October SQLite backup was restored successfully only in an
isolated local database; a production database restore has not been attempted and would
require downtime and reconciliation of all intervening payments. Do not reset or delete
production data.

## Isolated controlled testing — 14 October 2026

Railway environment `pay-later-test` is separate from `production`. Its
`pay-later-test-web` service has its own volume at `/data`; it was populated with a
schema-only copy of the observed production schema and 25 migration-history rows. The
copy has zero User and Business rows and no customer data. The hosted startup applies
the additive Pay Later migration to this separate volume. The service is protected by
`CONTROLLED_TEST_MODE=true` and a long random Basic Auth password; the only bypass is
the Stripe signed webhook and the internal reminder endpoint with its separate bearer
secret. Every transactional email is written to `/data/test-mail` instead of leaving the
server, and any address outside the reserved `@example.test` domain is rejected. Resend,
SMTP and Twilio credentials are absent from this environment. Bank details are visibly
marked test-only and contain no transferable IBAN. `BOOTSTRAP_BUNDLED_DATA=false`
prevents copying the repository's bundled database or uploads.

The existing production sandbox is **not** suitable for isolated staged payment tests:
its webhook delivers account events to `production/web`. The live Salento Local Stripe
account offers a distinct **Test mode** with different `sk_test_` and `pk_test_` keys.
Until those distinct keys and a matching test-mode webhook signing secret are installed
on `pay-later-test-web`, keep its Stripe keys blank. Pay Later may be enabled behind the
password gate to test synthetic invitations, owner OTP and the email sink, but no online
payment test can complete. Never use `sk_live_` or `pk_live_` in the test environment. The
separate test reminder cron targets only the isolated web domain and uses a secret distinct
from production. It may run for synthetic invitations while payment keys are absent;
the private mailbox keeps every message on the test volume. The existing production daily
cron remains unchanged; its Pay Later branch remains gated off.

After test keys are installed: verify both keys resolve to the live account's **test**
mode, create only a test-mode webhook for the isolated service with the application's
payment, invoice, refund and dispute events, set its signing secret, and run the full
synthetic end-to-end suite. Verify no production payment, membership, commission or
webhook log rows change. To roll back controlled testing, set `PAY_LATER_ENABLED=false`
on `pay-later-test-web`; retain the synthetic database for diagnosis. This does not alter
the production site or its cron jobs.

The isolated deployment passed these live checks: unauthenticated site requests returned
401, authenticated health returned 200, and an unsigned webhook returned 400. The volume
recorded the Pay Later migration as completed, passed SQLite integrity and foreign-key
checks, and began with zero customer or financial rows. A synthetic Partner submitted
invitations through both pre-signature and post-signature paths; both were accepted by the
private mailbox. Their owner OTP flows rejected an incorrect code and accepted the
captured code. WhatsApp deep links were generated but never opened or sent. After one
synthetic owner stopped reminders, a due reminder call sent one message to the other
synthetic address; an immediate repeat sent none. The test database still contained zero
Business, Payment, BusinessMembership, and PartnerCommission rows. The separate test cron
is configured for `0 7 * * *` UTC and targets the normal isolated reminder endpoint.
An operator-triggered execution of that exact cron deployment reached the isolated
endpoint with HTTP 200 and exited successfully. Its first natural scheduled execution
remains to be observed. Production counts and
migration state stayed unchanged throughout these checks.

## Controlled financial verification — 15 October 2026

The isolated service now has a distinct pair of Salento Local Stripe **test-mode** keys
and a dedicated signed test webhook. It remains behind Basic Auth, uses its own SQLite
volume, and writes all transactional email to the private test mailbox. Its naturally
scheduled daily reminder run completed successfully. No test webhook delivers to the
production database. Production remains on its existing Stripe test-mode configuration;
the Pay Later feature flag is absent there.

Synthetic owners completed both invitation entry points, OTP, legal acceptance and
signature, €100 test payments, publication, annual membership activation, and original
Partner €50 pending commission. An owner-initiated refund from the actual dashboard
refunded Stripe, canceled automatic renewal, deactivated the membership and listing,
and reversed that €50 commission once. A Stripe Test Clock verified a successful annual
renewal, a failed renewal without term or commission creation, recovery by paying the
same invoice, and end-of-term cancellation without another charge. Event replays did
not create duplicate financial rows.

Stripe's `invoice.paid` event snapshot can omit the invoice's `payments` collection.
The first Test Clock renewal therefore recorded a paid term and €15 commission with no
PaymentIntent reference in the **synthetic test database**. The webhook now fetches the
current invoice with payments expanded, requires exactly one fully paid payment for the
correct subscription, invoice, amount and currency, and verifies the resulting
PaymentIntent is succeeded for the same customer and amount before finalizing a term.
A subsequent natural test renewal stored the correct PaymentIntent reference, extended
the term once, and created one €15 commission. Production read-only inspection found no
paid invoice renewals or missing PaymentIntent references requiring backfill. The
original synthetic row remains as a known pre-fix test artifact.

Apple Pay and Google Pay domains are active in the isolated Stripe test account, and
wallet-funded card payments use the same signed webhook finalizer as card payments.
Actual wallet authorization still requires a compatible authorized device. Do not
substitute a live charge or claim an unperformed authorization passed. Card payments
are independent of that device check.

The published 14-day self-service policy applies to the qualifying **initial** annual
membership payment. Stripe card refunds use a stable idempotency key, provider status
reconciliation, membership revocation and commission reversal. Bank-transfer requests
record a timely claim and require Support to finish the return. A separate
`LIVE_OWNER_REFUNDS_ENABLED=true` switch is required if the site is later moved to
matching live Stripe keys; leave it absent for this test-key release. No live refund has
been executed, so live provider settlement and webhook delivery remain unproven.

For a failed automatic renewal, the authenticated owner dashboard directs the owner
to the **existing** open Stripe-hosted invoice. The server checks the membership's
customer and subscription, Stripe mode, latest invoice, exact EUR100 amount, and
Stripe-hosted HTTPS URL before redirecting. The subscription must save the successful
card as its default method. While that invoice is open, a second card or bank renewal
is blocked. The existing `invoice.paid` finalizer alone grants the 365-day term and
EUR15 Partner commission. If the invoice cannot be verified, use Support; do not
create another payment or subscription.

The canonical production origin is `https://www.salentolocal.ca`. On 16 October 2026,
the apex `salentolocal.ca` still pointed to Namespro (`51.222.143.2`) and presented
an expired `*.namespro.ca` certificate, while www had a valid Railway certificate.
Repair the registrar's apex HTTPS forwarding or move the apex to a verified Railway
domain configuration; confirm a valid HTTPS redirect to www. Do not change DNS without
checking the registrar setup. A fresh verified database backup is required immediately
before any production migration.
