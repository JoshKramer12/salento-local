"use server";

import { redirect } from "next/navigation";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { requestInitialRefund } from "@/lib/self-service-refunds";

export async function confirmInitialRefundAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const businessId = String(formData.get("businessId") ?? "");
  if (viewer.role !== "BUSINESS_OWNER" || !businessId) redirect("/dashboard");
  let status = "check";
  try {
    const result = await requestInitialRefund({ businessId, userId: viewer.id, locale: await getCurrentLocale(), instructionsEmail: String(formData.get("instructionsEmail") ?? "") });
    status = result.status === "succeeded" ? "refunded" : "processing";
  } catch (error) {
    console.error("[refund:request]", { businessId, error });
    if (error instanceof Error && (error.message === "refund_bank_email_required" || error.message === "refund_contact_email_required")) status = "email_required";
  }
  redirect(`/dashboard/refund/${encodeURIComponent(businessId)}?status=${status}`);
}

export async function checkInitialRefundStatusAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const businessId = String(formData.get("businessId") ?? "");
  if (viewer.role !== "BUSINESS_OWNER" || !businessId) redirect("/dashboard");
  try { await requestInitialRefund({ businessId, userId: viewer.id }); }
  catch (error) { console.error("[refund:check]", { businessId, error }); }
  redirect(`/dashboard/refund/${encodeURIComponent(businessId)}`);
}
