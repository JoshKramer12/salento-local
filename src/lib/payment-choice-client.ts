"use client";

import type { PaymentQrSelectionResult } from "@/lib/payment-qr-navigation";

function isPaymentQrSelectionResult(value: unknown): value is PaymentQrSelectionResult {
  if (!value || typeof value !== "object" || !("ok" in value)) {
    return false;
  }

  if (value.ok === true) {
    return (
      "destination" in value &&
      typeof value.destination === "string" &&
      value.destination.startsWith("/")
    );
  }

  return value.ok === false && "error" in value && typeof value.error === "string";
}

/**
 * Payment selection deliberately uses a stable JSON endpoint instead of a
 * Server Action. A payment click must not participate in the App Router's RSC
 * refresh/action queue or depend on a build-specific Server Action id.
 */
export async function requestPaymentQr(
  formData: FormData,
  fetchImplementation: typeof fetch = fetch,
): Promise<PaymentQrSelectionResult> {
  const response = await fetchImplementation("/api/publish/payment-choice", {
    body: formData,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
    method: "POST",
  });
  const result: unknown = await response.json();

  if (!response.ok || !isPaymentQrSelectionResult(result)) {
    throw new Error("invalid_payment_choice_response");
  }

  return result;
}
