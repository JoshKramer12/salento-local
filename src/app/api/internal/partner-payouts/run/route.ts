import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { runWeeklyPartnerPayouts } from "@/lib/partner-ledger";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request: Request) {
  const configuredSecret = process.env.PAYOUT_JOB_SECRET?.trim();

  if (!configuredSecret) {
    return {
      authorized: false,
      status: 500,
      statusText: "payout_job_secret_not_configured",
    } as const;
  }

  const authorizationHeader = request.headers.get("authorization")?.trim() || "";
  const bearerToken = authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length).trim()
    : "";
  const headerSecret = request.headers.get("x-payout-job-secret")?.trim() || "";
  const providedSecret = bearerToken || headerSecret;

  if (!providedSecret || !safeEqual(providedSecret, configuredSecret)) {
    return {
      authorized: false,
      status: 401,
      statusText: "unauthorized",
    } as const;
  }

  return {
    authorized: true,
  } as const;
}

async function handleRequest(request: Request) {
  const authorization = isAuthorized(request);

  if (!authorization.authorized) {
    return NextResponse.json(
      { error: authorization.statusText },
      { status: authorization.status },
    );
  }

  const { searchParams } = new URL(request.url);
  const force =
    searchParams.get("force") === "1" ||
    searchParams.get("force") === "true";
  const result = await runWeeklyPartnerPayouts({
    force,
  });

  return NextResponse.json({
    ok: true,
    result: {
      ...result,
      scheduledFor:
        result.scheduledFor instanceof Date
          ? result.scheduledFor.toISOString()
          : result.scheduledFor,
    },
  });
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
