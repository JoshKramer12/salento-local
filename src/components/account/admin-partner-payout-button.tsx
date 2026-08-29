"use client";

import { startTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  runPartnerPayoutNowAction,
  type PartnerPayoutActionState,
} from "@/app/(account)/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { formatCurrencyFromCents } from "@/lib/account";
import type { Locale } from "@/lib/i18n";

const initialState: PartnerPayoutActionState = {
  status: "idle",
};

type AdminPartnerPayoutButtonProps = {
  className?: string;
  containerClassName?: string;
  locale: Locale;
  wide?: boolean;
};

export function AdminPartnerPayoutButton({
  className = "btn-primary",
  containerClassName = "",
  locale,
  wide = false,
}: AdminPartnerPayoutButtonProps) {
  const [state, action] = useActionState(runPartnerPayoutNowAction, initialState);
  const router = useRouter();
  const copy =
    locale === "it"
      ? {
          cta: "Paga tutti i partner ora",
          pending: "Pagamento partner in corso...",
        }
      : {
          cta: "Pay all partners now",
          pending: "Starting partner payouts...",
        };

  useEffect(() => {
    if (state.status === "success" || state.status === "partial" || state.status === "failed") {
      startTransition(() => {
        router.refresh();
      });
    }
  }, [router, state.status]);

  const toneClass =
    state.status === "error" || state.status === "failed"
      ? "border border-[rgba(217,108,59,0.28)] bg-[rgba(217,108,59,0.1)]"
      : state.status === "partial"
        ? "border border-[rgba(191,91,42,0.2)] bg-[rgba(191,91,42,0.08)]"
        : state.status === "success"
          ? "border border-[rgba(42,98,87,0.24)] bg-[rgba(42,98,87,0.08)]"
          : "";

  return (
    <div className={`grid gap-3 ${containerClassName}`.trim()}>
      <form action={action}>
        <input type="hidden" name="locale" value={locale} />
        <FormSubmitButton
          className={`${className}${wide ? " w-full justify-center" : ""}`}
          pendingLabel={copy.pending}
        >
          {copy.cta}
        </FormSubmitButton>
      </form>

      {state.status !== "idle" && state.message ? (
        <div
          className={`rounded-[1.4rem] px-4 py-3 text-sm leading-7 text-[var(--foreground)] sm:px-5 ${toneClass}`}
        >
          <p>{state.message}</p>
          {state.sentAmountCents ? (
            <p className="mt-2 font-medium">
              {locale === "it" ? "Importo avviato" : "Amount started"}:{" "}
              {formatCurrencyFromCents(state.sentAmountCents, locale)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
