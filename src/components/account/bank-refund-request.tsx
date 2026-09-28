import { HardNavigationLink } from "@/components/hard-navigation-link";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { InitialRefundState } from "@/lib/self-service-refunds";
import { confirmInitialRefundAction, checkInitialRefundStatusAction } from "@/app/(account)/dashboard/refund/[businessId]/actions";

export function BankRefundRequest({ businessId, businessName, paymentId, amount, requestedAt, state, locale, ownerEmail, error }: {
  businessId: string; businessName: string; paymentId: string; amount: string; requestedAt: Date | null; state: InitialRefundState;
  locale: "en" | "it"; ownerEmail: string | null; error?: string;
}) {
  const it = locale === "it";
  const complete = state === "REFUNDED";
  const closed = state === "SUPPORT_CLOSED";
  const available = state === "AVAILABLE";
  const requested = Boolean(requestedAt);
  const date = requestedAt ? new Intl.DateTimeFormat(it ? "it-IT" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(requestedAt) : null;
  const title = complete ? it ? "Rimborso elaborato" : "Refund processed" : closed ? it ? "Richiesta chiusa" : "Request closed" : requested ? it ? "Richiesta di rimborso ricevuta" : "Refund request received" : it ? "Richiedi il rimborso completo" : "Request full refund";
  return <main className="shell px-4 py-10 sm:px-6"><section className="mx-auto max-w-xl rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm sm:p-8">
    <p className="section-kicker">{it ? "MEMBERSHIP · BONIFICO" : "MEMBERSHIP · BANK TRANSFER"}</p>
    <h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">{title}</h1>
    <p className="mt-3 text-lg font-semibold text-[var(--foreground)]">{businessName}</p>
    <p className="mt-4 font-semibold">{it ? "Rimborso completo" : "Full refund"}: {amount}</p>
    {complete ? <p className="mt-5 leading-7 text-[var(--muted-strong)]">{it ? "Il rimborso è stato confermato dal fornitore. La scheda è inattiva; le informazioni dell'attività e l'accesso restano salvati. I tempi di accredito dipendono dalla banca." : "The refund has been confirmed by the provider. Your listing is inactive; your business information and access remain saved. Bank processing times can vary."}</p> : closed ? <p className="mt-5 leading-7 text-[var(--muted-strong)]">{it ? "L'assistenza ha chiuso la richiesta senza un rimborso completato. Il pagamento e la membership restano validi. Contattaci per chiarimenti sulla richiesta originale." : "Support closed this request without a completed refund. Your payment and membership remain valid. Contact us for help with your original request."}</p> : requested ? <>
      <div className="mt-5 rounded-xl border border-[var(--border)] bg-white/70 p-4 text-sm leading-6"><p className="font-semibold">{it ? "In attesa dell'assistenza" : "Pending support"}</p><p>{it ? "Ricevuta il" : "Received on"} {date} · Europe/Rome</p><p className="mt-1 break-all">{it ? "Riferimento" : "Reference"}: bank-refund:{paymentId}</p></div>
      <p className="mt-4 leading-7 text-[var(--muted-strong)]">{it ? "La richiesta è stata registrata entro il periodo di 14 giorni. L'idoneità al rimborso è preservata dalla data della richiesta, anche se l'assistenza completa la restituzione più tardi. La scheda resta attiva fino al completamento del rimborso." : "Your request was recorded within the 14-day period. Your refund eligibility is preserved by the request date, even if support completes the return later. Your listing remains active until the refund is completed."}</p>
      {state === "FAILED" ? <p className="mt-3 text-sm leading-6">{it ? "Il tentativo di restituzione non è riuscito. La richiesta resta aperta e richiede una verifica dell'assistenza; non inviare un'altra richiesta." : "The return attempt failed. Your request remains open for support review; please do not submit another request."}</p> : null}
      <p className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">{it ? "Ti contatteremo se servono ulteriori informazioni. Il rimborso non è ancora completato." : "We'll contact you if more information is needed. Your refund has not been completed yet."}</p>
    </> : available ? <>
      <p className="mt-5 leading-7 text-[var(--muted-strong)]">{it ? "Poiché hai pagato con bonifico, Salento Local ti aiuterà a completare la restituzione. Inviando ora, la richiesta verrà registrata entro il periodo di rimborso di 14 giorni." : "Because you paid by bank transfer, Salento Local support will help complete the return. Submit now to record your request within the 14-day refund period."}</p>
      <p className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">{it ? "La scheda resterà attiva fino al completamento del rimborso. Le informazioni dell'attività e l'accesso resteranno salvati." : "Your listing will remain active until the refund is completed. Your business information and access will remain saved."}</p>
      <form action={confirmInitialRefundAction} className="mt-6"><input type="hidden" name="businessId" value={businessId} />
        {!ownerEmail ? <label className="mb-4 block text-sm">{it ? "Email per la richiesta" : "Contact email"}<input className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white p-3" type="email" name="instructionsEmail" required autoComplete="email" /><span className="mt-2 block text-xs leading-5">{it ? "Usiamo questo indirizzo per confermare la richiesta e contattarti. Non inserire dati bancari qui." : "We'll use this address to confirm your request and contact you. Please do not enter bank details here."}</span></label> : null}
        {error === "email_required" ? <p role="alert" className="mb-4 text-sm">{it ? "Inserisci un indirizzo email valido." : "Enter a valid contact email."}</p> : error === "check" ? <p role="alert" className="mb-4 text-sm">{it ? "La richiesta non è stata registrata. Riprova o contatta l'assistenza prima della scadenza." : "Your request was not recorded. Try again or contact support before the deadline."}</p> : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row"><HardNavigationLink className="btn-secondary min-h-12 justify-center px-4" href="/dashboard">{it ? "Mantieni la membership" : "Keep membership"}</HardNavigationLink><FormSubmitButton className="btn-primary min-h-12 justify-center px-4" pendingLabel={it ? "Invio…" : "Submitting…"}>{it ? "Invia richiesta di rimborso" : "Submit refund request"}</FormSubmitButton></div>
      </form>
    </> : <p className="mt-5 leading-7">{it ? "Il periodo per una nuova richiesta di rimborso è terminato. Contatta l'assistenza per domande su una richiesta già inviata." : "The window for a new refund request has ended. Contact support about an existing request."}</p>}
    <div className="mt-7 flex flex-wrap gap-3">{!available ? <HardNavigationLink className="btn-secondary min-h-12 justify-center px-4" href="/dashboard">{it ? "Dashboard" : "Dashboard"}</HardNavigationLink> : null}<HardNavigationLink className="btn-secondary min-h-12 justify-center px-4" href="/dashboard/support">{it ? "Contatta l'assistenza" : "Contact support"}</HardNavigationLink>{requested && !complete && !closed ? <form action={checkInitialRefundStatusAction}><input type="hidden" name="businessId" value={businessId} /><FormSubmitButton className="btn-secondary min-h-12 justify-center px-4" pendingLabel={it ? "Verifica…" : "Checking…"}>{it ? "Aggiorna stato" : "Refresh status"}</FormSubmitButton></form> : null}</div>
  </section></main>;
}
