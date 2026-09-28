import { InitialRefundExperience } from "@/components/account/initial-refund-experience";
import { redirect } from "next/navigation";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { canManageBusiness } from "@/lib/business-owner-access";
import { isBusinessMembershipPublic } from "@/lib/business-membership";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { findInitialRefundForBusiness } from "@/lib/self-service-refunds";
import { refundAmount } from "@/lib/refund-display";

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ status?: string; payment?: string }> };
export default async function InitialRefundPage({ params, searchParams }: Props) {
  const [viewer, locale, { businessId }, query] = await Promise.all([requireCompletedViewer(), getCurrentLocale(), params, searchParams]);
  if (viewer.role !== "BUSINESS_OWNER" || !await canManageBusiness({ businessId, userId: viewer.id })) redirect("/dashboard");
  const [business, refund] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true, membership: { select: { entitlementRevokedAt: true, graceEndsAt: true } } } }),
    findInitialRefundForBusiness(businessId),
  ]);
  if (!business) redirect("/dashboard");
  const historicalPayment = query.payment && query.payment !== refund.payment?.id
    ? await prisma.payment.findFirst({ where: { id: query.payment, purpose: "INITIAL_MEMBERSHIP", OR: [{ businessId }, { businessId: null, businessSubmission: { is: { createdBusiness: { is: { id: businessId } } } } }] } })
    : null;
  const payment = historicalPayment ?? refund.payment;
  // Historical details are read-only: actions continue to target the current candidate.
  const historical = Boolean(historicalPayment);

  return <InitialRefundExperience businessId={businessId} businessName={business.name} paymentId={payment?.id} amount={payment ? refundAmount(locale, payment.status === "REFUNDED" ? payment.refundedAmountCents ?? payment.amountCents : payment.amountCents, payment.currency) : "—"} locale={locale} state={historical ? "UNAVAILABLE" : refund.state} canCheck={!historical} payment={payment} deadline={historical ? null : refund.deadline} listingActive={isBusinessMembershipPublic(business.membership ?? {})} ownerEmail={viewer.email || null} error={query.status} />;
}
