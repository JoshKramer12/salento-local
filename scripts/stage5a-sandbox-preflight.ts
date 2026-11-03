import Stripe from "stripe";
import { existsSync, lstatSync } from "node:fs";
import { dirname } from "node:path";
import { assertStage5aSandboxIsolation } from "@/lib/stage5a-sandbox-isolation";

async function main() {
  const config = assertStage5aSandboxIsolation(process.env);
  const databasePath = config.databaseUrl.slice("file:".length);
  const directory = dirname(databasePath);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory() ||
      lstatSync(directory).isSymbolicLink() ||
      (existsSync(databasePath) && (!lstatSync(databasePath).isFile() || lstatSync(databasePath).isSymbolicLink()))) {
    throw new Error("stage5a_database_path_unsafe");
  }
  const stripe = new Stripe(config.secretKey);
  const [account, balance, endpoints] = await Promise.all([
    stripe.accounts.retrieve(null),
    stripe.balance.retrieve(),
    stripe.webhookEndpoints.list({ limit: 100 }),
  ]);
  if (account.id !== config.accountId || balance.livemode !== false) {
    throw new Error("stage5a_account_or_mode_mismatch");
  }
  if (endpoints.has_more || endpoints.data.length !== 0) {
    throw new Error("stage5a_webhook_destinations_require_review");
  }
  console.log(JSON.stringify({
    verified: true,
    accountId: account.id,
    stripeMode: "test",
    currencyAvailableCents: balance.available
      .filter((entry) => entry.currency === "eur")
      .reduce((sum, entry) => sum + entry.amount, 0),
    existingWebhookEndpoints: 0,
  }));
}

main().catch((error: unknown) => {
  // Stripe errors can contain request details. Keep credentials and account data out of logs.
  const knownCode = error instanceof Error && error.message.startsWith("stage5a_")
    ? error.message : "stage5a_provider_preflight_failed";
  console.error(knownCode);
  process.exitCode = 1;
});
