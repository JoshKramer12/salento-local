"use client";

import { useCallback, useRef, useState } from "react";

import {
  beginPaymentQrAttempt,
  finishPaymentQrAttempt,
  getPaymentQrOpeningError,
  type PaymentQrMethod,
  type PaymentQrSelectionResult,
} from "@/lib/payment-qr-navigation";

type OpenPaymentQrAction = (formData: FormData) => Promise<PaymentQrSelectionResult>;

export function usePaymentQrTransition({
  action,
  locale,
  navigate,
}: {
  action: OpenPaymentQrAction;
  locale: "en" | "it";
  navigate: (destination: string) => void;
}) {
  const attemptGate = useRef(false);
  const [error, setError] = useState("");
  const [pendingMethod, setPendingMethod] = useState<PaymentQrMethod | null>(null);

  const openPaymentQr = useCallback(
    (method: PaymentQrMethod, formData: FormData) => {
      if (!beginPaymentQrAttempt(attemptGate)) {
        return false;
      }

      setError("");
      setPendingMethod(method);

      void action(formData)
        .then((result) => {
          if (result.ok) {
            navigate(result.destination);
            return;
          }

          setError(result.error);
        })
        .catch(() => {
          setError(getPaymentQrOpeningError(locale));
        })
        .finally(() => {
          finishPaymentQrAttempt(attemptGate);
          setPendingMethod(null);
        });

      return true;
    },
    [action, locale, navigate],
  );

  return {
    error,
    openPaymentQr,
    pendingMethod,
  };
}
