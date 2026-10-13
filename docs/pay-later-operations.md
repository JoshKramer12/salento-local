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

Verify that the existing Railway cron service invokes the correct production site's
`POST /api/internal/membership-reminders` at least daily with
`Authorization: Bearer <MEMBERSHIP_REMINDER_CRON_SECRET>`. The same secret must be configured
on the web service. Do not create a duplicate cron caller: reminders have database leases
and provider idempotency keys, but a single routine scheduler is easier to operate.
Reminder milestones are elapsed UTC days 3, 6, 13, 20, 27 and 34 after the first accepted
invitation email. Dates shown to Partners use Europe/Rome.

## Database rollout

The migration `20261013160000_add_pay_later_invitations` is additive: five nullable
`BusinessSubmission` columns, two new tables, and indexes. No existing financial table is
reset or backfilled. It applies cleanly to an isolated copy built from the current `main`
Prisma schema, and the resulting schema has no diff against `schema.prisma`.

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
the same generation and Resend idempotency key. A Partner can resend from the dashboard;
that rotates the link and invalidates the prior session. An owner reminder opt-out persists
through a resend to the same recipient. A Partner correction requires revoking the active
link, editing the saved draft, and sending a new mandatory email. A payment setup failure
leaves the method locked; retries after a two minute lease reuse existing online resource
keys or a deterministic Pay Later bank transfer key. Do not switch methods while a payment
resource may exist. Investigate Stripe and the saved payment before manual remediation.

To roll back before activation, keep the flag off. After activation, first set the flag
off and stop the scheduler's Pay Later sends. Restore application code only after checking
in-flight payments and webhook finalization; leave the additive database migration in place
if any invitation or payment may depend on it. Do not delete invitation or financial rows.

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
