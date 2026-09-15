import { NextResponse } from "next/server";
import { runDailyMembershipReminderJob } from "@/lib/membership-reminders";
import { normalizeEnvValue } from "@/lib/env";

export async function POST(request: Request) {
  const secret = normalizeEnvValue(process.env.MEMBERSHIP_REMINDER_CRON_SECRET);
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runDailyMembershipReminderJob());
}
