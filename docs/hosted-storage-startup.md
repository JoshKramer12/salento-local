# Hosted storage startup

`scripts/start-hosted.sh` is for an **established** hosted installation. It requires
the existing SQLite database and uploads on a real `/data` mount before it changes
the filesystem or invokes Prisma. It never provisions a blank database. Local
development continues to use `npm run dev` and its disposable local database.

The preflight verifies the `/data` mount, configured roots and database URL,
symlink-free database path, nonempty regular SQLite file, read-only SQLite
`quick_check(1)`, essential tables and completed migration history, existing
uploads directories, public uploads link, and Prisma executable. It uses the
SQLite CLI's `-readonly` mode; `mode=ro` on a Prisma SQLite URL was tested with
Prisma 6.19.3 and did **not** prevent a write. The Docker image installs the
SQLite CLI. The database device/inode and all storage checks are verified again
after `prisma migrate deploy` before Next starts.

The normal hosted startup no longer copies a bundled database or uploads,
creates missing storage directories, uses `prisma db push`, or automatically
changes migration history. A failed check or migration stops startup with a
nonzero exit. `.dockerignore` excludes local databases, uploads, and env files
from local Docker build contexts.

## Historical P3009 recovery

The previous script automatically marked
`20260714171000_add_legal_acceptances` as applied when `migrate deploy` logged
P3009 for that migration, then retried. That narrowly addressed a known
historical failed-migration record, but did not verify the table, indexes,
constraints, or migration ledger before changing history. On 27 October 2026,
read-only `prisma migrate status` reported all 28 migrations up to date in both
production and Pay Later; neither currently needs this automatic recovery.

If P3009 recurs, keep the service stopped. Inspect the failed migration and
actual schema read only, verify an independently restorable backup, and prepare
an environment-specific recovery procedure for separate authorization. Do not
run `migrate resolve` as a normal restart step.

## First-time provisioning interface (design only)

A first installation needs a separate operator-invoked provisioning command,
not a missing-file fallback in `start-hosted.sh`. The current migration chain
cannot initialize a blank SQLite database: an isolated run reached P3018 at
`20260730143000_structured_business_addresses` because `BusinessSubmission`
was absent. No provisioning command is implemented in this change.

The proposed interface is a future `provision-hosted-storage` command requiring
an explicit environment ID, volume ID, `/data` target, reviewed schema-only
baseline artifact, and confirmation of initialization. It must prove that the
volume is mounted, the target has no database or uploads to overwrite, and the
baseline has valid schema and migration history. It should create and verify a
separate backup/restore test before the normal hosted start path is enabled.
Provisioning a Railway environment remains a separately authorized operation.
