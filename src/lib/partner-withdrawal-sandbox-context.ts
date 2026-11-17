import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, lstatSync } from "node:fs";
import { dirname } from "node:path";
import Stripe from "stripe";
import { assertStage5aSandboxIsolation } from "@/lib/stage5a-sandbox-isolation";

type VerifiedSandbox = {
  accountId: string;
  databaseUrl: string;
  partnerUserId: string;
  secretKey: string;
};

const sandbox = new AsyncLocalStorage<VerifiedSandbox>();

/** Defaults to live-only. The sandbox context can only be created after a
 * read-only Stripe account and balance check in an isolated local process. */
export function withdrawalPaymentLivemode(partnerUserId?: string) {
  const context = sandbox.getStore();
  if (!context) return true;
  const config = assertStage5aSandboxIsolation(process.env);
  if (config.secretKey !== context.secretKey || config.databaseUrl !== context.databaseUrl ||
      config.accountId !== context.accountId ||
      (partnerUserId && partnerUserId !== context.partnerUserId)) {
    throw new Error("stage5a_sandbox_context_changed");
  }
  return false;
}

export function sandboxWithdrawalExecutionAllowed() {
  const context = sandbox.getStore();
  if (!context) return false;
  withdrawalPaymentLivemode(context.partnerUserId);
  return true;
}

export async function withVerifiedStage5aSandbox<T>(
  partnerUserId: string,
  run: () => Promise<T>,
): Promise<T> {
  const config = assertStage5aSandboxIsolation(process.env);
  if (!partnerUserId) throw new Error("stage5a_partner_identity_required");
  const databasePath = config.databaseUrl.slice("file:".length);
  const directory = dirname(databasePath);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory() ||
      lstatSync(directory).isSymbolicLink() || !existsSync(databasePath) ||
      !lstatSync(databasePath).isFile() || lstatSync(databasePath).isSymbolicLink()) {
    throw new Error("stage5a_database_path_unsafe");
  }
  const stripe = new Stripe(config.secretKey);
  const [account, balance] = await Promise.all([
    stripe.accounts.retrieve(null), stripe.balance.retrieve(),
  ]);
  if (account.id !== config.accountId || balance.livemode !== false) {
    throw new Error("stage5a_account_or_mode_mismatch");
  }
  return sandbox.run({ ...config, partnerUserId }, run);
}
