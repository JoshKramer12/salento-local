import type { PaymentMethod } from "@prisma/client";

export type PaymentQrMethod = Extract<PaymentMethod, "ONLINE" | "BANK_TRANSFER">;

export type PaymentQrAttemptGate = { current: boolean };

export function beginPaymentQrAttempt(gate: PaymentQrAttemptGate) {
  if (gate.current) {
    return false;
  }

  gate.current = true;
  return true;
}

export function finishPaymentQrAttempt(gate: PaymentQrAttemptGate) {
  gate.current = false;
}

export function buildPaymentQrDestination(submissionId: string) {
  const normalizedSubmissionId = submissionId.trim();

  if (!normalizedSubmissionId) {
    throw new Error("A submission id is required to open a payment QR.");
  }

  return `/publish/payment?submission=${encodeURIComponent(normalizedSubmissionId)}`;
}

/**
 * Keeps both payment choices on one explicit, test-covered contract: prepare
 * the selected provider resource, then navigate to the QR page for that submission.
 */
export async function preparePaymentQrNavigation({
  method,
  prepareBankTransfer,
  prepareOnline,
  submissionId,
}: {
  method: PaymentQrMethod;
  prepareBankTransfer: () => Promise<unknown>;
  prepareOnline: () => Promise<unknown>;
  submissionId: string;
}) {
  if (method === "ONLINE") {
    await prepareOnline();
  } else {
    await prepareBankTransfer();
  }

  return buildPaymentQrDestination(submissionId);
}

export function getPaymentQrOpeningError(locale: "en" | "it") {
  return locale === "it"
    ? "Non siamo riusciti ad aprire il QR di pagamento. Riprova tra un momento."
    : "We couldn't open the payment QR. Please try again in a moment.";
}
