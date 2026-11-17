import { getStripe } from "@/lib/stripe";
import { withVerifiedStage5aSandbox } from "@/lib/partner-withdrawal-sandbox-context";

const PARTNER_ID = "partner-stage5a-primary";
const CONNECTED_ID = "acct_1UXijnGlpytZm7rC";

async function main() {
  await withVerifiedStage5aSandbox(PARTNER_ID, async () => {
    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(CONNECTED_ID, { expand: ["external_accounts"] });
    if (account.id === process.env.STAGE5A_EXPECTED_ACCOUNT_ID || account.country !== "IT" ||
        account.email !== "stage5a-partner@example.test" ||
        account.controller?.stripe_dashboard?.type !== "express") {
      throw new Error("stage5a_connected_account_mismatch");
    }
    const existing = account.external_accounts?.data.filter((item) => item.object === "bank_account") ?? [];
    if (existing.length > 0) {
      console.log(JSON.stringify({ connectedAccountId: account.id, bankCount: existing.length,
        last4: existing.map((item) => item.last4) }));
      return;
    }
    // Published Stripe test IBAN: payouts to it simulate success, never a bank deposit.
    const token = await stripe.tokens.create({ bank_account: {
      country: "IT", currency: "eur", account_number: "IT40S0542811101000000123456",
    } }, { idempotencyKey: "salento-stage5a-italian-test-bank-token-v1" });
    const bank = await stripe.accounts.createExternalAccount(CONNECTED_ID, {
      external_account: token.id, default_for_currency: true,
    }, { idempotencyKey: "salento-stage5a-italian-test-bank-v1" });
    if (bank.object !== "bank_account" || bank.currency !== "eur") {
      throw new Error("stage5a_test_bank_evidence_mismatch");
    }
    console.log(JSON.stringify({ connectedAccountId: account.id, bankId: bank.id,
      last4: bank.last4, currency: bank.currency, defaultForCurrency: bank.default_for_currency }));
  });
}

main().catch((error: unknown) => {
  const cause = error as { type?: string; code?: string; message?: string };
  console.error(JSON.stringify({ failed: true, type: cause.type ?? "local_error",
    code: cause.code ?? "stage5a_bank_setup_failed",
    detail: cause.message?.replace(/[A-Za-z0-9]{24,}/g, "<redacted>").slice(0, 400),
  }));
  process.exitCode = 1;
});
