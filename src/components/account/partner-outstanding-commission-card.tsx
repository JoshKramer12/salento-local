"use client";

import { useState } from "react";
import {
  IconChevronDown,
  IconChevronUp,
  IconCircleCheckFilled,
  IconClock,
} from "@tabler/icons-react";

import { formatCurrencyFromCents } from "@/lib/account";
import type { Locale } from "@/lib/i18n";

type OutstandingCommissionItem = {
  amountCents: number;
  businessName: string;
  id: string;
  status: "AVAILABLE" | "PENDING" | "RESERVED";
  display?: { label: string; detail: string; tone: "green" | "yellow" | "red" };
};

type PartnerOutstandingCommissionCardProps = {
  amountCents: number;
  items: OutstandingCommissionItem[];
  locale: Locale;
};

export function PartnerOutstandingCommissionCard({
  amountCents,
  items,
  locale,
}: PartnerOutstandingCommissionCardProps) {
  const [open, setOpen] = useState(false);
  const copy =
    locale === "it"
      ? {
          approved: "Pagamento approvato",
          empty: "Non ci sono ancora commissioni da mostrare.",
          openLabel: "Mostra dettagli",
          closeLabel: "Nascondi dettagli",
          title: "Da pagare",
        }
      : {
          approved: "Payment approved",
          empty: "There are no commission items to show yet.",
          openLabel: "Show details",
          closeLabel: "Hide details",
          title: "To be paid",
        };

  return (
    <article className="card overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="w-full px-5 py-5 text-left"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-[var(--muted)]">{copy.title}</p>
            <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
              {formatCurrencyFromCents(amountCents, locale)}
            </p>
          </div>
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
            {open ? copy.closeLabel : copy.openLabel}
            {open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </span>
        </div>
      </button>

      {open ? (
        <div className="border-t border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] px-5 py-4">
          <div className="grid gap-3">
            {items.length ? (
              items.map((item) => {
                const approved = item.display ? item.display.tone === "green" : item.status !== "PENDING";

                return (
                  <div
                    key={item.id}
                    className="rounded-[1.15rem] border border-[var(--border)] bg-white px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{item.businessName}</p>
                        <p
                          className={`mt-2 inline-flex items-center gap-2 text-sm ${
                            approved ? "text-[var(--primary)]" : "text-[var(--accent)]"
                          }`}
                        >
                          {approved ? (
                            <IconCircleCheckFilled size={16} />
                          ) : (
                            <IconClock size={16} />
                          )}
                          {item.display ? item.display.label : approved
                            ? copy.approved
                            : locale === "it"
                              ? "In attesa di approvazione del pagamento"
                              : "Awaiting payment approval"}
                        </p>{item.display?.detail ? <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{item.display.detail}</p> : null}
                      </div>
                      <p className="font-medium text-[var(--foreground)]">
                        {formatCurrencyFromCents(item.amountCents, locale)}
                      </p>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-[var(--muted)]">{copy.empty}</p>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}
