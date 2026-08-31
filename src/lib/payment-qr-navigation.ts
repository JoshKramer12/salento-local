import type { PaymentMethod } from "@prisma/client";

export type PaymentQrMethod = Extract<PaymentMethod, "ONLINE" | "BANK_TRANSFER">;

export type PaymentQrAttemptGate = { current: boolean };

type PaymentQrActionResult = {
  error?: string;
  paymentDestination?: string;
};

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

/**
 * A payment action must resolve to exactly one public outcome. In particular,
 * a duplicate-check response is not a valid response to a payment-choice click.
 */
export function ensurePaymentQrActionResult<Result extends PaymentQrActionResult>({
  locale,
  onInvalidResult,
  result,
}: {
  locale: "en" | "it";
  onInvalidResult?: (reason: "ambiguous" | "conflicting") => void;
  result: Result;
}): Result {
  const hasDestination = Boolean(result.paymentDestination?.trim());
  const hasError = Boolean(result.error?.trim());

  if (hasDestination !== hasError) {
    return result;
  }

  onInvalidResult?.(hasDestination ? "conflicting" : "ambiguous");

  return {
    ...result,
    error: result.error?.trim() || getPaymentQrOpeningError(locale),
    paymentDestination: undefined,
  };
}
