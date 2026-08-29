# Salento Local legal placeholders

The legal pages and consent flows currently use draft content and must be reviewed before production launch by:

- an Italian lawyer for terms and consumer/commercial wording;
- a privacy professional for GDPR and cookie disclosures;
- a commercialista if tax, invoicing, or payout wording needs confirmation.

Complete these placeholders before launch:

- `[LEGAL BUSINESS NAME]`
- `[REGISTERED ADDRESS]`
- `[PARTITA IVA]`
- `[PRIVACY CONTACT EMAIL]`
- `[BUSINESS CONTACT EMAIL]`
- `[DATA RETENTION PERIOD]`
- `[AUTH SESSION COOKIE NAME - VERIFY IN PRODUCTION]`
- `[AUTH CSRF COOKIE NAME - VERIFY IN PRODUCTION]`
- `[AUTH CALLBACK COOKIE NAME - VERIFY IN PRODUCTION]`

Operational checks still required before launch:

- Verify the exact Auth.js cookie names and durations in the production environment, including secure prefixes.
- Confirm the actual production email provider if SMTP is used instead of Resend.
- Confirm hosting, logging, and infrastructure retention practices outside the application database.
- Confirm whether any non-essential analytics, advertising, or profiling tools will be added later. If they are, the site must block them until valid consent is recorded.
