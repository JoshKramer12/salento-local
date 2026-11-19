# Salento Local — 19 legacy FAILED payout reconciliation (Stage 10A)

**Read-only evidence captured 19 November 2026.** F, P and R are stable pseudonyms within this investigation. All 19 records date from 12 August 2026 and have the same generic failure message: “We could not complete your payout. Please review your payout information.” They use Stripe, with no PayPal provider batch/reference. All 19 have zero currently linked commissions. Production records were not changed. Provider evidence is from the production platform’s **test-mode** Stripe account; “paid” is a Stripe test payout state, not proof of a bank deposit.

| Row | Partner | Run / status | Nominal | Attempts | Stripe transfer | Connected payout | Classification |
|---|---|---|---:|---:|---|---|---|
| F01 | P01 | R01 / RUNNING | €400 | 1 | Yes; full reversal | Yes; paid | Provider paid (test) |
| F02 | P01 | R05 / RUNNING | €400 | 0 | Yes; full reversal | No | No completed payout |
| F03 | P01 | R06 / RUNNING | €400 | 0 | Yes; full reversal | No | No completed payout |
| F04 | P01 | R07 / RUNNING | €400 | 0 | Yes; full reversal | No | No completed payout |
| F05 | P01 | R09 / RUNNING | €400 | 0 | Yes; full reversal | No | No completed payout |
| F06 | P01 | R10 / RUNNING | €400 | 0 | Yes; full reversal | No | No completed payout |
| F07 | P01 | R11 / RUNNING | €400 | 0 | Yes; full reversal | No | No completed payout |
| F08 | P01 | R12 / PARTIAL | €400 | 0 | Yes; full reversal | No | No completed payout |
| F09 | P01 | R13 / FAILED | €400 | 0 | Yes; full reversal | No | No completed payout |
| F10 | P02 | R02 / RUNNING | €50 | 1 | Yes; full reversal | Yes; paid | Provider paid (test) |
| F11 | P02 | R08 / RUNNING | €50 | 0 | Yes; full reversal | No | No completed payout |
| F12 | P02 | R12 / PARTIAL | €50 | 0 | Yes; full reversal | No | No completed payout |
| F13 | P02 | R13 / FAILED | €50 | 0 | Yes; full reversal | No | No completed payout |
| F14 | P03 | R04 / RUNNING | €50 | 1 | Yes; full reversal | Yes; paid | Provider paid (test) |
| F15 | P03 | R12 / PARTIAL | €50 | 0 | Yes; full reversal | No | No completed payout |
| F16 | P03 | R13 / FAILED | €50 | 0 | Yes; full reversal | No | No completed payout |
| F17 | P04 | R03 / RUNNING | €50 | 1 | Yes; full reversal | Yes; paid | Provider paid (test) |
| F18 | P04 | R12 / PARTIAL | €50 | 0 | Yes; full reversal | No | No completed payout |
| F19 | P04 | R13 / FAILED | €50 | 0 | Yes; full reversal | No | No completed payout |

**Provider reconciliation.** Each of the 19 recorded transfers exists in Stripe test mode, matches amount, EUR, connected destination and metadata, and has exactly one full reversal. The four recorded connected payouts (F01, F10, F14, F17) also exist, match amount, EUR, account and metadata, and are `paid`, with no failure code or failure balance transaction. The other 15 have no payout ID; enumeration of all seven connected payouts across these four test accounts since 1 August 2026 found no hidden payout for them. The other three provider payouts correspond to separate locally PAID rows. This supports **confirmed provider failure with no completed payment** for the 15 transfer-only rows and **confirmed provider payment in test mode** for the four payout rows. It does not prove real-world settlement or the exact Aug 12 failure trigger. The prior assertion that all 19 had positive attempt counts is corrected: only four have attemptCount 1; 15 have 0 despite a recorded Stripe transfer.

| Partner | FAILED rows / nominal | Existing PAID commissions | Pending/reserved/debt | Eligibility consequence |
|---|---:|---:|---|---|
| P01 | 9 / €3,600 | 9 / €450 | 0 / 0 / 0 | Block; F01 provider-paid/local-FAILED conflict. |
| P02 | 4 / €200 | 1 / €50 | 0 / 0 / 0 | Block; F10 conflict. |
| P03 | 3 / €150 | 1 / €50 | 0 / 0 / 0 | Block; F14 conflict. |
| P04 | 3 / €150 | 1 / €50 | 0 / 0 / 0 | Block; F17 conflict. |

All 12 PAID commissions above link to *other* locally PAID payouts. Their underlying `Payment.stripeLivemode` is NULL, so none is verified live eligible. No debt-recovery rows exist for these four Partners. Their current payout setup is INCOMPLETE. The request gate also blocks unresolved legacy FAILED history. The €4,100 aggregate is repeated historical nominal intent, not a verified amount owed, lost or sent; the four provider-paid test payouts total €550 nominal.

**Causation and residual uncertainty.** The earliest source commit available is dated 29 August 2026, after these rows. Its legacy payout flow can create a transfer, create a payout, then encounter a later failure and reverse the transfer before marking the row FAILED and releasing reservations. That is a plausible mechanism, not proof of the exact 12 August deployed code path. The generic error does not identify which step failed. Historical provider request logs and statements should be retained and reviewed by an authorized financial owner before any disposition. In particular, the four paid-provider/local-FAILED rows must be manually reconciled; a reversed transfer does not erase the paid connected payout state. Do not edit, retry, or unblock these records automatically.

**Private evidence.** A detailed read-only evidence bundle, including individual raw provider lookups, local ledger rows and the cross-account inventory, is retained in the private local Stage 10A evidence directory and excluded from Git. The pseudonym mapping and raw provider IDs are deliberately absent here. Provider/API results are genuine read-only Stripe test-mode responses; no payout or transfer was created by this investigation.
