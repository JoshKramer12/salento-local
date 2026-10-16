"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { canManageBusiness } from "@/lib/business-owner-access";
import { ensureMembershipElementPayment } from "@/lib/membership-element-payment";
import { inspectMembershipRenewalRecovery } from "@/lib/membership-renewal-recovery";
import { prisma } from "@/lib/prisma";
import { getStringValue } from "@/lib/validation";
import { getStripe } from "@/lib/stripe";

export async function startMembershipRenewalAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const businessId = getStringValue(formData.get("businessId")).trim();
  if (!businessId || !(await canManageBusiness({ businessId, userId: viewer.id }))) redirect("/dashboard");
  const recovery = await inspectMembershipRenewalRecovery(businessId);
  if (recovery.state === "ready") redirect(recovery.url);
  if (recovery.state === "blocked") redirect("/dashboard/membership/recovery-unavailable");
  const payment = await ensureMembershipElementPayment({ businessId, userId: viewer.id });
  if (!payment) redirect("/dashboard?membership=unavailable");
  redirect(`/dashboard/membership/payment?payment=${encodeURIComponent(payment.id)}`);
}

export async function startMembershipBankTransferAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const businessId = getStringValue(formData.get("businessId")).trim();
  if (!businessId || !(await canManageBusiness({ businessId, userId: viewer.id }))) redirect("/dashboard");
  const recovery = await inspectMembershipRenewalRecovery(businessId);
  if (recovery.state === "ready") redirect(recovery.url);
  if (recovery.state === "blocked") redirect("/dashboard/membership/recovery-unavailable");
  redirect(`/dashboard/membership/bank-transfer?business=${encodeURIComponent(businessId)}`);
}

export async function recoverFailedMembershipRenewalAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const businessId = getStringValue(formData.get("businessId")).trim();
  if (viewer.role !== "BUSINESS_OWNER" || !businessId ||
    !(await canManageBusiness({ businessId, userId: viewer.id }))) redirect("/dashboard");
  const recovery = await inspectMembershipRenewalRecovery(businessId);
  if (recovery.state !== "ready") redirect("/dashboard/membership/recovery-unavailable");
  redirect(recovery.url);
}

export async function turnOffMembershipAutoRenewAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const businessId = getStringValue(formData.get("businessId")).trim();
  if (!businessId || !(await canManageBusiness({ businessId, userId: viewer.id }))) redirect("/dashboard");
  const membership = await prisma.businessMembership.findUnique({ where: { businessId } });
  if (membership?.stripeSubscriptionId) await getStripe().subscriptions.update(membership.stripeSubscriptionId, { cancel_at_period_end: true });
  await prisma.businessMembership.updateMany({ where: { businessId }, data: { automaticRenewal: false, recurringPaymentReady: false, stripeCancelAtPeriodEnd: true, stripeSubscriptionStatus: "canceling" } });
  revalidatePath("/dashboard");
}

export async function turnOnMembershipAutoRenewAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const businessId = getStringValue(formData.get("businessId")).trim();
  if (!businessId || !(await canManageBusiness({ businessId, userId: viewer.id }))) redirect("/dashboard");
  const membership = await prisma.businessMembership.findUnique({ where: { businessId } });
  const subscription = membership?.stripeSubscriptionId
    ? await getStripe().subscriptions.retrieve(membership.stripeSubscriptionId) : null;
  if (membership && subscription && ["active", "trialing"].includes(subscription.status) && !subscription.cancel_at_period_end) {
    await prisma.businessMembership.update({ where: { id: membership.id }, data: {
      automaticRenewal: true, recurringPaymentReady: true,
      stripeCancelAtPeriodEnd: false, stripeSubscriptionStatus: subscription.status,
    } });
    revalidatePath("/dashboard");
    return;
  }
  if (membership?.stripeSubscriptionId && subscription &&
    ["active", "trialing"].includes(subscription.status) && subscription.cancel_at_period_end) {
    await getStripe().subscriptions.update(membership.stripeSubscriptionId, { cancel_at_period_end: false });
    await prisma.businessMembership.update({ where: { id: membership.id }, data: { automaticRenewal: true, recurringPaymentReady: true, stripeCancelAtPeriodEnd: false, stripeSubscriptionStatus: "active" } });
    revalidatePath("/dashboard");
    return;
  }
  // Fresh recurring authority uses the shared invoice-backed Payment Element.
  const payment = await ensureMembershipElementPayment({ automaticRenewal: true, businessId, userId: viewer.id });
  if (!payment) redirect("/dashboard?membership=setup-unavailable");
  redirect(`/dashboard/membership/payment?payment=${encodeURIComponent(payment.id)}`);
}
