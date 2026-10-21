"use client";

import { useId, useState } from "react";
import { IconChevronDown, IconShieldCheck } from "@tabler/icons-react";

export function InitialPaymentRefundPolicy({ amount, locale }: { amount: string; locale: "en" | "it" }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const buttonId = `${panelId}-button`;
  const italian = locale === "it";
  const paymentAmount = italian ? `€${amount.replace("€", "").trim()}` : amount;

  return <section className="mt-4 overflow-hidden rounded-2xl border border-[rgba(42,98,87,0.16)] bg-[#f1f7f3]">
    <button id={buttonId} type="button" aria-controls={panelId} aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--primary)]">
      <IconShieldCheck aria-hidden="true" size={24} className="shrink-0" />
      <span className="min-w-0 flex-1 text-base font-semibold leading-6">{italian ? "Visualizza la politica di rimborso entro 14 giorni" : "View 14-day refund policy"}</span>
      <IconChevronDown aria-hidden="true" size={22} className={`shrink-0 transition-transform duration-300 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
    </button>
    <div id={panelId} role="region" aria-labelledby={buttonId} aria-hidden={!expanded} inert={!expanded}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
      <div className="min-h-0 overflow-hidden">
        <div className="border-t border-[rgba(42,98,87,0.12)] px-4 pb-5 pt-4">
          <h2 className="text-lg font-bold leading-6 text-[var(--foreground)]">{italian ? "Politica di rimborso entro 14 giorni" : "14-day refund policy"}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)] sm:text-base sm:leading-7">{italian
            ? "Vogliamo che tu possa acquistare il tuo abbonamento in tutta tranquillità. Ecco come funziona la nostra politica di rimborso:"
            : "We want you to feel confident about your membership. Here's how our refund policy works:"}</p>
          <ol className="mt-4 list-none space-y-4 text-sm leading-6 text-[var(--muted-strong)] sm:text-base sm:leading-7">
            <li>
              <strong className="block text-[var(--foreground)]">{italian ? "1. Richiedi un rimborso completo entro 14 giorni" : "1. Request a full refund within 14 days"}</strong>
              <p className="mt-1">{italian
                ? `Puoi richiedere il rimborso completo dei ${paymentAmount} del tuo primo abbonamento entro 14 giorni dalla data del pagamento.`
                : `You can request a full refund of your initial ${paymentAmount} membership payment within 14 days of payment.`}</p>
            </li>
            <li>
              <strong className="block text-[var(--foreground)]">{italian ? "2. Come richiedere un rimborso" : "2. How to request a refund"}</strong>
              <p className="mt-1">{italian
                ? "Ti basta accedere al tuo account e inviare una richiesta di rimborso. Se hai pagato tramite bonifico bancario, potrebbe essere necessaria l'assistenza del nostro team di supporto."
                : "Simply log into your account and submit a refund request. If you paid by bank transfer, our support team may need to assist you."}</p>
            </li>
            <li>
              <strong className="block text-[var(--foreground)]">{italian ? "3. Cosa succede dopo il rimborso?" : "3. What happens after a refund?"}</strong>
              <p className="mt-1">{italian
                ? "Una volta confermato il rimborso completo, la tua attività non sarà più visibile sul sito. Tutte le informazioni della tua attività rimarranno salvate."
                : "Once your full refund is confirmed, your business listing will no longer be publicly visible. Your business information will remain saved."}</p>
            </li>
          </ol>
          <a href="/terms#refunds" className="mt-3 inline-flex items-center gap-1 font-semibold underline underline-offset-2" style={{ color: "var(--primary)" }}>
            {italian ? "Consulta la politica di rimborso completa" : "View full refund policy"} <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </div>
  </section>;
}
