"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { canManageBusiness } from "@/lib/business-owner-access";
import { ensureMembershipRenewalCheckout } from "@/lib/membership-renewal-checkout";
import { prisma } from "@/lib/prisma";
import { getOriginFromHeaders } from "@/lib/request-origin";
import { getStringValue } from "@/lib/validation";
import { getStripe } from "@/lib/stripe";

export async function startMembershipRenewalAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const businessId = getStringValue(formData.get("businessId")).trim();
  if (!businessId || !(await canManageBusiness({ businessId, userId: viewer.id }))) redirect("/dashboard");
  const session = await ensureMembershipRenewalCheckout({ appUrl: getOriginFromHeaders(await headers()), businessId, userId: viewer.id });
  if (!session?.url) redirect("/dashboard?membership=unavailable");
  redirect(session.url);
}

export async function startMembershipBankTransferAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const businessId = getStringValue(formData.get("businessId")).trim();
  if (!businessId || !(await canManageBusiness({ businessId, userId: viewer.id }))) redirect("/dashboard");
  redirect(`/dashboard/membership/bank-transfer?business=${encodeURIComponent(businessId)}`);
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
  if (membership?.stripeSubscriptionId && membership.stripeCancelAtPeriodEnd) {
    await getStripe().subscriptions.update(membership.stripeSubscriptionId, { cancel_at_period_end: false });
    await prisma.businessMembership.update({ where: { id: membership.id }, data: { automaticRenewal: true, recurringPaymentReady: true, stripeCancelAtPeriodEnd: false, stripeSubscriptionStatus: "active" } });
    revalidatePath("/dashboard");
    return;
  }
  // A canceled/no-card subscription is never switched on locally. Stripe
  // Checkout collects fresh recurring authority and charges the next term.
  const session = await ensureMembershipRenewalCheckout({ appUrl: getOriginFromHeaders(await headers()), automaticRenewal: true, businessId, userId: viewer.id });
  if (!session?.url) redirect("/dashboard?membership=setup-unavailable");
  redirect(session.url);
}
