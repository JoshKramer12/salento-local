# First controlled real €50 Partner Cash Out — separate plan only

**20 November 2026. No transfer or payout is authorized.** This canary may be considered only after a verified live initial €100 payment creates exactly one €50 commission, the full **14-day hold** has elapsed naturally, and the [Stage 10C Cash Out gates](SALENTO_LOCAL_STAGE10C_READINESS.md) are closed. Never edit production timestamps, shorten the hold, use test/NULL commissions or bypass the €50 minimum.

## Preflight and separate approval

1. Financial owner and independent reviewer match the commission to the live `Payment` (`stripeLivemode=true`, EUR 10,000 cents, paid provider identity), originating Partner and published business. Check no unresolved refund/dispute, negative debt, prior reservation, active withdrawal or conflicting legacy payout; verify exactly €5,000 cents eligible and no other commission is included. Resolve any historical test payout conflict for the chosen Partner.
2. Verify the Partner's **live-mode** Express account through read-only Stripe access: ownership/identity, transfers active, payouts enabled, clear requirements/restrictions, supported EUR bank destination, manual payout schedule and masked bank details with dual signoff. Test Connect account IDs do not qualify.
3. Independently run the no-send monitor with a read-only identity, durable state, named alert recipient, external missed-run watchdog, successful alert/ack/retry drill, current provider/database inventory, daily balance-transaction and bank/statement close. Assign one authorized worker/SQLite writer, check restart-safe lease/idempotency and an immediate request/processor stop procedure. Keep legacy payout execution off. Resolve genuine test-mode failed/canceled/returned-payout evidence or obtain an explicit documented risk exception.
4. Confirm live platform liquidity and reserve after fees/refunds, the exact connected account/destination, operator, date/time, deployed SHA, backup and incident contacts immediately before sending. Obtain a **new founder approval naming the Partner, exactly €50, destination and one bounded worker action**. The €100 payment approval does not apply.

## One-withdrawal execution and reconciliation

Under the approved narrow Partner request gate, reserve exactly €5,000 cents in one atomic transaction. Verify the single `PartnerWithdrawal`, allocation IDs, unique active slot, status and idempotency identity; a second concurrent request must not reserve those commissions. Keep the processor off until the reservation and live provenance are independently signed off. Then make one bounded processor call; record exactly one Stripe live transfer ID for €50 to the approved account and exactly one connected payout ID to the approved bank destination, with matching transfer group, account, EUR amount, metadata and idempotency keys. Never blind-retry an unknown response.

Match authenticated Connect webhook events, transfer and payout status, balance transactions, local attempt/withdrawal/payout/commission states and the next daily statement close. A `paid` provider state may later fail or return; keep monitoring active through final settlement review. Mark the commission settled only under the implemented verified provider transition, confirm no second withdrawal can use it, and record financial-owner plus independent-reviewer close signatures.

## Stop and incident handling

- On timeout or unknown create result, pause requests and sends, retain reservation and idempotency key, retrieve Stripe objects/request logs and reconcile before any retry. No second transfer or payout is assumed safe.
- On destination/capability/mode mismatch, unexpected amount, duplicate provider object, missing webhook, failed/canceled/returned payout or local/provider divergence, stop the processor and page the named owner. Preserve signed webhooks and read-only inventory so in-flight events can still be reconciled.
- A code rollback or SQLite restore does not undo provider money movement. Any reversal, refund, manual ledger correction, retry or new payout needs separate incident authorization and independent reconciliation. No broad Partner rollout follows automatically from this canary.
