"use client";

import { useId, useState } from "react";
import { IconChevronDown, IconShieldCheck } from "@tabler/icons-react";

export function InitialPaymentRefundPolicy({ amount, locale }: { amount: string; locale: "en" | "it" }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const buttonId = `${panelId}-button`;
  const italian = locale === "it";

  return <section className="mt-4 overflow-hidden rounded-2xl border border-[rgba(42,98,87,0.16)] bg-[#f1f7f3]">
    <button id={buttonId} type="button" aria-controls={panelId} aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--primary)]">
      <IconShieldCheck aria-hidden="true" size={24} className="shrink-0" />
      <span className="min-w-0 flex-1 text-base font-semibold leading-6">{italian ? "Visualizza la politica di rimborso di 14 giorni" : "View 14-day refund policy"}</span>
      <IconChevronDown aria-hidden="true" size={22} className={`shrink-0 transition-transform duration-300 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
    </button>
    <div id={panelId} role="region" aria-labelledby={buttonId} aria-hidden={!expanded} inert={!expanded}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
      <div className="min-h-0 overflow-hidden">
        <div className="border-t border-[rgba(42,98,87,0.12)] px-4 pb-5 pt-4">
          <h2 className="text-lg font-bold leading-6 text-[var(--foreground)]">{italian ? "Rimborso entro 14 giorni" : "14-day refund policy"}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)] sm:text-base sm:leading-7">{italian
            ? `Il titolare idoneo può richiedere dal proprio account il rimborso completo del pagamento iniziale di ${amount} prima dell'istante esatto che cade 14 giorni dopo il pagamento riuscito. I rimborsi con carta vengono elaborati tramite l'account. Le richieste per bonifici si inviano dall'account entro 14 giorni e possono richiedere l'assistenza Salento Local; la data della richiesta preserva l'idoneità. Solo il rimborso completo confermato disattiva la scheda; le informazioni dell'attività e l'accesso all'account restano salvati.`
            : `An eligible owner may request a full refund of the initial ${amount} membership payment from their account before the exact instant 14 days after successful payment. Card refunds are processed through the account. Bank-transfer requests are submitted there within 14 days and may need Salento Local support; the request date preserves eligibility. Only a confirmed full refund deactivates the listing; business information and account access stay saved.`}</p>
          <a href="/terms#refunds" className="mt-3 inline-flex items-center gap-1 font-semibold underline underline-offset-2" style={{ color: "var(--primary)" }}>
            {italian ? "Leggi tutti i termini di rimborso" : "View full refund terms"} <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </div>
  </section>;
}
