"use server";

import { redirect } from "next/navigation";
import { requireAdminViewer } from "@/lib/auth-guards";
import { closeBankRefundSupportRequest, reconcileBankRefundFromStripe } from "@/lib/bank-refund-support";

export async function verifyBankRefundAction(formData: FormData) {
  const viewer = await requireAdminViewer();
  const businessId = String(formData.get("businessId") ?? "");
  let notice = "verification_failed";
  try {
    const result = await reconcileBankRefundFromStripe({ userId: viewer.id, businessId, paymentId: String(formData.get("paymentId") ?? ""), refundId: String(formData.get("refundId") ?? "").trim() });
    notice = result.status === "succeeded" ? "verified" : "pending";
  } catch (error) { console.error("[bank-refund:verify]", { businessId, error: error instanceof Error ? error.message : "verification_failed" }); }
  redirect(`/dashboard/admin/memberships/${encodeURIComponent(businessId)}?refundNotice=${notice}`);
}

export async function closeBankRefundRequestAction(formData: FormData) {
  const viewer = await requireAdminViewer();
  const businessId = String(formData.get("businessId") ?? "");
  let notice = "closure_failed";
  try {
    if (formData.get("ownerWithdrawalConfirmed") !== "yes") throw new Error("owner_withdrawal_evidence_required");
    await closeBankRefundSupportRequest({ userId: viewer.id, businessId, paymentId: String(formData.get("paymentId") ?? ""), note: String(formData.get("note") ?? "") });
    notice = "closed";
  } catch (error) { console.error("[bank-refund:close]", { businessId, error: error instanceof Error ? error.message : "closure_failed" }); }
  redirect(`/dashboard/admin/memberships/${encodeURIComponent(businessId)}?refundNotice=${notice}`);
}
