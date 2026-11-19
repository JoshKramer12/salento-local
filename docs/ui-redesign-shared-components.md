# Salento Local — shared UI components and redesign order

**Baseline:** production `main` at `c2249fd6bd717652175b1f9759b7bf85ed950b05`. See [the master checklist](ui-redesign-master-checklist.md) for screen IDs and [user journeys](ui-redesign-user-journeys.md) for sequence. The table below catalogs **35 component modules** that establish repeated UI patterns or are shared by multiple screens. `globals.css` is an additional style foundation, not a component and not included in 35.

## Redesign leverage map

| ID | Component / pattern | Source | Reused by / screens affected | Priority |
|---|---|---|---|---|
| SH-001 | Site header | `src/components/site-header.tsx` | Almost all public and account screens; search, locale, desktop nav | 1 |
| SH-002 | Site footer | `src/components/site-footer.tsx` | Public and account layouts | 1 |
| SH-003 | Mobile navigation drawer | `src/components/mobile-navigation-drawer.tsx` | Role-specific mobile navigation everywhere | 1 |
| SH-004 | Language toggle | `src/components/language-toggle.tsx` | Header and settings; EN/IT behavior | 1 |
| SH-005 | Locale transition overlay | `src/components/locale-transition-overlay.tsx` | Locale change across app | 2 |
| SH-006 | Hard navigation link | `src/components/hard-navigation-link.tsx` | Buttons/cards and redirects across app | 1 |
| SH-007 | Account menu | `src/components/account/account-menu.tsx` | Signed-in header | 1 |
| SH-008 | Dashboard navigation | `src/components/account/dashboard-nav.tsx` | Owner, Partner, Admin dashboards and subpages | 1 |
| SH-009 | Generic account workspace nav | `src/components/account/account-workspace-nav.tsx` | Account section shell | 1 |
| SH-010 | Owner account/workspace nav | `src/components/account/business-owner-account-nav.tsx` | Owner dashboard and draft/edit flows | 1 |
| SH-011 | Partner workspace nav | `src/components/account/partner-workspace-nav.tsx` | Partner dashboard, submissions, earnings, publish | 1 |
| SH-012 | Business explorer | `src/components/business-explorer.tsx` | Directory, town detail, locality detail | 1 |
| SH-013 | Search autocomplete | `src/components/search-autocomplete.tsx` | Header, homepage, directory search | 1 |
| SH-014 | Town multi-select | `src/components/town-multi-select.tsx` | Directory search/filter | 2 |
| SH-015 | Business card | `src/components/business-card.tsx` | Discovery grids | 1 |
| SH-016 | Business list row | `src/components/business-list-row.tsx` | Directory list view | 2 |
| SH-017 | Category tile | `src/components/category-tile.tsx` | Homepage/category navigation | 2 |
| SH-018 | Town card | `src/components/town-card.tsx` | Homepage and town index | 2 |
| SH-019 | Locality card | `src/components/locality-card.tsx` | Homepage and locality index | 2 |
| SH-020 | Business hero | `src/components/business/business-hero.tsx` | Public listing template | 2 |
| SH-021 | Business contact card | `src/components/business/business-contact-card.tsx` | Public listing template | 2 |
| SH-022 | Business reviews | `src/components/business/business-reviews.tsx` | Public listing template | 2 |
| SH-023 | Form submit button | `src/components/form-submit-button.tsx` | Server Action forms, pending state | 1 |
| SH-024 | Address autocomplete | `src/components/address-autocomplete.tsx` | Publishing/edit wizard, validated address | 1 |
| SH-025 | Phone country selector | `src/components/phone-country-selector.tsx` | Signup, owner/partner contact forms | 1 |
| SH-026 | Segmented date input | `src/components/account/segmented-date-input.tsx` | Signup/profile details | 2 |
| SH-027 | Signature pad | `src/components/account/signature-pad.tsx` | New publication and Pay Later agreement | 1 |
| SH-028 | Publish form shell and progress | `src/components/account/publish-form.tsx` | Six collection steps and Owner/Partner/Admin continuation | 1 |
| SH-029 | Owner agreement step | `src/components/account/owner-agreement-step.tsx` | New publication and Pay Later | 1 |
| SH-030 | Payment step selectors | `src/components/account/pay-later-payment-steps.tsx` | Pay now/later, renewal preference, card/bank choice | 1 |
| SH-031 | Embedded payment form | `src/components/account/no-email-payment-form.tsx` | Initial token and membership payment screens | 2 |
| SH-032 | Submission list | `src/components/account/submission-list.tsx` | Owner/Admin drafts and submissions | 2 |
| SH-033 | Owned business list | `src/components/account/owned-business-list.tsx` | Owner/Admin dashboards and lists | 2 |
| SH-034 | Partner payout summary | `src/components/account/partner-payout-summary.tsx` | Partner dashboard and earnings | 2 |
| SH-035 | Legal document page | `src/components/legal/legal-document-page.tsx` | Terms, privacy, cookies | 2 |

## Style foundation

`src/app/globals.css` defines the shared tokens and common classes (`--foreground`, `--primary`, `--accent`, `--muted`, `--border`, `.shell`, `.card`, `.btn-primary`, `.btn-secondary`, `.input-field`, `.field-label`, and responsive rules). `src/app/layout.tsx` supplies the site shell, typography and global header/footer. Redesign token values and these base classes before polishing individual pages. Check contrast, focus, touch targets, error colors, EN/IT text expansion, and reduced-motion behavior.

## Recommended redesign sequence

1. **Design tokens and app shell:** `globals.css`, layout, header/footer, desktop/mobile/account navigation, links and buttons (`SH-001`–`SH-011`, `SH-023`). This immediately aligns almost every route.
2. **Form system:** labels, input/select/textarea, validation, address and phone controls, date fields, signature, agreement (`SH-024`–`SH-027`, `SH-029`). Confirm both languages and mobile keyboards.
3. **Discovery templates:** explorer, search, filters and cards (`SH-012`–`SH-022`), then homepage, directory, towns, localities and business detail. These cover public traffic with a small template set.
4. **Publishing workflow:** shared `PublishForm` shell and six collection steps, review, handoff, Owner approval, invitation and payment selectors (`SH-028`, `SH-030`). Keep Save & Exit, owner/Partner role boundaries and no-email handoff intact.
5. **Owner and Partner workspaces:** dashboards, drafts, memberships, earnings, payout setup, account settings (`SH-008`–`SH-011`, `SH-032`–`SH-034`). Test zero, one and multiple records and each membership state.
6. **Conditional and Admin screens:** claims, invitation/recovery, receipts, refund states, Admin tables, access errors, 404, loading and empty states. This closes the visual gaps after common components stabilize.

## Specific responsive patterns to review

1. Site header versus modal mobile drawer (`SH-001`, `SH-003`).
2. Directory desktop grid/list toggle and compact mobile grid (`SH-012`, `SH-015`, `SH-016`).
3. Publish wizard desktop/mobile progress and sticky controls (`SH-028`).
4. Opening-hours grid versus mobile day cards (`SH-028`).
5. Partner desktop and mobile navigation (`SH-011`).
6. Owner multiple-business membership selector on narrow screens (`src/components/account/business-owner-dashboard-client.tsx`).
7. Admin wide tables with horizontal overflow (`src/app/(account)/dashboard/admin/users/page.tsx`, `src/app/(account)/dashboard/admin/memberships/page.tsx`).

These seven are responsive variations, not extra full-screen IDs. Full responsive visual QA remains for the redesign phase.

## Small-state checklist

The master checklist separately lists four dialogs (`UI-001`–`UI-004`) plus dropdowns, tabs, accordion/details, errors, loading, banners and empty states. Apply the same tokens and interaction patterns to them. No generic toast system was found in the component tree; most feedback uses inline `role="alert"` or `role="status"` blocks.
