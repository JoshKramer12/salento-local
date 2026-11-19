# Salento Local — Cash Out monitoring design and runbook

**Stage 10A design, 19 November 2026. Nothing here is scheduled in production.** The current local `--mode=control` process reads Stripe inventory, calls the authenticated health route, stores incident state and delivers authenticated alerts. Its sibling `--mode=worker` can call the send route, and `--mode=reconciliation` can mutate SQLite settlement state. A monitor deployment must not include worker mode, a send-capable token or a Stripe key with write privileges if Stripe can provide suitable restricted read access.

## Service ownership and durability

Use one approved web service as the sole SQLite volume owner. Railway volumes attach to one service; a separate cron service cannot assume it can mount the web volume, and ephemeral service storage is not durable. [Railway volume reference](https://docs.railway.com/volumes/reference). Build a dedicated, no-send read-only health endpoint on the web service with a distinct monitor bearer, or an authenticated read-only DB snapshot interface. Put the independent monitor on a separate scheduled service with its **own** durable state volume or external durable incident store. Configure it with read-only Stripe access, HTTPS health endpoint and alert-sink token; no worker secret, no payout flags, no legacy job secret, no database write credential. The current script's health call uses the worker secret and has send-capable modes, so **do not deploy that script as a purported isolated monitor** until this separation is implemented and reviewed. Its local drill proves logic, not production isolation.

A single separately approved worker scheduler may call the bounded authenticated web route every 2–5 minutes when activated; Railway cron has a five-minute minimum and skips overlapping jobs. [Railway cron jobs](https://docs.railway.com/cron-jobs). Keep provider inventory/health control every five minutes and an independent signed-off financial reconciliation daily. Use a fixed scan start no later than the first Cash Out withdrawal, with explicit pagination and limit alarms. Retain a daily immutable snapshot of counts, sums, incident keys, mode, scan window, API completion and operator signoff; protect it outside the ephemeral filesystem. A separate external watchdog must alert if the monitoring job fails or misses two cycles. The monitor cannot self-report if it never runs.

## Alert rules and routing

| Condition | Severity / first response |
|---|---|
| `OUTCOME_UNKNOWN`, failed/canceled payout, transfer reversal, returned funds, wrong destination, provider-paid/local-unsettled, unexpected or missing Stripe object, commission reservation mismatch | Critical immediately; pause new requests and sends, preserve in-flight evidence, page the financial owner. |
| Stuck pre-payout processing >10 min; failed/stuck Connect webhook >10 min; connected-account verification failure; provider/API scan failure; missing expected worker or reconciliation run >10 min | Critical; page engineering and financial owner. Keep signed webhook intake and read-only diagnosis. |
| Request >60 min; payout pending >3 days; provider reconciliation age >6 h | Warning initially; escalate to critical if aging or combined with another discrepancy. |
| Monitoring job absent for two five-minute cycles or alert sink unavailable | Critical from an **external** watchdog; a local log is insufficient. |
| Unresolved legacy FAILED records, especially recorded payout IDs | Critical release blocker; route to financial owner for manual reconciliation, suppress repeat pages through stable keys while keeping daily visibility. |

Stable `cashout:` incident keys support deduplication. The sink must honor `idempotency-key`; the local atomic state file alone gives at-least-once delivery because a crash can happen after HTTP 2xx and before state save. Retain delivered, acknowledged and resolved timestamps. Acknowledgment requires a named operator, reason and evidence; it does not clear the underlying incident. Retry a failed delivery with bounded backoff and escalate sink outage via the independent watchdog. Reopen on recurrence after a clean resolution. Never include keys, bank details, webhook bodies or customer PII in alert payloads.

## Operator response

1. Confirm alert authenticity, timestamp, mode, environment, job run ID and exact withdrawal/attempt. Acknowledge with owner and incident ticket; do not infer settlement from a local PAID label.
2. For a money movement variance, obtain read-only SQLite, Stripe transfer, connected payout, balance transaction, reversal and webhook log evidence. Check exact account/destination, amount, EUR, mode, metadata and duplicate objects. Preserve an immutable snapshot.
3. Under an approved incident change, disable new requests, then the processing worker. Keep the platform/Connect webhook path and read-only monitoring. Stop any legacy send path. Do not blind-retry after timeout or clear a reservation.
4. Escalate critical provider/ledger disagreement immediately to the financial owner and engineer on call; seek Stripe support when provider status is ambiguous. Require two-person review for any later financial correction or retry.
5. Resume only after provider identity/outcome, local ledger, balance transaction, commission/debt and alert pipeline match, a fresh scan succeeds, and the release owner signs the recovery record. Code rollback does not undo Stripe effects; restored SQLite requires provider replay since backup.

## Required preactivation drill

In isolation: deny wrong monitor/worker bearer; prove monitor credential cannot call the send route; stop worker and verify missing-run page; stop reconciliation and verify its page; stop the monitor and verify **external** watchdog page; simulate alert sink 401 then recovery and no duplicate sink action; restart monitor and verify durable state; induce a mock provider/API failure and ensure the previous provider incident is not auto-resolved; test one scan-window/limit breach; confirm emergency pause blocks new sends while signed webhook processing survives. The Stage 8 local drill already proved missing-run, keyed deduplication, sink retry and genuine test-mode provider inventory, with mock worker/alert endpoints. Production drill and destination ownership remain open.
