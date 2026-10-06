import { NextResponse } from "next/server";
import { runDailyMembershipReminderJob } from "@/lib/membership-reminders";
import { retryPendingMembershipPaymentOutcomes } from "@/lib/membership-payment-outcomes";
import { normalizeEnvValue } from "@/lib/env";

export async function POST(request: Request) {
  const secret = normalizeEnvValue(process.env.MEMBERSHIP_REMINDER_CRON_SECRET);
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const outcomes = await retryPendingMembershipPaymentOutcomes();
  // A frequent call can retry payment outcomes without rerunning daily reminders.
  if (new URL(request.url).searchParams.get("outcomes") === "only") return NextResponse.json({ outcomes });
  const reminders = await runDailyMembershipReminderJob();
  return NextResponse.json({ ...reminders, outcomes });
}
