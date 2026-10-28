import { NextResponse } from "next/server";
import { runDailyMembershipReminderJob } from "@/lib/membership-reminders";
import { retryPendingMembershipPaymentOutcomes } from "@/lib/membership-payment-outcomes";
import { retryPendingMembershipFailedPayments } from "@/lib/membership-failed-payments";
import { retryPendingPartnerCommissionConfirmations } from "@/lib/partner-commission-confirmations";
import { retryPendingPurchaseConfirmations } from "@/lib/purchase-confirmation-delivery";
import { normalizeEnvValue } from "@/lib/env";
import { retryPendingPayLaterBankInstructionsEmails, runPayLaterReminderJob } from "@/lib/pay-later-reminders";

export async function POST(request: Request) {
  const secret = normalizeEnvValue(process.env.MEMBERSHIP_REMINDER_CRON_SECRET);
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const outcomes = await retryPendingMembershipPaymentOutcomes();
  const failedPayments = await retryPendingMembershipFailedPayments();
  const partnerCommissions = await retryPendingPartnerCommissionConfirmations();
  const purchaseConfirmations = await retryPendingPurchaseConfirmations();
  const bankInstructions = await retryPendingPayLaterBankInstructionsEmails();
  // The 15-minute caller retries delivery without rerunning daily reminders.
  if (new URL(request.url).searchParams.get("outcomes") === "only") return NextResponse.json({ outcomes, failedPayments, partnerCommissions, purchaseConfirmations, bankInstructions });
  const reminders = await runDailyMembershipReminderJob();
  const payLater = await runPayLaterReminderJob();
  return NextResponse.json({ ...reminders, outcomes, failedPayments, partnerCommissions, purchaseConfirmations, bankInstructions, payLater });
}
