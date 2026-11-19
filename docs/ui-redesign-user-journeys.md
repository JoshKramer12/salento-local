# Salento Local — UI redesign user journeys

**Baseline:** production `main` at `c2249fd6bd717652175b1f9759b7bf85ed950b05`. IDs refer to [the master checklist](ui-redesign-master-checklist.md). Routes and branches were traced from `src/app`, client components, navigation, and actions. The five safe public/auth representative screens marked `Visual: Yes` in the checklist were inspected in production; all gated flows below are source-verified only. No account, email, payment, or data-changing journey was executed.

## 1. Tourist browsing the directory

`PUB-001` Homepage → `PUB-003` Towns index → `PUB-004` Town detail → `PUB-007` Business listing. Alternative: Homepage → `PUB-005` Localities index → `PUB-006` Locality detail → listing. The town/locality detail embeds `business-explorer` rather than creating a new route for each category. Header/mobile drawer and footer expose `/directory` and `/explore`; both use `PUB-002`.

## 2. Visitor searching for a business

`PUB-001` header/hero search suggestions (`UI-009`) → selected suggestion `PUB-007`, or submitted query `PUB-002` → filters/town selector (`UI-007`, `UI-010`) → listing `PUB-007`. A zero-result state stays inside `PUB-002`; grid/list and sort are variants. A listing may expose reviews, gallery and claim CTA according to data and eligibility.

## 3. Business Owner creating an account

`PUB-001` or `AUTH-001` chooser → `/signup/business` redirect → `AUTH-003` credentials → `AUTH-004` details → `AUTH-008` complete profile when still incomplete → `OWNER-001` dashboard. Existing-account path: `AUTH-007` login → `AUTH-008` if needed → dashboard. Existing listing access follows journey 13 instead. Terms and privacy links open `PUB-009` and `PUB-010`.

## 4. Business Owner publishing a new business

`OWNER-001` or `OWNER-002` → `/publish`: `OWNER-006` business/address → `OWNER-007` public contact → `OWNER-008` private owner contact when not merged into contact → `OWNER-009` about → `OWNER-010` hours → `OWNER-011` photos → `OWNER-012` review → `PAY-001` owner confirmation → `PAY-002` agreement → `PAY-003` signature → `PAY-004` pay-now/later decision → `PAY-005` renewal preference → `PAY-006` method.

Branches: online → `PAY-007` QR/Checkout handoff → `PAY-012` pending or `PAY-013` confirmed; canceled Checkout → `PAY-011`. Bank transfer → `PAY-008` waiting → `PAY-009` after confirmed. Pay Later → `PARTNER-015` invitation composer → `PARTNER-016` accepted or `PARTNER-017` queued, then journey 11. Public financial hold → `PAY-010`. Save & Exit returns to `OWNER-002`; `SPECIAL-007` is a submission verification gate where required. Final payment can be completed using `PAY-014` for an owner without email. The six collection screens are shared with Partner submissions and are counted once.

## 5. Business Owner editing an existing business

`OWNER-001` or `OWNER-002` or public listing `PUB-007` → `/businesses/[slug]/edit`: `OWNER-006` → `OWNER-007` → optional `OWNER-008` → `OWNER-009` → `OWNER-010` → `OWNER-011` → save/view `PUB-007`. The Owner edit path stops after photos and does not create a new payment. Direct `?step=` links from dashboard quick actions can open hours/photos. An Admin sees `ADMIN-008`, a separate one-page legacy editor.

## 6. Business Owner renewing or reactivating membership

`OWNER-001` select business (`UI-011`) → membership state: active, grace, expired, refunded, or legacy. Manual renewal/reactivation action → `PAY-017` embedded card form → `PAY-018` confirmed or `PAY-019` pending or `PAY-020` unavailable or `PAY-021` held. Bank transfer action → `PAY-022` instructions → dashboard awaiting confirmation. Failed automatic renewal recovery may reach `PAY-023`. Automatic renewal setup/stop is controlled from `OWNER-001`; stopping opens `UI-003`. Payment history and documents: `OWNER-003` picker if no business selected → `OWNER-004`; unavailable receipt/agreement → `SPECIAL-013`/`SPECIAL-014`. Initial refund branches from the dashboard to `SPECIAL-015`–`SPECIAL-026`. These are existing-membership flows, not new-business publication.

## 7. Local Partner creating an account

`PUB-008` Earn with us or `AUTH-001` chooser → `/signup/partner` redirect → `AUTH-005` credentials → `AUTH-006` details → `AUTH-008` if profile incomplete → `/partner/start` routing → `PARTNER-001` → `PARTNER-002` → `PARTNER-003` → `PARTNER-004`. Partner details may be completed/edited at `PARTNER-010`, then `PARTNER-011` payout choice → `PARTNER-012` selected method or Stripe Connect redirect. Skipping payout setup returns to Partner dashboard; payout readiness remains a dashboard variation.

## 8. Local Partner onboarding a business

`PARTNER-005` first-business dashboard or `PARTNER-006` standard dashboard → `/publish`: `OWNER-006` → `OWNER-007` → `OWNER-008` → `OWNER-009` → `OWNER-010` → `OWNER-011` → `OWNER-012` review → `PARTNER-014` handoff. Draft save/resume is in `PARTNER-007`. The Partner guide is `PARTNER-009`; the four first-run tutorial screens can replay from `/partner/onboarding?guide=1` without adding new screen IDs.

## 9. Local Partner handing off to the owner

`PARTNER-014` → pay now: `PAY-001` confirmation → `PAY-002` agreement → `PAY-003` signature → `PAY-004`–`PAY-006` payment steps. Pay Later: `PARTNER-015` email composer → `PARTNER-016` accepted or `PARTNER-017` pending retry; available WhatsApp sharing is an action on the accepted screen. Missing owner email/required fields returns to `OWNER-008` or another collection step. An owner without email follows the QR/token path (`PAY-007` → `PAY-014`) and later owner-access invitation flow (`SPECIAL-008` onward). Do not redesign the Partner WhatsApp handoff as part of the owner's payment-success screen.

## 10. Owner completing payment

After confirmation/agreement/signature: `PAY-004` → `PAY-005` auto/manual → `PAY-006` online/bank. Online: `PAY-007` → hosted Stripe Checkout (external, no local UI ID) or `PAY-014` embedded token payment → `PAY-012` pending → `PAY-013` confirmed; canceled → `PAY-011`; invalid token → `PAY-016`. Bank: `PAY-008` awaiting bank confirmation → `PAY-009` confirmed. The `PAY-013` screen can show listing live or preparing; that is one template. Financial hold shows `PAY-010`.

## 11. Owner using Pay Later

Invitation sent from `PARTNER-015`–`PARTNER-017` → `/pay-later#invite=...`. Invalid/expired → `SPECIAL-012`. Valid → `PAY-024` email code → `PAY-025` review → `PAY-026` agreement → `PAY-027` signature → `PAY-028` renewal choice → `PAY-029` method → `PAY-030` online QR or `PAY-031` bank instructions. With financial hold, a saved choice yields `PAY-032`; paid status yields `PAY-033`; a previously chosen method yields `PAY-034` resume. Declining yields `PAY-035`. Owner-originated and Partner-originated invitations vary their copy on the same screens. OTP and delivery were not triggered for this audit.

## 12. Owner claiming an existing listing

`PUB-007` eligible claim CTA → `AUTH-007` login or `AUTH-001` signup when needed → `SPECIAL-002` preselected listing. Entering `/claim` directly → `SPECIAL-001` search → `SPECIAL-002` confirmation. Eligible email verification → `SPECIAL-005` code → `SPECIAL-006` success → `OWNER-001` or edit wizard. Already managed → `SPECIAL-003`; no claimable email → `SPECIAL-004`; missing/expired claim redirects to `/claim`. The eligibility CTA is absent for ineligible public listings.

## 13. Owner recovering account access

`AUTH-007` → `AUTH-012` request existing-business access → invitation `SPECIAL-008` create account → `OWNER-013` details → `OWNER-001` dashboard. Existing user follows invitation login route → `AUTH-007` → dashboard. Wrong signed-in account → `SPECIAL-009`; expired invitation → `SPECIAL-010` request new link; already used → `SPECIAL-011` login. Password route: `AUTH-009` forgot password → `AUTH-010` valid reset, or `AUTH-011` expired reset → request again. No invitation or reset email was sent during this audit.

## 14. Local Partner viewing commissions and payouts

`PARTNER-006` dashboard → `PARTNER-008` earnings/payouts → `PARTNER-011` payout method picker → `PARTNER-012` method details or external Stripe Connect setup. The dashboard shows payable, pending, test/unverified, and payout-readiness variations. `PARTNER-013` appears when updated Partner terms need acknowledgement. `PARTNER-007` shows submissions and invitation states. Settings use shared `OWNER-005`.

## 15. Administrator managing the platform

`AUTH-007` → `ADMIN-001` dashboard. Branches: `ADMIN-002` all submissions/businesses → `ADMIN-008` edit or `/publish?mode=admin` shared collection `OWNER-006`–`OWNER-012` → `ADMIN-009` finish; `ADMIN-003` user list → `ADMIN-004` user detail; `ADMIN-005` membership list → `ADMIN-006` support detail; `ADMIN-007` Partner payout administration. `OWNER-005` settings includes Admin role controls. Invalid records use `SPECIAL-028` not-found. Admin publication and payment support controls were inspected only in source.

## Cross-cutting branches and verification limits

- EN/IT is a locale variation across shared templates, not a second screen count.
- Desktop/mobile reflow is documented in the checklist and shared-component inventory; the mobile drawer (`UI-001`) is a separate small UI element.
- `AUTH-005`–`AUTH-006` and `OWNER-006`–`OWNER-012` are cross-referenced by Partner journeys without duplicate counting.
- The isolated Pay Later branch tips are ancestors of the production source baseline. There are no branch-only UI screens in this comparison. The separate `pay-later-test` Railway deployment has no linked source commit and its browser endpoint required credentials; staging-only differences remain unverified. Production feature flags and financial holds can still make a source-implemented state inaccessible.
- Browsing and code inspection cannot prove that every data-dependent branch is currently reachable. Screens marked `No (code)` in the checklist need controlled visual QA during redesign.
