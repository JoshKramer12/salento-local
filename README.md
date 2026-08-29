# Salento Directory

A full-stack prototype for a hyper-local directory website focused on Salento, Puglia, Italy.

The site is designed to help tourists and locals discover towns, restaurants, cafes, beaches, shops, mechanics, pharmacies, plumbers, activities, and practical local information in one place.

## Stack

- Next.js 16 + App Router
- TypeScript
- Prisma ORM
- SQLite for the local prototype database
- Tailwind CSS 4
- Reusable town-by-town enrichment scripts for legal public data ingestion

## What is included

- Homepage with hero search, category cards, featured towns, featured businesses, and a map preview
- Town listing page
- Individual town pages with overview, grouped categories, filters, nearby places, reviews, and practical information
- Locality listing page for smaller places inside municipalities
- Individual locality pages for marinas, frazioni, hamlets, and similar sub-municipal places
- Directory search page with search, town/category/rating/open-now filters, and sorting
- Individual business pages with photos, tags, hours, contact info, trust badges, saved review UI, and saved listing-feedback flows
- Town-by-town enrichment pipeline with dry-run, write mode, reports, and SQLite backups
- Local database seeded with:
  - 131 canonical municipalities across the Salento scope requested for Lecce, Brindisi, and Taranto
  - 2 legacy aliases mapped to `Presicce-Acquarica`
  - 388 localities such as Porto Badisco, Torre dell'Orso, and Santa Maria di Leuca
  - 11 core directory categories
  - 10,571 imported businesses and places from structured public map data after removing obviously inactive records

## Data sources used in this prototype

The prototype does not scrape Salento.it.

Instead, the seed script imports data from structured public sources that can later be replaced or supplemented with official APIs and verified submissions:

- Wikimedia / Italian Wikipedia summaries for town descriptions and coordinates
- Wikidata for structured municipality details such as population, area, elevation, and official websites when available
- OpenStreetMap via Overpass for directory listings such as restaurants, cafes, pharmacies, groceries, mechanics, tourism places, beaches, and other mapped services

## Enrichment workflow

The project now includes a reusable `scripts/enrichment/` pipeline for town-by-town data improvement using only free and legally safer public sources.

Current adapter set:

- `osmAdapter.ts`
- `wikidataAdapter.ts`
- `wikipediaAdapter.ts`
- `municipalityAdapter.ts`
- `officialWebsiteAdapter.ts`

Shared utilities:

- `normalize.ts`
- `dedupe.ts`
- `coverageReport.ts`
- `confidence.ts`
- `backup.ts`
- `reporting.ts`

### What the pipeline does

For one town at a time it will:

1. load the municipality, aliases, localities, and existing businesses
2. query approved sources
3. normalize and score candidate listings
4. deduplicate candidates
5. compare them to existing town records
6. detect global source-key conflicts
7. produce a dry-run report before writing
8. back up the SQLite database before write mode
9. write safe inserts/updates with source metadata
10. save JSON and Markdown reports under `reports/`

### Commands

Dry run one town:

```bash
npm run enrich:town -- --town "Martano" --dry-run
```

Write one town:

```bash
npm run enrich:town -- --town "Martano" --write
```

Dry run all towns:

```bash
npm run enrich:all -- --dry-run
```

Create a database backup:

```bash
npm run data:backup
```

Generate a cross-town coverage report:

```bash
npm run data:coverage
```

Validation commands:

```bash
npm run lint
npm run typecheck
npm run prisma:validate
```

### Reports

Generated reports are written to:

```bash
reports/enrichment/<town-slug>/
reports/coverage/
reports/backups/
```

### Current pilot status

The first enrichment pilot was run on `Martano` because it had only `5` listings for a town of roughly `9,151` people.

Pilot outcome:

- dry run projected `5 -> 22` listings before conflict checks
- safe write-mode run completed at `5 -> 19` listings
- source metadata was written for all touched Martano records
- several OSM source-key conflicts were discovered, showing that some legacy records are likely assigned to the wrong town

This is an important result: the old broad import was not just incomplete, it also occasionally mis-assigned listings across municipalities. The new pipeline now detects and reports those conflicts before creating duplicates.

## Google Maps / Places note

This prototype does not scrape Google Maps pages or copy data out of the Google Maps consumer product.

If you want Google place data in a production-ready version, the compliant path is to integrate the Google Places API or other licensed Google Maps Platform services with your own API key, attribution, billing, and terms-compliant usage.

## Claim verification setup

Business claims now support `Email` and `SMS` verification. The user chooses one method, receives a 6-digit code, and the code expires after `15` minutes.

### Required `.env` values

```bash
VERIFICATION_METHODS=email,sms
DEFAULT_PHONE_COUNTRY=IT

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Salento Local <no-reply@example.com>"

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_PHONE=
```

### Email via SMTP

1. Choose any SMTP-compatible provider.
2. Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`.
3. Port `465` is treated as implicit TLS. Port `587` uses STARTTLS.

### SMS via Twilio

1. Create or use an existing Twilio phone number with SMS enabled.
2. Copy your `Account SID`, `Auth Token`, and sending phone number.
3. Add them to `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_PHONE`.
4. Phone numbers are normalized to `E.164` before sending. The project defaults local numbers to `IT` unless `DEFAULT_PHONE_COUNTRY` is changed.

### Development behavior

- In local development, if SMTP or Twilio env vars are missing, the app will not crash.
- Instead, it logs the 6-digit code to the server console so you can still test the flow safely.

### Production behavior

- In production, missing SMTP config will throw a clear `smtp_configuration_missing` error.
- In production, missing Twilio config will throw a clear `twilio_sms_configuration_missing` error.

### WhatsApp fallback kept for later

The old WhatsApp delivery code is still in the codebase behind provider config so it can be re-enabled later without rewriting the verification system.

Optional WhatsApp env values if you want to revisit Meta later:

```bash
WHATSAPP_VERIFICATION_PROVIDER=meta
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_GRAPH_VERSION=v23.0
META_WHATSAPP_TEMPLATE_NAME=
META_WHATSAPP_CLAIM_TEMPLATE_NAME=
META_WHATSAPP_SUBMISSION_TEMPLATE_NAME=
META_WHATSAPP_TEMPLATE_LANGUAGE=en_US
META_WHATSAPP_TEMPLATE_LANGUAGE_EN=en_US
META_WHATSAPP_TEMPLATE_LANGUAGE_IT=it_IT
```

## Important data note

This is still a prototype dataset, not an authoritative registry of every real-world business in Salento.

What the current seed does well:

- populates the full municipality scope requested
- stores richer town metadata
- adds real Wikipedia thumbnail images for municipality cards and page heroes
- creates locality-level pages beneath municipalities for places that are not separate comuni
- imports a large volume of real mapped places from open geographic data
- scores listings by source coverage and marks them as open-data or unverified
- skips clearly inactive map records and supports community stale/edit reporting
- saves prototype reviews and listing updates directly into the local Prisma database
- keeps the schema ready for future verified sources such as Google Places API, municipality open data, chamber of commerce data, or direct business submissions

Current limitations:

- not every municipality has complete coverage for every business type
- some imported places have limited fields depending on what exists in OpenStreetMap
- locality images often fall back to town imagery or branded placeholders when no structured source photo exists
- ratings and reviews are local prototype data rather than live third-party review ingestion
- the first enrichment pass relies mainly on OpenStreetMap plus town metadata sources; some official tourism or registry sources are still skipped until their reuse position is clearer
- a few legacy rows in the old database appear to be assigned to the wrong town and now require town-by-town correction
- imported records should still be reviewed before production use

## Municipality alias handling

The requested list includes `Acquarica del Capo` and `Presicce`.

Those are former comuni that were merged into `Presicce-Acquarica` on May 15, 2019. In this prototype they are preserved as searchable aliases and redirect to the canonical `Presicce-Acquarica` town record.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create the local SQLite database, apply migrations, and run the import seed:

```bash
npm run db:deploy
```

3. Start the development server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Useful scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run prisma:validate
npm run db:push
npm run db:seed
npm run db:reset
npm run db:deploy
npm run enrich:town -- --town "Martano" --dry-run
npm run enrich:town -- --town "Martano" --write
npm run enrich:all -- --dry-run
npm run data:coverage
npm run data:backup
```

## Database location

The local SQLite database lives in:

```bash
prisma/dev.db
```

## Prisma workflow

- Schema: `prisma/schema.prisma`
- Seed script: `prisma/seed.ts`
- Municipality scope list: `prisma/salento-scope.ts`
- Migrations: `prisma/migrations/`

If you change the schema during local development:

```bash
npm run db:push
npm run db:seed
```

If you want to rebuild the prototype dataset from scratch:

```bash
npm run db:reset
```

## Project structure

```text
src/app
src/components
src/lib
prisma/schema.prisma
prisma/seed.ts
prisma/salento-scope.ts
prisma/migrations
```

## Prototype pages

- `/`
- `/towns`
- `/towns/[slug]`
- `/localities`
- `/localities/[slug]`
- `/directory`
- `/businesses/[slug]`

## Verification

The app has been checked with:

```bash
npm run lint
npm run build
```

The prototype was also checked on `http://localhost:3000` after reseeding to confirm:

- homepage loads correctly
- business pages render trust badges and richer image fallbacks
- review submissions persist and update business ratings
- listing feedback submissions persist in the database

The enrichment workflow was checked with:

```bash
npm run lint
npm run typecheck
npm run prisma:validate
npm run enrich:town -- --town "Martano" --dry-run
npm run enrich:town -- --town "Martano" --write
npm run data:coverage
```
