import { createServer } from "node:http";
import { POST } from "@/app/api/stripe/connect-webhook/route";
import { prisma } from "@/lib/prisma";
import { assertStage5aSandboxIsolation } from "@/lib/stage5a-sandbox-isolation";
import { withVerifiedStage5aSandbox } from "@/lib/partner-withdrawal-sandbox-context";

const PARTNER_ID = "partner-stage5a-primary";
const MAX_BODY_BYTES = 1024 * 1024;

async function main() {
  assertStage5aSandboxIsolation(process.env);
  if (process.env.STAGE8_ISOLATED_FORWARDER !== "salento-stage8-connect" ||
      !/^whsec_[A-Za-z0-9]+$/.test(process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "") ||
      !/^acct_[A-Za-z0-9]+$/.test(process.env.STAGE8_EXPECTED_CONNECTED_ACCOUNT_ID ?? "")) {
    throw new Error("stage8_forwarder_configuration_invalid");
  }
  await withVerifiedStage5aSandbox(PARTNER_ID, async () => {
    const [users, payments, withdrawals] = await Promise.all([
      prisma.user.findMany({ select: { id: true, email: true } }),
      prisma.payment.findMany({ select: { stripeLivemode: true } }),
      prisma.partnerWithdrawal.findMany({ include: { attempts: true } }),
    ]);
    if (users.length !== 1 || users[0].id !== PARTNER_ID ||
        !users[0].email?.endsWith(".test") || payments.length !== 1 ||
        payments[0].stripeLivemode !== false || withdrawals.length !== 1 ||
        withdrawals[0].partnerUserId !== PARTNER_ID ||
        withdrawals[0].stripeConnectedAccountId !== process.env.STAGE8_EXPECTED_CONNECTED_ACCOUNT_ID ||
        withdrawals[0].requestedAmountCents !== 5000 || withdrawals[0].currency !== "eur" ||
        !withdrawals[0].attempts.some((item) => item.operation === "TRANSFER" && item.providerObjectId) ||
        !withdrawals[0].attempts.some((item) => item.operation === "PAYOUT" && item.providerObjectId)) {
      throw new Error("stage8_forwarder_fixture_invalid");
    }
  });

  const port = Number(process.env.STAGE8_FORWARDER_PORT ?? "3110");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("stage8_forwarder_port_invalid");
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"isolated":true}');
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/stripe/connect-webhook") {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > MAX_BODY_BYTES) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(bytes);
      }
      const signature = request.headers["stripe-signature"];
      const incoming = new Request(`http://127.0.0.1:${port}/api/stripe/connect-webhook`, {
        method: "POST",
        headers: typeof signature === "string" ? { "stripe-signature": signature } : {},
        body: Buffer.concat(chunks),
      });
      const handled = await withVerifiedStage5aSandbox(PARTNER_ID, () => POST(incoming));
      let eventId: string | null = null;
      let eventType: string | null = null;
      try {
        const event = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id?: unknown; type?: unknown };
        if (typeof event.id === "string" && /^evt_[A-Za-z0-9]+$/.test(event.id)) eventId = event.id;
        if (typeof event.type === "string" && /^payout\.[a-z]+$/.test(event.type)) eventType = event.type;
      } catch { /* The application route verifies and reports malformed payloads. */ }
      console.log(JSON.stringify({ eventId, eventType, status: handled.status }));
      response.writeHead(handled.status, { "content-type": "application/json" });
      response.end(await handled.text());
    } catch {
      response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"isolated_forwarder_failed"}');
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(JSON.stringify({ status: "isolated_forwarder_ready", port }));
  });
  const shutdown = () => server.close(() => { void prisma.$disconnect(); });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(() => {
  console.error("stage8_isolated_forwarder_start_failed");
  process.exitCode = 1;
});
