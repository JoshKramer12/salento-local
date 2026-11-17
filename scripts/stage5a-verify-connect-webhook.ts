import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { withVerifiedStage5aSandbox } from "@/lib/partner-withdrawal-sandbox-context";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/stripe/connect-webhook/route";
import { assertStage5aSandboxIsolation } from "@/lib/stage5a-sandbox-isolation";

const CONNECTED_ID = "acct_1UXijnGlpytZm7rC";
const PARTNER_ID = "partner-stage5a-primary";

async function main() {
  const config = assertStage5aSandboxIsolation(process.env);
  const directory = dirname(config.databaseUrl.slice("file:".length));
  const payload = readFileSync(`${directory}/connect-event-payload`, "utf8");
  const signature = readFileSync(`${directory}/connect-event-signature`, "utf8");
  const secret = readFileSync(`${directory}/connect-listener-secret`, "utf8");
  const event = JSON.parse(payload) as { id: string; type: string; livemode: boolean; account?: string };
  if (event.type !== "account.updated" || event.livemode !== false ||
      event.account !== CONNECTED_ID || !/^evt_[A-Za-z0-9]+$/.test(event.id) ||
      !signature.startsWith("t=") || !secret.startsWith("whsec_")) {
    throw new Error("stage5a_captured_event_mismatch");
  }
  const request = (header?: string) => new Request("http://localhost/api/stripe/connect-webhook", {
    method: "POST", body: payload,
    headers: header ? { "stripe-signature": header } : {},
  });
  await withVerifiedStage5aSandbox(PARTNER_ID, async () => {
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = secret;
    const [missing, invalid] = await Promise.all([
      POST(request()), POST(request("t=1,v1=invalid")),
    ]);
    if (missing.status !== 400 || invalid.status !== 400) {
      throw new Error("stage5a_invalid_signature_accepted");
    }
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_wrong_sandbox_test";
    const wrongSecret = await POST(request(signature));
    if (wrongSecret.status !== 400) throw new Error("stage5a_wrong_secret_accepted");
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = secret;
    const valid = await POST(request(signature));
    const duplicate = await POST(request(signature));
    const validBody = await valid.json() as { received?: boolean };
    const duplicateBody = await duplicate.json() as { duplicate?: boolean };
    const log = await prisma.stripeWebhookEvent.findUnique({ where: { stripeEventId: event.id } });
    const profile = await prisma.localPartnerProfile.findUnique({ where: { userId: PARTNER_ID } });
    if (valid.status !== 200 || !validBody.received || duplicate.status !== 200 ||
        !duplicateBody.duplicate || log?.status !== "PROCESSED" ||
        log?.endpointType !== "CONNECT" || log?.livemode !== false ||
        log?.stripeAccountId !== CONNECTED_ID || log.attemptCount !== 1 ||
        profile?.stripeAccountStatus !== "INCOMPLETE" || profile.stripePayoutsEnabled ||
        profile.stripePayoutAccountLast4 !== "3456") {
      throw new Error("stage5a_signed_webhook_result_mismatch");
    }
    console.log(JSON.stringify({ eventId: event.id, type: event.type,
      accountId: CONNECTED_ID, validStatus: valid.status,
      missingStatus: missing.status, invalidStatus: invalid.status,
      wrongSecretStatus: wrongSecret.status, duplicate: duplicateBody.duplicate,
      durableStatus: log.status, attemptCount: log.attemptCount,
      localPartnerStatus: profile.stripeAccountStatus,
      localPayoutsEnabled: profile.stripePayoutsEnabled }));
  });
}

main().catch((error: unknown) => {
  const known = error instanceof Error && error.message.startsWith("stage5a_")
    ? error.message : "stage5a_webhook_verification_failed";
  console.error(known);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
