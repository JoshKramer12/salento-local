import { InitialRefundExperience } from "@/components/account/initial-refund-experience";
import type { InitialRefundState } from "@/lib/self-service-refunds";
import type { RefundDisplayPayment } from "@/lib/refund-display";

export function BankRefundRequest(props: {
  businessId: string; businessName: string; paymentId: string; amount: string; requestedAt: Date | null; state: InitialRefundState;
  locale: "en" | "it"; ownerEmail: string | null; error?: string; deadline?: Date | null;
  listingActive?: boolean; payment?: RefundDisplayPayment | null;
}) {
  return <InitialRefundExperience {...props} listingActive={props.listingActive ?? props.state !== "REFUNDED"} payment={props.payment ?? {
    status: props.state === "REFUNDED" ? "REFUNDED" : "PAID", method: "BANK_TRANSFER", refundRequestedAt: props.requestedAt,
    refundStatus: ({ SUPPORT_REQUIRED: "support_required", SUPPORT_CLOSED: "support_closed", ACTION_REQUIRED: "requires_action", FAILED: "failed" } as Record<string, string>)[props.state] ?? null,
  }} />;
}
