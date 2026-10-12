# Clean SQLite initialization and future launch reset

Status: local development path only. No existing Railway database has been migrated, reset, or inspected through this procedure.

## Two migration lineages

- `prisma/migrations/` retains every historical SQL file and its checksum. Existing databases must continue on that lineage until their actual `_prisma_migrations` rows and schema are examined on a consistent snapshot. The historical chain cannot initialize an empty database: `20260730143000_structured_business_addresses` alters `BusinessSubmission` before any checked-in migration creates it. Appending a baseline to that directory would not fix the first failure.
- `prisma/clean-install/migrations/20261012190000_current_schema_baseline/` is a separate, versioned baseline generated from the complete current `prisma/schema.prisma`. It includes the Phase 1–3 cash-out models and subsequent local dispatch and bank-return evidence models. `20261012190100_unresolved_withdrawal_guard` adds the partial unique index Prisma cannot express, preventing two unresolved withdrawals for one Partner. Future clean-install migrations must be added to this lineage and rehearsed separately. Never merge its ledger with the historical ledger by renaming or editing applied files.
- `npm run db:init-clean -- /absolute/path/to/new.db` is explicit and refuses a path that already exists. It checks that the baseline SQL still matches the Prisma schema, creates an empty SQLite file exclusively, then runs Prisma Migrate against an isolated temporary schema directory containing only the clean-install lineage. It does not seed data and is never called by `scripts/start-hosted.sh`.
- `npm run db:deploy` now applies the historical migration directory without seeding. `npm run db:deploy-and-seed` and `npm run db:seed` remain explicit development operations. Never run `db:reset` or `db:push` against an existing Railway database.

For a disposable local rehearsal, use a new absolute path, then check `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, the migration ledger, and `prisma migrate diff --from-url file:/absolute/path/to/new.db --to-schema-datamodel prisma/schema.prisma --exit-code`. A zero exit code means Prisma sees no datamodel difference. The automated `clean-database-init.test.ts` also checks every Prisma model table, representative auth, business, membership, payment, commission, payout, withdrawal, and audit relationships, and refusal of an existing path.

This path does **not** make the existing Railway database upgrade safe. A clean-install database has its own two-migration ledger; a historical database may have a different ledger or none. Production transition requires a consistent read-only snapshot, checksum and object inventory, a tailored non-destructive migration plan, and approval after rehearsal on a disposable copy. The hosted startup remains on the historical path and must not be pointed at a clean-install database without a reviewed deployment procedure.

## Future launch-reset plan — not authorized for execution

1. Freeze writes and background jobs only in an approved maintenance window. Inventory in-flight Stripe/PayPal requests, webhook queues, cron jobs, and manual bank transfers first.
2. Obtain a consistent SQLite online backup of the mounted database, including WAL state. Record a hash, verify restore to a separate disposable file, run integrity and foreign-key checks, and retain secure access to the original backup.
3. Initialize a **new** database using the clean-install path. Confirm that it has no users, businesses, submissions, payments, commissions, payouts, or withdrawal requests. Do not replace the old file in place.
4. Recreate the Admin account through an approved secure enrollment flow, or migrate only the minimum required Admin identity and authentication relationships after inspecting Account, Session, password-reset, legal acceptance, session-version, verification, and role data. Rotate sessions and credentials as approved. Never print password hashes or credentials in reports.
5. Do not migrate test businesses, non-Admin users, memberships, submissions, or financial history. Treat test uploads and images as a separate inventory; remove or quarantine orphaned files only after the new database references are verified.
6. Disable or retarget old webhook destinations and background jobs before the switch. Prevent old Stripe/PayPal events or scheduler runs from recreating test records. Verify live versus test provider keys and webhook secrets without exposing their values.
7. Rehearse the application against the new database with cash-out requests and processing disabled. Verify sign-in, Admin access, business listing flows, memberships, localization, Stripe/PayPal configuration, migration ledger, and financial zero balances.
8. Make the database switch only under a separate approved deployment and rollback plan. Retain the old database and backup until the new site, provider webhooks, jobs, and data integrity are verified. Rollback must account for any external provider activity after the cutover.

No step above authorizes a current data reset, volume change, production migration, or live payout.
