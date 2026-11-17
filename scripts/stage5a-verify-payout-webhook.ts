import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { POST } from "@/app/api/stripe/connect-webhook/route";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { assertStage5aSandboxIsolation } from "@/lib/stage5a-sandbox-isolation";
import { withVerifiedStage5aSandbox } from "@/lib/partner-withdrawal-sandbox-context";

const PARTNER_ID = "partner-stage5a-primary";
const CONNECTED_ID = "acct_1UXlICGlpyfRSSMc";
const REQUEST_KEY = "stage5a-eur-withdrawal-0001";
const EVENT_ID = "evt_1UcmejGlpyfRSSMc8ASLxzC5";
const PAYOUT_ID = "po_1UcmeiGlpyfRSSMcI8W9hkLC";
let stage = "initial";

async function main() {
  const config = assertStage5aSandboxIsolation(process.env);
  stage = "read_secret";
  const secret = readFileSync(`${dirname(config.databaseUrl.slice(5))}/connect-payout-listener-secret`, "utf8").trim();
  if (!secret.startsWith("whsec_")) throw new Error("stage5a_payout_listener_secret_missing");
  await withVerifiedStage5aSandbox(PARTNER_ID, async () => {
    stage = "read_withdrawal";
    const stripe = getStripe();
    const withdrawal = await prisma.partnerWithdrawal.findUnique({ where: {
      partnerUserId_requestKey: { partnerUserId: PARTNER_ID, requestKey: REQUEST_KEY },
    } });
    if (!withdrawal || withdrawal.status !== "PROCESSING" ||
        withdrawal.stripeConnectedAccountId !== CONNECTED_ID ||
        withdrawal.requestedAmountCents !== 5000) {
      throw new Error("stage5a_payout_withdrawal_mismatch");
    }
    stage = "retrieve_event";
    const event = await stripe.events.retrieve(EVENT_ID, {}, { stripeAccount: CONNECTED_ID });
    stage = "check_event";
    const payout = event.data.object;
    if (event.type !== "payout.paid" || event.livemode !== false ||
        event.account !== CONNECTED_ID || payout.object !== "payout" ||
        payout.id !== PAYOUT_ID || payout.livemode !== false ||
        payout.status !== "paid" || payout.amount !== 5000 ||
        payout.currency !== "eur" ||
        payout.metadata.partnerWithdrawalId !== withdrawal.id) {
      throw new Error("stage5a_payout_event_mismatch");
    }
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = secret;
    const request = (header: string) => new Request("http://localhost/api/stripe/connect-webhook", {
      method: "POST", body: payload, headers: { "stripe-signature": header },
    });
    const invalid = await POST(request("t=1,v1=invalid"));
    stage = "valid_webhook";
    const valid = await POST(request(signature));
    stage = "duplicate_webhook";
    const duplicate = await POST(request(signature));
    stage = "check_result";
    const validBody = await valid.json() as { received?: boolean };
    const duplicateBody = await duplicate.json() as { duplicate?: boolean };
    const [after, commission, log] = await Promise.all([
      prisma.partnerWithdrawal.findUnique({ where: { id: withdrawal.id }, include: { payout: true } }),
      prisma.partnerCommission.findUnique({ where: { id: "commission-stage5a-eur" } }),
      prisma.stripeWebhookEvent.findUnique({ where: { stripeEventId: EVENT_ID } }),
    ]);
    if (invalid.status !== 400 || valid.status !== 200 || !validBody.received ||
        duplicate.status !== 200 || !duplicateBody.duplicate ||
        after?.status !== "PAID" || after.payout?.stripePayoutId !== PAYOUT_ID ||
        commission?.status !== "PAID" || log?.status !== "PROCESSED" ||
        log.attemptCount !== 1 || log.stripeAccountId !== CONNECTED_ID ||
        log.livemode !== false) {
      throw new Error("stage5a_payout_webhook_result_mismatch");
    }
    console.log(JSON.stringify({ eventId: EVENT_ID, withdrawalId: withdrawal.id,
      payoutId: PAYOUT_ID, invalidSignatureStatus: invalid.status,
      validStatus: valid.status, duplicate: duplicateBody.duplicate,
      withdrawalStatus: after.status, commissionStatus: commission.status,
      durableStatus: log.status, attemptCount: log.attemptCount,
      signatureSource: "local test signature using Stripe CLI listener secret and actual Stripe event" }));
  });
}

main().catch((error: unknown) => {
  const known = error instanceof Error && error.message.startsWith("stage5a_")
    ? error.message : "stage5a_payout_webhook_verification_failed";
  const providerError = error as { type?: string; code?: string; statusCode?: number } | null;
  console.error(known, stage, providerError?.type ?? "", providerError?.code ?? "", providerError?.statusCode ?? "");
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
