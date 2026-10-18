# Payment email delivery inspection

The authenticated `POST /api/internal/membership-reminders` job processes payment
emails. In production, `membership-outcome-retry-cron` calls `?outcomes=only`
every 15 minutes and retries pending Partner commission confirmations and Pay
Later bank-instructions emails. The separate daily `curl` service calls the
same endpoint without that query parameter at 07:00 UTC; it runs the same
delivery retries plus daily reminders. Payment claims and stable provider keys
protect overlapping calls.
Both callers use `MEMBERSHIP_REMINDER_CRON_SECRET`, which the web route checks.
Do not invoke either job manually to inspect delivery state: it can send email.

An authorized administrator can inspect the production SQLite database through
Railway's `production/web` SSH session. The production file is
`/data/prisma/dev.db`. Use read-only queries and keep customer details out of
shared logs. These examples print only delivery identifiers and state:

```sh
railway ssh --project <project-id> --environment production --service web -- node -e '
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({ datasources: { db: { url: "file:/data/prisma/dev.db" } } });
(async () => {
  const rows = await db.$queryRawUnsafe(`SELECT d.id, d.commissionId,
    d.attemptCount, d.firstAttemptedAt, d.nextAttemptAt, d.acceptedAt,
    d.canceledAt, d.failureMessage, d.provider, d.providerMessageId
    FROM PartnerCommissionConfirmationDelivery d
    WHERE d.acceptedAt IS NULL AND d.canceledAt IS NULL
    ORDER BY d.createdAt DESC LIMIT 50`);
  console.log(JSON.stringify(rows, (_, value) => typeof value === "bigint" ? value.toString() : value));
})().finally(() => db.$disconnect());'
```

```sh
railway ssh --project <project-id> --environment production --service web -- node -e '
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({ datasources: { db: { url: "file:/data/prisma/dev.db" } } });
(async () => {
  const rows = await db.$queryRawUnsafe(`SELECT id, businessSubmissionId, status,
    bankInstructionsEmailClaimedAt, bankInstructionsEmailFirstAttemptedAt,
    bankInstructionsEmailSentAt
    FROM Payment WHERE method = ?
      AND status = ?
      AND bankInstructionsEmailSentAt IS NULL
    ORDER BY createdAt DESC LIMIT 50`, "BANK_TRANSFER", "AWAITING_BANK_TRANSFER");
  console.log(JSON.stringify(rows, (_, value) => typeof value === "bigint" ? value.toString() : value));
})().finally(() => db.$disconnect());'
```

For a Partner delivery, `acceptedAt` and `providerMessageId` record provider
acceptance. For bank instructions, `bankInstructionsEmailSentAt` records it.
`failureMessage` and the first-attempt timestamp explain pending Partner
deliveries; Railway web logs include bank-instructions send failures. The
provider idempotency keys are `partner-commission-confirmation:<delivery-id>`
and `pay-later-bank-instructions:<payment-id>`.

Automatic retries stop 23 hours after the first uncertain provider attempt,
before the provider's 24-hour idempotency window ends. Reconcile the delivery
with the email provider before considering any manual retry or record change.
An accepted email can be duplicated if an uncertain send is retried after that
window. Never mark a payment or commission paid to resolve an email issue.
