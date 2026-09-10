import type { ReactNode } from "react";

import type { PaymentQrMethod } from "@/lib/payment-qr-navigation";

export function PaymentChoiceButton({
  children,
  className,
  disabled,
  method,
  onSelect,
}: {
  children: ReactNode;
  className: string;
  disabled: boolean;
  method: PaymentQrMethod;
  onSelect: (method: PaymentQrMethod) => void;
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={() => onSelect(method)}
    >
      {children}
    </button>
  );
}
