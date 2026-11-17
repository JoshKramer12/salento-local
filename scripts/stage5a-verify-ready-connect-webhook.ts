import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { POST } from "@/app/api/stripe/connect-webhook/route";
import { prisma } from "@/lib/prisma";
import { assertStage5aSandboxIsolation } from "@/lib/stage5a-sandbox-isolation";
import { withVerifiedStage5aSandbox } from "@/lib/partner-withdrawal-sandbox-context";

const PARTNER_ID = "partner-stage5a-primary";
const CONNECTED_ID = "acct_1UXlICGlpyfRSSMc";

async function main() {
  const config = assertStage5aSandboxIsolation(process.env);
  const directory = dirname(config.databaseUrl.slice("file:".length));
  const payload = readFileSync(`${directory}/connect-v2-event-payload`, "utf8");
  const signature = readFileSync(`${directory}/connect-v2-event-signature`, "utf8");
  const secret = readFileSync(`${directory}/connect-v2-listener-secret`, "utf8");
  const event = JSON.parse(payload) as { id: string; type: string; account?: string; livemode: boolean };
  if (event.type !== "account.updated" || event.account !== CONNECTED_ID ||
      event.livemode !== false || !signature.startsWith("t=") || !secret.startsWith("whsec_")) {
    throw new Error("stage5a_v2_event_mismatch");
  }
  await withVerifiedStage5aSandbox(PARTNER_ID, async () => {
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = secret;
    const request = () => new Request("http://localhost/api/stripe/connect-webhook", {
      method: "POST", body: payload, headers: { "stripe-signature": signature },
    });
    const valid = await POST(request());
    const duplicate = await POST(request());
    const validBody = await valid.json() as { received?: boolean };
    const duplicateBody = await duplicate.json() as { duplicate?: boolean };
    const log = await prisma.stripeWebhookEvent.findUnique({ where: { stripeEventId: event.id } });
    const profile = await prisma.localPartnerProfile.findUnique({ where: { userId: PARTNER_ID } });
    if (valid.status !== 200 || !validBody.received || duplicate.status !== 200 ||
        !duplicateBody.duplicate || log?.status !== "PROCESSED" || log.attemptCount !== 1 ||
        log.stripeAccountId !== CONNECTED_ID || log.livemode !== false ||
        profile?.stripeConnectedAccountId !== CONNECTED_ID ||
        profile.stripeAccountStatus !== "READY" || !profile.stripePayoutsEnabled ||
        !profile.stripeOnboardingComplete || profile.stripePayoutAccountLast4 !== "3456") {
      throw new Error("stage5a_v2_webhook_result_mismatch");
    }
    console.log(JSON.stringify({ eventId: event.id, accountId: CONNECTED_ID,
      validStatus: valid.status, duplicate: duplicateBody.duplicate,
      durableStatus: log.status, attemptCount: log.attemptCount,
      localPartnerStatus: profile.stripeAccountStatus }));
  });
}

main().catch((error: unknown) => {
  const known = error instanceof Error && error.message.startsWith("stage5a_")
    ? error.message : "stage5a_v2_webhook_verification_failed";
  console.error(known);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
