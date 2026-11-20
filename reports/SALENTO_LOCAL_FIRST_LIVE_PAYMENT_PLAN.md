# First controlled live €100 membership payment — plan only

**20 November 2026. No charge or production change is authorized.** Use the [Stage 10C readiness gates](SALENTO_LOCAL_STAGE10C_READINESS.md) and the [Stage 10B release sequence](SALENTO_LOCAL_STAGE10B_ACTIVATION_PLAN.md). Payment approval follows a separately approved disabled-by-default deployment, verified backup/restore, live Stripe account/key/webhook configuration and test-subscription transition. The founder designates one consenting Owner, one originating Partner and one clearly named test business; record their internal IDs privately, never in the repository.

## Preflight and approval record

1. Record the exact production Git SHA/deployment, migration count, feature flags, operator, UTC time, Stripe live account ID (masked in shared notes), live webhook endpoint/event types, signing-secret **presence**, and the fresh off-volume SQLite/uploads backup hash and isolated restore result. Check no unexpected worker or Cash Out gate is active.
2. Reconcile the designated Owner's existing memberships, pending Checkout/PaymentIntent/customer/subscription IDs and test renewal obligations. Verify a clean live path with no reusable test/NULL object. Confirm Partner attribution in the submission before payment. Preserve signed agreement, owner identity, €100 annual terms, 365-day period and 14-day refund policy evidence.
3. Account owner confirms live EUR card acceptance, verification/restrictions, receipt/invoice requirements, webhook delivery and refund/support process. Financial owner records maximum exposure of **one €100 charge plus fees**, refund/dispute reserve, and who will handle an incident. Do not assume a refund reverses fees or accounting effects.
4. Obtain explicit founder approval for **one €100 live card payment** for the named business and Owner, after the separately approved production config steps. Do not use this approval for a payout, second payment, refund or retry.

## One-payment execution and expected evidence

The Partner starts the business submission and Owner handoff. The Owner verifies contact and listing information, accepts/signs the agreement, chooses card payment and sees exactly €100 before confirming the live payment method. Capture the exact Checkout/PaymentIntent/Charge IDs and signed platform webhook event ID in restricted evidence. Do not activate a membership from the browser success URL alone.

Read back Stripe's live `livemode=true`, EUR `amount_received=10000`, succeeded payment state, matching customer/Owner/submission metadata, and one signed event. Read SQLite after webhook completion: one `Payment` for the same provider identity with `stripeLivemode=true`, `PAID`, EUR 10,000 cents; one 365-day membership with 14-day grace policy; publication according to listing rules; agreement/signature and receipt records; Owner dashboard/history; one €5,000 originating Partner commission with `eligibleAt` no earlier than 14 days after authoritative payment and unavailable for Cash Out. Verify email/outcome delivery or durable retry queue. Re-deliver the **same testable event only under an approved non-financial replay procedure** and confirm no duplicate payment, term or commission; do not create another live charge to test idempotency.

Compare Stripe payment, webhook log, SQLite payment/membership/commission, receipt and public listing by immutable IDs and amounts. Record the completed evidence packet and independent reviewer signoff. Keep Cash Out request and processor gates off.

## Stop and recovery

- If the card declines or is canceled, expect no paid payment, publication or commission. Investigate before any fresh payment attempt; the original one-payment approval does not authorize an extra charge.
- If Stripe succeeds but webhook/SQLite lags, **pause new payment attempts**, preserve the provider ID and signed event, inspect webhook log and application errors, then reconcile the exact provider payment before any retry. Never manufacture `PAID`, force a commission, or trust the browser redirect. Escalate an unknown outcome to the financial owner.
- If amount, account, mode, Owner, Partner, term or receipt differs, stop the canary, disable the live payment gate under incident authority, preserve evidence and reconcile Stripe/SQLite. A refund, DB correction, migration restore or second charge each needs its own approval. Code rollback does not undo a charge or database write.

Manual and automatic €100 renewals, failed renewal recovery, bank transfer and €15 commissions remain separate test cases; this first payment does not authorize them. A Partner Cash Out requires a new approval after the full hold and the separate plan.
