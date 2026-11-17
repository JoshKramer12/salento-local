import Stripe from "stripe";
import { assertStage5aSandboxIsolation } from "@/lib/stage5a-sandbox-isolation";

async function main() {
  const config = assertStage5aSandboxIsolation(process.env);
  const stripe = new Stripe(config.secretKey);
  const [account, before] = await Promise.all([
    stripe.accounts.retrieve(null), stripe.balance.retrieve(),
  ]);
  if (account.id !== config.accountId || before.livemode !== false) {
    throw new Error("stage5a_account_or_mode_mismatch");
  }
  let intent: Stripe.PaymentIntent | null = null;
  let inspected = 0;
  for await (const candidate of stripe.paymentIntents.list({ limit: 100 })) {
    if (candidate.metadata?.stage5a_sandbox === config.accountId &&
        candidate.metadata?.stage5a_synthetic === "true") {
      intent = candidate;
      break;
    }
    if (++inspected >= 1000) throw new Error("stage5a_payment_search_incomplete");
  }
  intent ??= await stripe.paymentIntents.create({
    amount: 6000,
    currency: "eur",
    payment_method: "pm_card_visa",
    payment_method_types: ["card"],
    confirm: true,
    description: "Stage 5A isolated synthetic EUR funding",
    metadata: { stage5a_synthetic: "true", stage5a_sandbox: config.accountId },
  }, { idempotencyKey: "salento-stage5a-fund-eur-6000-v1" });
  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
  if (!chargeId) throw new Error("stage5a_payment_charge_missing");
  const charge = await stripe.charges.retrieve(chargeId);
  const transactionId = typeof charge.balance_transaction === "string"
    ? charge.balance_transaction : charge.balance_transaction?.id;
  if (!transactionId) throw new Error("stage5a_payment_balance_transaction_missing");
  const transaction = await stripe.balanceTransactions.retrieve(transactionId);
  const after = await stripe.balance.retrieve();
  if (intent.livemode !== false || intent.amount !== 6000 || intent.currency !== "eur") {
    throw new Error("stage5a_funding_evidence_mismatch");
  }
  const eur = (items: Stripe.Balance.Available[]) => items
    .filter((item) => item.currency === "eur")
    .reduce((sum, item) => sum + item.amount, 0);
  console.log(JSON.stringify({ accountId: account.id, paymentIntentId: intent.id,
    status: intent.status, amount: intent.amount, currency: intent.currency,
    balanceTransactionId: transaction.id, settlementCurrency: transaction.currency,
    settlementStatus: transaction.status, settlementNetCents: transaction.net,
    beforeAvailableEurCents: eur(before.available),
    afterAvailableEurCents: eur(after.available),
    afterPendingEurCents: eur(after.pending) }));
}

main().catch((error: unknown) => {
  const cause = error as { type?: string; code?: string; message?: string };
  console.error(JSON.stringify({ failed: true, type: cause.type ?? "local_error",
    code: cause.code ?? "stage5a_funding_failed",
    detail: cause.message?.replace(/[A-Za-z0-9]{24,}/g, "<redacted>").slice(0, 300) }));
  process.exitCode = 1;
});
