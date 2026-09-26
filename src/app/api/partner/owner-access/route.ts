import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { deliverPartnerOwnerAccess, getPartnerOwnerAccessContext, isValidPartnerSubmissionId } from "@/lib/partner-owner-access";
import { hasSameOriginOrNoOrigin } from "@/lib/request-security";
import { consumeSecurityRateLimit } from "@/lib/security-rate-limit";

async function partner() {
  const session = await auth();
  return session?.user?.role === "GETTER" ? session.user : null;
}

export async function GET(request: Request) {
  const viewer = await partner();
  if (!viewer?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const submissionId = new URL(request.url).searchParams.get("submission");
  if (!isValidPartnerSubmissionId(submissionId)) return NextResponse.json({ error: "invalid_submission" }, { status: 400 });
  const context = await getPartnerOwnerAccessContext({ partnerId: viewer.id, submissionId });
  if (!context) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ email: Boolean(context.email), whatsapp: Boolean(context.phone) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const viewer = await partner();
  if (!viewer?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSameOriginOrNoOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!isValidPartnerSubmissionId(input.submissionId) || (input.method !== "email" && input.method !== "whatsapp")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const context = await getPartnerOwnerAccessContext({ partnerId: viewer.id, submissionId: input.submissionId });
  if (!context) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (input.method === "email" && !context.email || input.method === "whatsapp" && !context.phone) {
    return NextResponse.json({ error: "unavailable" }, { status: 400 });
  }
  const limit = await consumeSecurityRateLimit({
    clientAddress: "authenticated-partner",
    namespace: `partner-owner-access-${input.method}`,
    subject: `${viewer.id}:${input.submissionId}`,
    limit: input.method === "email" ? 1 : 10,
    windowMs: input.method === "email" ? 5 * 60_000 : 60_000,
  });
  if (!limit.allowed) return NextResponse.json({ error: "cooldown", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });
  try {
    const result = await deliverPartnerOwnerAccess({
      locale: request.headers.get("accept-language")?.toLowerCase().startsWith("it") ? "it" : "en",
      method: input.method,
      partnerId: viewer.id,
      submissionId: input.submissionId,
    });
    if (result.status === "unavailable") return NextResponse.json({ error: "unavailable" }, { status: 400 });
    if (result.status === "delivery_unavailable") return NextResponse.json({ error: "delivery_unavailable" }, { status: 503 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "delivery_failed" }, { status: 503 });
  }
}
