# Salento Local — UI redesign master checklist

**Source baseline:** production `main` at `c2249fd6bd717652175b1f9759b7bf85ed950b05` (31 October 2026). This is a source audit plus a small, safe production browser sample. No account, payment, email, or data mutation was performed.

**TOTAL UNIQUE FULL PAGES AND SCREENS CONFIRMED IN PRODUCTION SOURCE: 125**

| Category | Count |
|---|---:|
| Public | 11 |
| Authentication | 12 |
| Business Owner | 13 |
| Local Partner | 17 |
| Administrator | 9 |
| Payment and membership | 35 |
| Special/conditional | 28 |

**Reconciliation:** 11 + 12 + 13 + 17 + 9 + 35 + 28 = 125. A screen shared by roles or categories has one ID; cross-references do not add to the total.

## Counting rules and evidence

- A unique full-screen route template or substantially replacing client state is counted once. Individual towns, localities, businesses, query filters, language translations, responsive reflows, inline banners and cards are variations.
- `Production` means present in the deployed `main` source, not that every gated state has been exercised with production data. The Pay Later branch tips examined (`feature/pay-later-owner-invitations`, `feature/pay-later-public-invitations-sandbox-boundary`, `feature/bank-transfer-partner-email-retry`) are ancestors of `main`; they add **zero branch-only screens** at this baseline. The separate `pay-later-test` Railway web deployment is successful but has no linked source commit; its browser endpoint required credentials, so staging-only differences remain unverified. Financial holds and eligibility still control reachability.
- `Yes` in Visual means the representative production screen was loaded and inspected in a browser. `No` means the screen is confirmed from source but not visually verified. A screen can be source confirmed and still require an authenticated or data-dependent walkthrough.

## Route and state cross-check

- **62** `page.tsx` route patterns exist in `src/app`; `src/app/not-found.tsx` is a shared 404 screen outside those 62. Routes in `src/app/api`, `robots.ts`, `sitemap.ts`, and redirect-only `route.ts` files are not page routes.
- `/explore` is an alias of `/directory`. `/signup/business`, `/signup/partner`, `/partner/start`, `/onboarding/business`, and `/claim/email` redirect rather than render new designs. Valid receipt/agreement routes redirect to documents; their unavailable states are counted. `/pay/stripe/[checkoutSessionId]` redirects to Stripe Checkout and has no local page design.
- Distinct URL route patterns: **62**. Full-screen client states increase the screen total beyond the route count. The route patterns include aliases and redirect-only routes.

### Alias and redirect route source files

| Route | Source | Behavior |
|---|---|---|
| `/explore` | `src/app/explore/page.tsx` | Renders `/directory` template (`PUB-002`). |
| `/pay-later` | `src/app/pay-later/page.tsx` | Mounts invitation shell (`PAY-024`–`PAY-035`, `SPECIAL-012`). |
| `/publish` | `src/app/(account)/publish/page.tsx` | Mounts shared publishing wizard (`OWNER-006` onward). |
| `/partner/guide` | `src/app/(account)/partner/guide/page.tsx` | Mounts `PARTNER-009`. |
| `/partner/onboarding` | `src/app/(account)/partner/onboarding/page.tsx` | Mounts four-screen tutorial (`PARTNER-001`–`004`). |
| `/partner/start` | `src/app/(account)/partner/start/page.tsx` | Redirects by onboarding state. |
| `/onboarding/business` | `src/app/(account)/onboarding/business/page.tsx` | Legacy redirect to `/publish`. |
| `/claim/email` | `src/app/(account)/claim/email/page.tsx` | Redirects approved claim to success. |

## Master checklist

### A. Public website

| Done | ID | Screen | Category | Route / state | Source | Role | Desktop / mobile | Reach condition | Source | Visual | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [ ] | PUB-001 | Homepage | Public | / | src/app/page.tsx | Public | Both | Open site | Production | Yes | Featured towns, localities, categories and listings. |
| [ ] | PUB-002 | Directory and search results | Public | /directory | src/app/directory/page.tsx; src/components/business-explorer.tsx | Public | Both | Any query/filter | Production | Yes | /explore renders this same template; category/search/no-result/grid/list are variants. |
| [ ] | PUB-003 | Towns index | Public | /towns | src/app/towns/page.tsx | Public | Both | Open towns | Production | No (code) |  |
| [ ] | PUB-004 | Town detail and embedded explorer | Public | /towns/[slug] | src/app/towns/[slug]/page.tsx; src/components/business-explorer.tsx | Public | Both | Valid town slug | Production | Yes | Category and result states reuse explorer. |
| [ ] | PUB-005 | Localities index | Public | /localities | src/app/localities/page.tsx | Public | Both | Open localities | Production | No (code) |  |
| [ ] | PUB-006 | Locality detail and embedded explorer | Public | /localities/[slug] | src/app/localities/[slug]/page.tsx; src/components/business-explorer.tsx | Public | Both | Valid locality slug | Production | No (code) | Locality categories, attractions and listings vary by data. |
| [ ] | PUB-007 | Business listing detail | Public | /businesses/[slug] | src/app/businesses/[slug]/page.tsx; src/components/business/business-hero.tsx | Public | Both | Public eligible listing | Production | Yes | Claim CTA only when eligible; reviews, hours, gallery and contact vary. |
| [ ] | PUB-008 | Earn with us | Public | /earn | src/app/earn/page.tsx | Public | Both | Open partner marketing | Production | No (code) |  |
| [ ] | PUB-009 | Terms | Public | /terms | src/app/terms/page.tsx; src/components/legal/legal-document-page.tsx | Public | Both | Open legal page | Production | No (code) |  |
| [ ] | PUB-010 | Privacy | Public | /privacy | src/app/privacy/page.tsx; src/components/legal/legal-document-page.tsx | Public | Both | Open legal page | Production | No (code) |  |
| [ ] | PUB-011 | Cookies | Public | /cookies | src/app/cookies/page.tsx; src/components/legal/legal-document-page.tsx | Public | Both | Open legal page | Production | No (code) |  |

### B. Authentication

| Done | ID | Screen | Category | Route / state | Source | Role | Desktop / mobile | Reach condition | Source | Visual | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [ ] | AUTH-001 | Account type chooser | Authentication | /signup | src/app/(account)/signup/page.tsx | Visitor | Both | Signed out | Production | No (code) | Business and Partner cards. |
| [ ] | AUTH-002 | Personal visitor signup | Authentication | /signup/personal | src/app/(account)/signup/[audience]/page.tsx; src/components/account/signup-form.tsx | Visitor | Both | Signed out; audience=personal | Production | No (code) | /signup/business and /signup/partner redirect to guided flows. |
| [ ] | AUTH-003 | Business Owner signup: credentials | Authentication | /signup/business/join | src/app/(account)/signup/business/join/page.tsx; src/components/account/partner-entry-signup-form.tsx | Owner | Both | Signed out | Production | No (code) | Owner account, step 1. |
| [ ] | AUTH-004 | Business Owner signup: details | Authentication | /signup/business/details | src/app/(account)/signup/business/details/page.tsx; src/components/account/local-partner-onboarding-form.tsx | Owner | Both | Pending owner signup | Production | No (code) | Owner account, step 2. |
| [ ] | AUTH-005 | Local Partner signup: credentials | Authentication | /partner/join | src/app/(account)/partner/join/page.tsx; src/components/account/partner-entry-signup-form.tsx | Partner | Both | Signed out | Production | No (code) | Partner account, step 1. |
| [ ] | AUTH-006 | Local Partner signup: details | Authentication | /partner/join/details | src/app/(account)/partner/join/details/page.tsx; src/components/account/local-partner-onboarding-form.tsx | Partner | Both | Pending partner signup | Production | No (code) | Partner account, step 2. |
| [ ] | AUTH-007 | Login | Authentication | /login | src/app/(account)/login/page.tsx; src/components/account/login-form.tsx | All | Both | Signed out | Production | Yes | Invitation context changes copy and redirect. |
| [ ] | AUTH-008 | Complete profile | Authentication | /complete-profile | src/app/(account)/complete-profile/page.tsx; src/components/account/complete-profile-form.tsx | Signed-in | Both | Incomplete profile | Production | No (code) | Role/redirect variations. |
| [ ] | AUTH-009 | Forgot password request | Authentication | /forgot-password | src/app/(account)/forgot-password/page.tsx; src/components/account/password-reset-forms.tsx | Signed-out | Both | Open reset | Production | No (code) | Owner invite may lock email. |
| [ ] | AUTH-010 | Reset password: valid token | Authentication | /reset-password/[token] | src/app/(account)/reset-password/[token]/page.tsx; src/components/account/password-reset-forms.tsx | Signed-out | Both | Valid reset token | Production | No (code) |  |
| [ ] | AUTH-011 | Reset password: expired token | Authentication | /reset-password/[token] | src/app/(account)/reset-password/[token]/page.tsx | Signed-out | Both | Invalid/expired reset token | Production | No (code) | Full-page recovery state. |
| [ ] | AUTH-012 | Request existing business access | Authentication | /manage-business | src/app/(account)/manage-business/page.tsx; src/components/account/owner-access-forms.tsx | Owner | Both | Need access to existing listing | Production | No (code) | Request link by known email. |

### C. Business Owner

| Done | ID | Screen | Category | Route / state | Source | Role | Desktop / mobile | Reach condition | Source | Visual | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [ ] | OWNER-001 | Owner dashboard and membership centre | Business Owner | /dashboard | src/app/(account)/dashboard/page.tsx; src/components/account/business-owner-dashboard-client.tsx | Owner | Both | Completed Owner account | Production | No (code) | Membership active/grace/expired/refunded/legacy and zero/multiple listings are variations. |
| [ ] | OWNER-002 | My businesses, drafts and submissions | Business Owner | /dashboard/businesses | src/app/(account)/dashboard/businesses/page.tsx; src/components/account/submission-list.tsx | Owner | Both | Completed Owner account | Production | No (code) | Draft resume/delete and paid/pending status cards. |
| [ ] | OWNER-003 | Payment history: business picker | Business Owner | /dashboard/payment-history | src/app/(account)/dashboard/payment-history/page.tsx | Owner | Both | No business selected | Production | No (code) | Full-page picker; empty when no owned business. |
| [ ] | OWNER-004 | Payment history: selected business | Business Owner | /dashboard/payment-history?business=[slug] | src/app/(account)/dashboard/payment-history/page.tsx | Owner | Both | Owned business selected | Production | No (code) | Receipts, agreements, refund status vary. |
| [ ] | OWNER-005 | Account settings | Business Owner | /settings | src/app/(account)/settings/page.tsx | All signed-in | Both | Completed account | Production | No (code) | Profile, locale, password and account actions; Admin/Partner sections vary. |
| [ ] | OWNER-006 | Publish/edit: business and address | Business Owner | /publish or /businesses/[slug]/edit | src/components/account/publish-form.tsx | Owner/Partner | Both | Start new or edit; step=business | Production | No (code) | Admin publication uses same shell; address autocomplete. |
| [ ] | OWNER-007 | Publish/edit: public contact | Business Owner | /publish or /businesses/[slug]/edit | src/components/account/publish-form.tsx | Owner/Partner | Both | step=contact | Production | No (code) | Owner flow can merge private owner contact here. |
| [ ] | OWNER-008 | Publish/edit: private owner contact | Business Owner | /publish or /businesses/[slug]/edit | src/components/account/publish-form.tsx | Owner/Partner | Both | step=owner; not skipped | Production | No (code) | Skipped when owner details collected with contact. |
| [ ] | OWNER-009 | Publish/edit: about and offerings | Business Owner | /publish or /businesses/[slug]/edit | src/components/account/publish-form.tsx | Owner/Partner | Both | step=about | Production | No (code) |  |
| [ ] | OWNER-010 | Publish/edit: opening hours | Business Owner | /publish or /businesses/[slug]/edit | src/components/account/publish-form.tsx | Owner/Partner | Both | step=hours | Production | No (code) | Mobile day cards; copy-hours dialog separate. |
| [ ] | OWNER-011 | Publish/edit: photos | Business Owner | /publish or /businesses/[slug]/edit | src/components/account/publish-form.tsx | Owner/Partner | Both | step=photos | Production | No (code) | Edit flow ends after save; new flow continues to review. |
| [ ] | OWNER-012 | New submission review | Business Owner | /publish | src/components/account/publish-form.tsx | Owner/Partner | Both | New submission; step=review | Production | No (code) | Section edit links return to collection steps. |
| [ ] | OWNER-013 | Owner-only first business onboarding details | Business Owner | /owner-access/[token]/details | src/app/(account)/owner-access/[token]/details/page.tsx; src/components/account/local-partner-onboarding-form.tsx | Owner | Both | Invitation and pending signup | Production | No (code) | Continuation of invitation account creation. |

### D. Local Partner

| Done | ID | Screen | Category | Route / state | Source | Role | Desktop / mobile | Reach condition | Source | Visual | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [ ] | PARTNER-001 | Partner first-run: how it works | Local Partner | /partner/onboarding | src/components/account/partner-first-run-onboarding.tsx | Partner | Both | First run; screen 1 | Production | No (code) | Same four-screen tutorial can replay as guide. |
| [ ] | PARTNER-002 | Partner first-run: business benefits | Local Partner | /partner/onboarding | src/components/account/partner-first-run-onboarding.tsx | Partner | Both | First run; screen 2 | Production | No (code) |  |
| [ ] | PARTNER-003 | Partner first-run: conversation | Local Partner | /partner/onboarding | src/components/account/partner-first-run-onboarding.tsx | Partner | Both | First run; screen 3 | Production | No (code) |  |
| [ ] | PARTNER-004 | Partner first-run: next steps | Local Partner | /partner/onboarding | src/components/account/partner-first-run-onboarding.tsx | Partner | Both | First run; screen 4 | Production | No (code) |  |
| [ ] | PARTNER-005 | Partner welcome dashboard | Local Partner | /dashboard | src/components/account/partner-first-business-dashboard.tsx | Partner | Both | No submissions | Production | No (code) | Distinct first-business layout. |
| [ ] | PARTNER-006 | Partner standard dashboard | Local Partner | /dashboard | src/components/account/partner-dashboard.tsx | Partner | Both | At least one submission | Production | No (code) | Commission and payout cards. |
| [ ] | PARTNER-007 | Partner submissions and drafts | Local Partner | /dashboard/businesses | src/app/(account)/dashboard/businesses/page.tsx; src/components/account/partner-submissions.tsx | Partner | Both | Completed onboarding | Production | No (code) | Status cards, draft resume, invitation state. |
| [ ] | PARTNER-008 | Partner earnings and payouts | Local Partner | /dashboard/earnings | src/app/(account)/dashboard/earnings/page.tsx; src/components/account/partner-payout-summary.tsx | Partner | Both | Completed onboarding | Production | No (code) | Ledger and payout readiness. |
| [ ] | PARTNER-009 | Partner guide | Local Partner | /partner/guide | src/components/account/partner-guide.tsx | Partner | Both | Completed onboarding | Production | No (code) | Distinct guide page; tutorial replay via /partner/onboarding?guide=1. |
| [ ] | PARTNER-010 | Partner profile details | Local Partner | /onboarding/partner | src/app/(account)/onboarding/partner/page.tsx; src/components/account/local-partner-onboarding-form.tsx | Partner | Both | Details incomplete or editDetails=1 | Production | No (code) | Also used before payout setup. |
| [ ] | PARTNER-011 | Choose payout method | Local Partner | /partner/payout | src/app/(account)/partner/payout/page.tsx | Partner | Both | Completed Partner onboarding | Production | No (code) | Postepay, HYPE, PayPal, Stripe Connect links. |
| [ ] | PARTNER-012 | Payout method details | Local Partner | /partner/payout/[method] | src/app/(account)/partner/payout/[method]/page.tsx; src/components/account/partner-payout-method-form.tsx | Partner | Both | method=Postepay/HYPE/PayPal | Production | No (code) | Stripe option redirects to Connect onboarding. |
| [ ] | PARTNER-013 | Updated Partner terms acknowledgement | Local Partner | /partner/terms | src/app/(account)/partner/terms/page.tsx | Partner | Both | Current Partner terms not accepted | Production | No (code) | Contact sharing consent. |
| [ ] | PARTNER-014 | Partner handoff decision | Local Partner | /publish | src/components/account/publish-form.tsx; src/components/account/pay-later-payment-steps.tsx | Partner | Both | step=handoff; after review | Production | No (code) | Pay now / Pay Later / Save; owner device handoff. |
| [ ] | PARTNER-015 | Pay Later invitation composer | Local Partner | /publish | src/components/account/pay-later-partner-invitation.tsx | Partner/Owner | Both | step=invite; email needed | Production | No (code) | May return to correct missing fields. |
| [ ] | PARTNER-016 | Pay Later invitation accepted | Local Partner | /publish | src/components/account/pay-later-partner-invitation.tsx | Partner/Owner | Both | Provider accepted invitation | Production | No (code) | WhatsApp sharing may appear. |
| [ ] | PARTNER-017 | Pay Later invitation pending retry | Local Partner | /publish | src/components/account/pay-later-partner-invitation.tsx | Partner/Owner | Both | Email queued; provider not accepted | Production | No (code) | Status refresh/retry. |

### E. Administrator

| Done | ID | Screen | Category | Route / state | Source | Role | Desktop / mobile | Reach condition | Source | Visual | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [ ] | ADMIN-001 | Admin overview dashboard | Administrator | /dashboard | src/app/(account)/dashboard/page.tsx | Admin | Both | Admin account | Production | No (code) | Metrics, activity, quick actions. |
| [ ] | ADMIN-002 | All submissions and businesses | Administrator | /dashboard/businesses?scope=all | src/app/(account)/dashboard/businesses/page.tsx | Admin | Both | Admin; scope=all | Production | No (code) | Admin-only all-scope and payment warning. |
| [ ] | ADMIN-003 | Users directory and filters | Administrator | /dashboard/admin/users | src/app/(account)/dashboard/admin/users/page.tsx | Admin | Both | Admin account | Production | No (code) | Sort/filter/search are inline variants. |
| [ ] | ADMIN-004 | User detail | Administrator | /dashboard/admin/users/[userId] | src/app/(account)/dashboard/admin/users/[userId]/page.tsx | Admin | Both | Valid user ID | Production | No (code) | Account, listings, commissions, payouts and claims sections. |
| [ ] | ADMIN-005 | Membership operations list | Administrator | /dashboard/admin/memberships | src/app/(account)/dashboard/admin/memberships/page.tsx | Admin | Both | Admin account | Production | No (code) |  |
| [ ] | ADMIN-006 | Membership support detail | Administrator | /dashboard/admin/memberships/[businessId] | src/app/(account)/dashboard/admin/memberships/[businessId]/page.tsx | Admin | Both | Business has membership | Production | No (code) | Payment history, refund controls, commission ledger. |
| [ ] | ADMIN-007 | Partner payout administration | Administrator | /dashboard/earnings | src/app/(account)/dashboard/earnings/page.tsx | Admin | Both | Admin account | Production | No (code) | Run summaries and Partner payout table. |
| [ ] | ADMIN-008 | Admin business edit | Administrator | /businesses/[slug]/edit | src/app/businesses/[slug]/edit/page.tsx; src/components/account/owned-business-edit-form.tsx | Admin | Both | Admin; valid business | Production | No (code) | Legacy one-page edit form, distinct from Owner wizard. |
| [ ] | ADMIN-009 | Admin publication finish | Administrator | /publish?mode=admin | src/components/account/publish-form.tsx | Admin | Both | Admin mode; step=payment | Production | No (code) | Admin continuation replaces customer payment chooser. |

### F. Payment and membership

| Done | ID | Screen | Category | Route / state | Source | Role | Desktop / mobile | Reach condition | Source | Visual | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [ ] | PAY-001 | Owner confirms business summary | Payment and membership | /publish | src/components/account/publish-form.tsx | Owner/Partner | Both | step=owner-review; after review/handoff | Production | No (code) |  |
| [ ] | PAY-002 | Owner accepts agreement | Payment and membership | /publish | src/components/account/publish-form.tsx; src/components/account/owner-agreement-step.tsx | Owner/Partner | Both | step=agreement | Production | No (code) |  |
| [ ] | PAY-003 | Owner signs agreement | Payment and membership | /publish | src/components/account/publish-form.tsx; src/components/account/signature-pad.tsx | Owner/Partner | Both | step=signature | Production | No (code) |  |
| [ ] | PAY-004 | Pay now or Pay Later decision | Payment and membership | /publish | src/components/account/publish-form.tsx; src/components/account/pay-later-payment-steps.tsx | Owner/Partner | Both | payment substep=decision | Production | No (code) |  |
| [ ] | PAY-005 | Initial renewal preference | Payment and membership | /publish | src/components/account/publish-form.tsx; src/components/account/pay-later-payment-steps.tsx | Owner/Partner | Both | payment substep=renewal; automatic/manual | Production | No (code) |  |
| [ ] | PAY-006 | Initial payment method choice | Payment and membership | /publish | src/components/account/publish-form.tsx; src/components/account/pay-later-payment-steps.tsx | Owner/Partner | Both | payment substep=methods; card/bank | Production | No (code) |  |
| [ ] | PAY-007 | Initial online payment QR and handoff | Payment and membership | /publish/payment | src/app/(account)/publish/payment/page.tsx; src/components/account/initial-payment-qr-view.tsx | Owner/Partner | Both | Online payment pending | Production | No (code) | On-device Stripe Checkout is external; QR shown here. |
| [ ] | PAY-008 | Initial bank transfer instructions | Payment and membership | /publish/payment | src/app/(account)/publish/payment/page.tsx | Owner/Partner | Both | Bank transfer chosen; pending | Production | No (code) | Bank instructions and waiting state. |
| [ ] | PAY-009 | Initial payment confirmed status | Payment and membership | /publish/payment | src/app/(account)/publish/payment/page.tsx | Owner/Partner | Both | Payment paid | Production | No (code) | Receipt/owner handoff modules. |
| [ ] | PAY-010 | Initial payment temporarily paused | Payment and membership | /publish/payment | src/app/(account)/publish/payment/page.tsx | Owner/Partner | Both | Public financial hold enabled | Production | No (code) | Full-page hold gate. |
| [ ] | PAY-011 | Checkout canceled | Payment and membership | /publish/payment/cancel | src/app/(account)/publish/payment/cancel/page.tsx | Owner/Partner | Both | Returned from canceled Checkout | Production | No (code) |  |
| [ ] | PAY-012 | Checkout success: pending finalization | Payment and membership | /publish/payment/success | src/app/(account)/publish/payment/success/page.tsx | Owner/Partner | Both | Payment not yet confirmed | Production | No (code) | Watcher/polling; return/retry. |
| [ ] | PAY-013 | Checkout success: confirmed | Payment and membership | /publish/payment/success | src/app/(account)/publish/payment/success/page.tsx | Owner/Partner | Both | Payment confirmed | Production | No (code) | Live/listing-preparing variants. |
| [ ] | PAY-014 | Initial embedded payment | Payment and membership | /pay/element/[token] | src/app/pay/element/[token]/page.tsx; src/components/account/no-email-payment-form.tsx | Owner | Both | Valid payment token; pending | Production | No (code) | No-email owner handoff/payment element. |
| [ ] | PAY-015 | Initial payment already received | Payment and membership | /pay/element/[token] | src/app/pay/element/[token]/page.tsx | Owner | Both | Payment processing or already received | Production | No (code) | Full-page status. |
| [ ] | PAY-016 | Initial embedded payment unavailable | Payment and membership | /pay/element/[token] | src/app/pay/element/[token]/page.tsx | Owner | Both | Invalid/expired token or hold | Production | No (code) | Full-page unavailable state. |
| [ ] | PAY-017 | Membership embedded payment form | Payment and membership | /dashboard/membership/payment | src/app/(account)/dashboard/membership/payment/page.tsx; src/components/account/no-email-payment-form.tsx | Owner | Both | Renewal/reactivation payment pending | Production | No (code) | Stripe element; auto/manual choice made on dashboard. |
| [ ] | PAY-018 | Membership payment confirmed | Payment and membership | /dashboard/membership/payment | src/app/(account)/dashboard/membership/payment/page.tsx | Owner | Both | Renewal/reactivation confirmed | Production | No (code) |  |
| [ ] | PAY-019 | Membership payment pending | Payment and membership | /dashboard/membership/payment | src/app/(account)/dashboard/membership/payment/page.tsx | Owner | Both | Intent processing/succeeded; awaiting confirmation | Production | No (code) | Check-status action. |
| [ ] | PAY-020 | Membership payment unavailable | Payment and membership | /dashboard/membership/payment | src/app/(account)/dashboard/membership/payment/page.tsx | Owner | Both | Invalid intent or unavailable method | Production | No (code) |  |
| [ ] | PAY-021 | Membership payment temporarily paused | Payment and membership | /dashboard/membership/payment | src/app/(account)/dashboard/membership/payment/page.tsx | Owner | Both | Public financial hold enabled | Production | No (code) | Distinct full-page hold gate. |
| [ ] | PAY-022 | Membership bank transfer instructions | Payment and membership | /dashboard/membership/bank-transfer | src/app/(account)/dashboard/membership/bank-transfer/page.tsx | Owner | Both | Manual bank transfer selected | Production | No (code) |  |
| [ ] | PAY-023 | Failed renewal recovery unavailable | Payment and membership | /dashboard/membership/recovery-unavailable | src/app/(account)/dashboard/membership/recovery-unavailable/page.tsx | Owner | Both | Recovery could not be offered | Production | No (code) |  |
| [ ] | PAY-024 | Pay Later email code verification | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-invitation-shell.tsx; src/components/account/pay-later-owner-client.tsx | Owner | Both | Valid invitation; unverified | Production | No (code) | Code send/resend variants. |
| [ ] | PAY-025 | Pay Later owner review | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx | Owner | Both | Verified invitation; stage=review | Production | No (code) |  |
| [ ] | PAY-026 | Pay Later agreement | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx; src/components/account/owner-agreement-step.tsx | Owner | Both | stage=agreement | Production | No (code) |  |
| [ ] | PAY-027 | Pay Later signature | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx | Owner | Both | stage=signature | Production | No (code) |  |
| [ ] | PAY-028 | Pay Later renewal choice | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx; src/components/account/pay-later-payment-steps.tsx | Owner | Both | stage=payment; substep=renewal | Production | No (code) |  |
| [ ] | PAY-029 | Pay Later payment method choice | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx; src/components/account/pay-later-payment-steps.tsx | Owner | Both | stage=payment; substep=methods | Production | No (code) |  |
| [ ] | PAY-030 | Pay Later online QR result | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx | Owner | Both | destination=online | Production | No (code) | Link to hosted payment. |
| [ ] | PAY-031 | Pay Later bank instructions result | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx | Owner | Both | destination=bank | Production | No (code) |  |
| [ ] | PAY-032 | Pay Later choice saved under hold | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx | Owner | Both | destination=paused | Production | No (code) |  |
| [ ] | PAY-033 | Pay Later payment received | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx | Owner | Both | destination=paid | Production | No (code) |  |
| [ ] | PAY-034 | Pay Later resume existing payment | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx | Owner | Both | Payment method already recorded | Production | No (code) |  |
| [ ] | PAY-035 | Pay Later declined confirmation | Payment and membership | /pay-later#invite=[token] | src/components/account/pay-later-owner-client.tsx | Owner | Both | Owner declines invitation | Production | No (code) |  |

### G. Special and conditional

| Done | ID | Screen | Category | Route / state | Source | Role | Desktop / mobile | Reach condition | Source | Visual | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [ ] | SPECIAL-001 | Claim business search | Special/conditional | /claim | src/components/account/business-claim-form.tsx | Owner | Both | Signed in; no preselected business | Production | No (code) | Search/select existing business. |
| [ ] | SPECIAL-002 | Claim preselected business | Special/conditional | /claim?business=[slug] | src/components/account/business-claim-form.tsx | Owner | Both | Signed in; eligible listing | Production | No (code) | Business confirmation and masked email. |
| [ ] | SPECIAL-003 | Claim already managed | Special/conditional | /claim?business=[slug] | src/app/(account)/claim/page.tsx | Owner | Both | Existing managed listing | Production | No (code) | Full-page ineligibility. |
| [ ] | SPECIAL-004 | Claim email unavailable | Special/conditional | /claim?business=[slug] | src/app/(account)/claim/page.tsx | Owner | Both | Listing has no claimable email | Production | No (code) | Full-page ineligibility. |
| [ ] | SPECIAL-005 | Claim email code verification | Special/conditional | /claim/verify | src/app/(account)/claim/verify/page.tsx; src/components/account/business-claim-verify-form.tsx | Owner | Both | Claim code requested | Production | No (code) |  |
| [ ] | SPECIAL-006 | Claim approved | Special/conditional | /claim/success | src/app/(account)/claim/success/page.tsx | Owner | Both | Verified claim granted | Production | No (code) |  |
| [ ] | SPECIAL-007 | Submission verification | Special/conditional | /publish/verify | src/app/(account)/publish/verify/page.tsx; src/components/account/submission-verify-form.tsx | Owner/Partner | Both | Submission code required | Production | No (code) | Separate from claim verification. |
| [ ] | SPECIAL-008 | Owner invitation: create account | Special/conditional | /owner-access/[token] | src/app/(account)/owner-access/[token]/page.tsx | Owner | Both | Valid invitation; no existing account | Production | No (code) | Email/WhatsApp variants. |
| [ ] | SPECIAL-009 | Owner invitation: wrong signed-in account | Special/conditional | /owner-access/[token] | src/app/(account)/owner-access/[token]/page.tsx | Owner | Both | Signed in as another user | Production | No (code) | Full-page logout and retry. |
| [ ] | SPECIAL-010 | Owner invitation: expired/invalid | Special/conditional | /owner-access/[token] | src/app/(account)/owner-access/[token]/page.tsx | Owner | Both | Expired or invalid token | Production | No (code) | Includes request-new-link form. |
| [ ] | SPECIAL-011 | Owner invitation: already used | Special/conditional | /owner-access/[token] | src/app/(account)/owner-access/[token]/page.tsx | Owner | Both | Used token | Production | No (code) | Login CTA. |
| [ ] | SPECIAL-012 | Pay Later invitation unavailable | Special/conditional | /pay-later | src/components/account/pay-later-invitation-shell.tsx | Owner | Both | Missing/invalid/expired invite | Production | No (code) | Full-page link error. |
| [ ] | SPECIAL-013 | Receipt unavailable | Special/conditional | /receipts/[submissionId] or /receipts/payment/[paymentId] | src/app/(account)/receipts/[submissionId]/page.tsx; src/app/(account)/receipts/payment/[paymentId]/page.tsx | Owner/Partner/Admin | Both | Missing or unauthorized receipt | Production | No (code) | Valid documents redirect to Stripe or PDF, not an app screen. |
| [ ] | SPECIAL-014 | Signed agreement unavailable | Special/conditional | /agreements/[submissionId] | src/app/(account)/agreements/[submissionId]/page.tsx | Owner/Partner/Admin | Both | Missing or unauthorized agreement | Production | No (code) | Valid agreement redirects to PDF. |
| [ ] | SPECIAL-015 | Card refund confirmation | Special/conditional | /dashboard/refund/[businessId] | src/app/(account)/dashboard/refund/[businessId]/page.tsx | Owner | Both | Eligible card initial payment; state=AVAILABLE | Production | No (code) | Full refund confirmation and membership consequences. |
| [ ] | SPECIAL-016 | Card refund processing | Special/conditional | /dashboard/refund/[businessId] | src/app/(account)/dashboard/refund/[businessId]/page.tsx | Owner | Both | Refund in processing/check state | Production | No (code) |  |
| [ ] | SPECIAL-017 | Card refund action required | Special/conditional | /dashboard/refund/[businessId] | src/app/(account)/dashboard/refund/[businessId]/page.tsx | Owner | Both | Stripe requires owner bank details | Production | No (code) | Instruction to follow Stripe email. |
| [ ] | SPECIAL-018 | Card refund completed | Special/conditional | /dashboard/refund/[businessId] | src/app/(account)/dashboard/refund/[businessId]/page.tsx | Owner | Both | Refund confirmed | Production | No (code) |  |
| [ ] | SPECIAL-019 | Card refund failed | Special/conditional | /dashboard/refund/[businessId] | src/app/(account)/dashboard/refund/[businessId]/page.tsx | Owner | Both | Provider could not complete refund | Production | No (code) |  |
| [ ] | SPECIAL-020 | Card refund unavailable | Special/conditional | /dashboard/refund/[businessId] | src/app/(account)/dashboard/refund/[businessId]/page.tsx | Owner | Both | Not eligible for self-service refund | Production | No (code) |  |
| [ ] | SPECIAL-021 | Bank refund request | Special/conditional | /dashboard/refund/[businessId] | src/components/account/bank-refund-request.tsx | Owner | Both | Eligible bank initial payment; not requested | Production | No (code) | Optional contact email and support request. |
| [ ] | SPECIAL-022 | Bank refund request received | Special/conditional | /dashboard/refund/[businessId] | src/components/account/bank-refund-request.tsx | Owner | Both | Support request recorded | Production | No (code) | Status and reference shown. |
| [ ] | SPECIAL-023 | Bank refund failed attempt | Special/conditional | /dashboard/refund/[businessId] | src/components/account/bank-refund-request.tsx | Owner | Both | Return attempt failed | Production | No (code) | Request remains open for support. |
| [ ] | SPECIAL-024 | Bank refund completed | Special/conditional | /dashboard/refund/[businessId] | src/components/account/bank-refund-request.tsx | Owner | Both | Provider confirmed refund | Production | No (code) |  |
| [ ] | SPECIAL-025 | Bank refund request closed | Special/conditional | /dashboard/refund/[businessId] | src/components/account/bank-refund-request.tsx | Owner | Both | Support closed request without refund | Production | No (code) |  |
| [ ] | SPECIAL-026 | Bank refund unavailable | Special/conditional | /dashboard/refund/[businessId] | src/components/account/bank-refund-request.tsx | Owner | Both | Request window ended or not eligible | Production | No (code) |  |
| [ ] | SPECIAL-027 | Support contact | Special/conditional | /dashboard/support | src/app/(account)/dashboard/support/page.tsx | Signed-in | Both | Authenticated account | Production | No (code) | Copy varies by role. |
| [ ] | SPECIAL-028 | Global not found | Special/conditional | any unmatched URL | src/app/not-found.tsx | All | Both | 404, invalid slug or missing record | Production | No (code) |  |

## Shared-screen cross-references (not counted twice)

- `OWNER-006`–`OWNER-011` are the six collection steps used by both Owner and Partner. Owner editing uses these same steps; `ADMIN-008` is a different legacy admin edit screen.
- `PAY-001`–`PAY-006` follow the shared new-submission wizard for Owner or Partner. `PARTNER-014`–`PARTNER-017` cover Partner-specific handoff and invitations.
- `OWNER-004` is the payment-history document page referenced by the payment journey. `AUTH-005`–`AUTH-006` are Partner account creation, filed under Authentication. `OWNER-005` is the shared `/settings` screen.

## Smaller UI elements (separate from full-screen count)

The following are design targets but are **not** added to the full-screen count. Four distinct modal/dialog components were found by searching `<dialog>`, `role="dialog"`, `role="alertdialog"`, and the mobile drawer.

| ID | Element | Source | Use / state |
|---|---|---|---|
| UI-001 | Mobile navigation drawer | `src/components/mobile-navigation-drawer.tsx` | Role-based mobile links; modal drawer. |
| UI-002 | Draft deletion confirmation | `src/components/account/draft-delete-control.tsx` | Alert dialog, deletion busy/error. |
| UI-003 | Turn off automatic renewal | `src/components/account/auto-renew-cancel-control.tsx` | Confirmation dialog. |
| UI-004 | Copy opening hours | `src/components/account/publish-form.tsx` | Native dialog; day selection and replace confirmation. |
| UI-005 | Desktop town menu | `src/components/site-header.tsx` | `<details>` dropdown. |
| UI-006 | Account menu | `src/components/account/account-menu.tsx` | Dashboard, publish, settings and support links. |
| UI-007 | Town multi-select | `src/components/town-multi-select.tsx` | Searchable dropdown. |
| UI-008 | Address suggestions | `src/components/address-autocomplete.tsx` | Async combobox, empty, loading, validation. |
| UI-009 | Global search suggestions | `src/components/search-autocomplete.tsx` | Query suggestions and keyboard navigation. |
| UI-010 | Directory advanced filters | `src/components/business-explorer.tsx` | Expand/collapse, category/locality controls. |
| UI-011 | Owner membership selector | `src/components/account/business-owner-dashboard-client.tsx` | Tabs when multiple businesses. |
| UI-012 | Image gallery selector | `src/components/business/business-image-gallery.tsx` | Thumbnail selection. |
| UI-013 | Partner submission details | `src/components/account/partner-submissions.tsx` | `<details>` accordion. |
| UI-014 | Admin refund details | `src/components/account/admin-bank-refund-controls.tsx` | `<details>` accordion. |
| UI-015 | Form validation / error banners | `src/components/account/publish-form.tsx`, `src/components/account/login-form.tsx`, `src/components/address-autocomplete.tsx` | Inline fields and role alerts. |
| UI-016 | Loading and pending states | `src/app/loading.tsx`, `src/app/(account)/loading.tsx`, `src/components/account/checkout-status-watcher.tsx` | Route skeletons and payment polling. |
| UI-017 | Success/status banners | `src/components/review-composer.tsx`, `src/components/account/pay-later-partner-invitation.tsx`, `src/app/(account)/dashboard/page.tsx` | Review submitted, invitation status, payout notices. |
| UI-018 | Empty states | `src/components/business-explorer.tsx`, `src/components/account/submission-list.tsx`, `src/components/account/owned-business-list.tsx` | No results, no drafts, no businesses. |
| UI-019 | Language transition overlay | `src/components/locale-transition-overlay.tsx` | Locale change progress. |
| UI-020 | Phone country selector | `src/components/phone-country-selector.tsx` | Country/code input. |

No generic toast component was found in `src/components`; status and errors are mostly inline banners or role alerts.

## Desktop and mobile variations

Seven meaningful responsive patterns need separate design review; they are variations of the same screens, not seven additional full pages: (1) header versus mobile drawer, (2) directory desktop grid/list toggle versus compact mobile grid, (3) publish wizard mobile progress/footer, (4) opening-hours desktop grid versus mobile day cards, (5) Partner dashboard desktop versus mobile navigation, (6) Owner membership selector horizontal scrolling on narrow screens, and (7) Admin tables horizontal overflow on narrow screens. These are code-identified patterns; a full device matrix was not run.

## Implemented but indirect, duplicate, or constrained

- `/explore` duplicates `/directory`; `/signup/[audience]` supports personal signup, while business and partner values redirect.
- `/partner/start`, `/onboarding/business`, and `/claim/email` are compatibility/flow redirects. `/agreements/[submissionId]` and `/receipts/payment/[paymentId]` show an unavailable screen only when access/data checks fail; valid requests redirect to a document.
- Unused/indirect candidates: `src/components/account/signature-pad 2.tsx` (duplicate-looking), `business-signup-form.tsx` (no import found), `partner-embedded-onboarding.tsx` (no import found), and `partner-signup-form.tsx` (referenced only after `/signup/partner` redirects). Confirm before deleting or redesigning them.
- Pay Later screens are in production source but payment paths may be paused. OTP, invitation delivery, claim verification, refund and membership states require data and authorization to exercise; they remain visually unverified.

## Audit totals

- Unique full pages/screens: **125**.
- Distinct `page.tsx` URL route patterns: **62** (includes aliases and redirects).
- Multi-step workflow screens: **42** (signup, Partner tutorial, publishing, invitation, claim, Pay Later).
- Modal/dialog components: **4**.
- Smaller UI elements listed above: **20**.
- Shared UI component modules catalogued: **35** (see `ui-redesign-shared-components.md`).
- Desktop/mobile-specific patterns: **7**.
- Production-source screens: **125**.
- Experimental/branch-only screens: **0 confirmed** from the isolated branch tips; the test environment artifact has no linked Git commit, so any staging-only UI difference is unverified.
- Visually unverified screens: **120**. These are source-confirmed; some gated states may be unreachable without specific test data.
