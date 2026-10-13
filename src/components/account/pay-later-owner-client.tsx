"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowRight, IconBuildingStore, IconCheck, IconCreditCard, IconMail, IconBuildingBank } from "@tabler/icons-react";
import { OwnerAgreementStep } from "@/components/account/owner-agreement-step";
import { SignaturePad } from "@/components/account/signature-pad";
import { getAudienceTermsLink, getLegalLinks } from "@/lib/legal";
import type { Locale } from "@/lib/i18n";

export type PayLaterOwnerSubmission = {
  businessName: string; address: string; town: string; category: string; description: string;
  openingHours: string; phone: string; email: string; photos: string[]; ownerName: string;
  signedEarlier: boolean; paymentMethod: "ONLINE" | "BANK_TRANSFER" | null;
};
type Destination = { status: "paid" } | { status: "online"; href: string } | {
  status: "bank"; instructions: { accountHolderName: string; amountRemainingCents: number;
    bic: string; hostedInstructionsUrl: string; iban: string; reference: string };
};

export function PayLaterOwnerClient({ token, locale, verified, emailHint, submission }: {
  token: string; locale: Locale; verified: boolean; emailHint: string; submission: PayLaterOwnerSubmission | null;
}) {
  const it = locale === "it";
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"review" | "agreement" | "signature" | "payment" | "complete">(submission?.paymentMethod ? "payment" : "review");
  const [confirmed, setConfirmed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState("OWNER");
  const [signerRoleOther, setSignerRoleOther] = useState("");
  const [signature, setSignature] = useState("");
  const [renewal, setRenewal] = useState<"AUTO" | "MANUAL">("AUTO");
  const [destination, setDestination] = useState<Destination | null>(null);
  const [stopped, setStopped] = useState(false);
  const started = useRef(false);
  const endpoint = "/api/pay-later";

  async function request(body: Record<string, unknown>) {
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, token }), cache: "no-store" });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : typeof result.status === "string" ? result.status : "unavailable");
    return result;
  }
  useEffect(() => {
    if (verified || started.current) return;
    started.current = true;
    request({ action: "start-otp" }).then(() => setOtpSent(true)).catch((reason) => {
      if (reason instanceof Error && reason.message === "cooldown") setOtpSent(true);
      else setError(it ? "Non siamo riusciti a inviare il codice. Riprova tra poco." : "We couldn't send the code. Please try again shortly.");
    });
  // The token and locale are fixed for this page's lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified]);

  async function verify() {
    setBusy(true); setError("");
    try {
      await request({ action: "verify-otp", code: code.trim() });
      window.location.reload();
    } catch { setError(it ? "Codice non valido o scaduto. Controlla e riprova." : "Invalid or expired code. Check it and try again."); }
    finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true); setError("");
    try { await request({ action: "start-otp" }); setOtpSent(true); }
    catch { setError(it ? "Attendi prima di richiedere un altro codice." : "Please wait before requesting another code."); }
    finally { setBusy(false); }
  }
  async function choosePayment(method: "ONLINE" | "BANK_TRANSFER") {
    setBusy(true); setError("");
    try {
      const result = await request({ action: "choose-payment", choice: {
        method, renewal: method === "BANK_TRANSFER" ? "MANUAL" : renewal,
        ownerConfirmed: confirmed, termsAccepted: accepted, signerFullName: signerName,
        signerRole, signerRoleOther, signature,
      } }) as Destination;
      setDestination(result);
      if (result.status === "online") window.location.assign(result.href);
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "pay_later_payment_locked"
        ? it ? "Il metodo di pagamento è già stato scelto. Ricarica la pagina per continuare." : "A payment method is already selected. Reload to continue."
        : it ? "Non siamo riusciti ad aprire il pagamento. Riprova o contatta l’assistenza." : "We couldn't open payment. Try again or contact support.");
    } finally { setBusy(false); }
  }
  async function continueExistingPayment() {
    setBusy(true); setError("");
    try {
      const result = await request({ action: "get-payment" }) as Destination;
      setDestination(result);
      if (result.status === "online") window.location.assign(result.href);
    } catch (reason) { setError(reason instanceof Error && reason.message === "pay_later_setup_in_progress"
      ? it ? "Stiamo preparando il pagamento. Riprova tra due minuti." : "We're preparing payment. Try again in two minutes."
      : it ? "Pagamento temporaneamente non disponibile. Riprova o contatta l’assistenza." : "Payment is temporarily unavailable. Try again or contact support."); }
    finally { setBusy(false); }
  }
  async function close(action: "decline" | "stop-reminders") {
    setBusy(true); setError("");
    try { await request({ action }); setStopped(true); if (action === "decline") setStage("complete"); }
    catch { setError(it ? "Non siamo riusciti a salvare la scelta." : "We couldn't save your choice."); }
    finally { setBusy(false); }
  }
  const card = "card rounded-[1.6rem] border border-[var(--border)] bg-white p-5 sm:p-7";
  const title = it ? "Completa la tua adesione" : "Complete your membership";
  if (!verified || !submission) return <main className="shell px-4 py-10 sm:py-16"><section className={`${card} mx-auto max-w-xl`}>
    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(42,98,87,0.1)] text-[var(--primary)]"><IconMail size={28} /></div>
    <p className="section-kicker">Salento Local</p><h1 className="mt-2 font-serif text-3xl">{it ? "Verifica la tua email" : "Verify your email"}</h1>
    <p className="mt-4 text-[var(--muted)]">{otpSent
      ? it ? `Abbiamo inviato un codice a ${emailHint}. Inseriscilo per vedere la scheda.` : `We sent a code to ${emailHint}. Enter it to view the listing.`
      : it ? `Ti invieremo un codice a ${emailHint} per vedere la scheda.` : `We'll send a code to ${emailHint} to view the listing.`}</p>
    <label className="field-label mt-6 block"><span>{it ? "Codice a sei cifre" : "Six-digit code"}</span><input autoFocus className="input-field mt-2 w-full text-center text-2xl tracking-[0.35em]" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} aria-label={it ? "Codice di verifica" : "Verification code"} /></label>
    {error ? <p role="alert" className="mt-3 text-sm text-[var(--accent)]">{error}</p> : null}
    <button type="button" disabled={busy || code.length !== 6} onClick={verify} className="btn-primary mt-5 w-full disabled:opacity-50">{busy ? (it ? "Verifica..." : "Verifying...") : (it ? "Verifica e continua" : "Verify and continue")}</button>
    <button type="button" disabled={busy} onClick={resend} className="mt-4 w-full text-sm font-semibold text-[var(--primary)]">{otpSent ? (it ? "Invia un nuovo codice" : "Send a new code") : (it ? "Invia il codice" : "Send the code")}</button>
  </section></main>;

  const photos = submission.photos.slice(0, 6);
  const termsLink = getAudienceTermsLink(locale, "business");
  const privacyLink = getLegalLinks(locale).privacy;
  return <main className="shell px-4 py-9 sm:px-6 sm:py-14"><div className="mx-auto max-w-3xl">
    <p className="section-kicker">Salento Local · {it ? "Invito del Local Partner" : "Local Partner invitation"}</p>
    <h1 className="mt-3 font-serif text-4xl">{title}</h1>
    <p className="mt-3 text-[var(--muted)]">{it ? "La tua scheda resta salvata e sarà pubblicata solo dopo la conferma del pagamento." : "Your listing is saved and will be published only after payment is confirmed."}</p>
    <div className="mt-7 grid grid-cols-4 gap-1 text-center text-[0.6rem] font-semibold uppercase text-[var(--primary)] sm:flex sm:flex-wrap sm:gap-2 sm:text-xs sm:tracking-wider">{["review", "agreement", "signature", "payment"].map((name, index) => <span key={name} className={`rounded-full px-1 py-2 sm:px-3 ${stage === name ? "bg-[var(--primary)] text-white" : "bg-[rgba(42,98,87,0.1)]"}`}>{index + 1}. {it ? ["Controlla", "Accetta", "Firma", "Paga"][index] : ["Review", "Accept", "Sign", "Pay"][index]}</span>)}</div>
    {stage === "review" ? <section className={`${card} mt-7`}>
      <div className="flex items-center gap-3"><IconBuildingStore className="text-[var(--primary)]" size={30} /><div><h2 className="font-serif text-3xl">{submission.businessName}</h2><p className="text-sm text-[var(--muted)]">{submission.category} · {submission.town}</p></div></div>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="font-semibold">{it ? "Indirizzo" : "Address"}</dt><dd>{submission.address}</dd></div><div><dt className="font-semibold">{it ? "Contatti" : "Contact"}</dt><dd>{submission.phone}<br />{submission.email || "—"}</dd></div></dl>
      <div className="mt-6"><h3 className="font-semibold">{it ? "Descrizione" : "Description"}</h3><p className="mt-2 whitespace-pre-line text-sm leading-6">{submission.description}</p></div>
      <div className="mt-6"><h3 className="font-semibold">{it ? "Orari" : "Hours"}</h3><p className="mt-2 break-words text-sm text-[var(--muted)]">{formatHours(submission.openingHours, locale)}</p></div>
      {photos.length ? <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${submission.businessName} · ${index + 1}`} className="aspect-[4/3] w-full rounded-xl object-cover" />)}</div> : null}
      <label className="mt-7 flex items-start gap-3"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-5 w-5 accent-[var(--primary)]" /><span>{it ? "Confermo che le informazioni della mia attività sono corrette." : "I confirm that my business details are correct."}</span></label>
      <button type="button" disabled={!confirmed} onClick={() => setStage("agreement")} className="btn-primary mt-6 w-full disabled:opacity-50">{it ? "Continua" : "Continue"}<IconArrowRight size={18} /></button>
      <p className="mt-4 text-sm text-[var(--muted)]">{it ? "Qualcosa non va? Chiedi al Local Partner di correggere la scheda prima di firmare." : "Something wrong? Ask the Local Partner to correct the listing before signing."}</p>
    </section> : null}
    {stage === "agreement" ? <section className={`${card} mt-7`}><OwnerAgreementStep accepted={accepted} businessName={submission.businessName}
      firstYearPriceLabel="€100" renewalPriceLabel="€100" keyTerms={[
        it ? "L’adesione dura 365 giorni dal pagamento." : "Membership lasts 365 days from payment.",
        it ? "La scheda sarà pubblicata dopo la conferma del pagamento." : "The listing is published after payment is confirmed.",
        it ? "Puoi chiedere il rimborso iniziale entro 14 giorni dal pagamento." : "You can request an initial refund within 14 days of payment.",
      ]} locale={locale} onAcceptedChange={setAccepted} photoUrl={photos[0]}
      privacyLink={privacyLink} termsLink={termsLink} townName={submission.town} />
      <button type="button" disabled={!accepted} onClick={() => setStage("signature")} className="btn-primary mt-6 w-full disabled:opacity-50">{it ? "Continua alla firma" : "Continue to signature"}</button>
    </section> : null}
    {stage === "signature" ? <section className={`${card} mt-7`}>
      <h2 className="font-serif text-3xl">{it ? "Firma per continuare" : "Sign to continue"}</h2>
      {submission.signedEarlier ? <p className="mt-3 text-sm text-[var(--muted)]">{it ? "La firma raccolta sul dispositivo del Partner resta conservata. Firma di nuovo dopo la verifica email per confermare personalmente." : "The signature collected on the Partner's device is retained. Sign again after email verification to confirm personally."}</p> : null}
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="field-label"><span>{it ? "Nome completo" : "Full name"}</span><input className="input-field mt-2" value={signerName} onChange={(event) => setSignerName(event.target.value)} autoComplete="name" /></label>
        <label className="field-label"><span>{it ? "Ruolo" : "Role"}</span><select className="input-field mt-2" value={signerRole} onChange={(event) => setSignerRole(event.target.value)}><option value="OWNER">{it ? "Titolare" : "Owner"}</option><option value="LEGAL_REPRESENTATIVE">{it ? "Rappresentante legale" : "Legal representative"}</option><option value="MANAGER_AUTHORIZED_BY_OWNER">{it ? "Responsabile autorizzato" : "Authorized manager"}</option><option value="OTHER_AUTHORIZED_REPRESENTATIVE">{it ? "Altro rappresentante autorizzato" : "Other authorized representative"}</option></select></label></div>
      {signerRole === "OTHER_AUTHORIZED_REPRESENTATIVE" ? <label className="field-label mt-4 block"><span>{it ? "Specifica il ruolo" : "Specify role"}</span><input className="input-field mt-2" value={signerRoleOther} onChange={(event) => setSignerRoleOther(event.target.value)} /></label> : null}
      <div className="mt-6"><SignaturePad clearLabel={it ? "Cancella firma" : "Clear signature"} drawHint={it ? "Firma nel riquadro" : "Sign in the box"} legacyValueNotice="" value={signature} onChange={setSignature} /></div>
      <button type="button" disabled={!signerName.trim() || !signature || (signerRole === "OTHER_AUTHORIZED_REPRESENTATIVE" && !signerRoleOther.trim())} onClick={() => setStage("payment")} className="btn-primary mt-6 w-full disabled:opacity-50">{it ? "Continua al pagamento" : "Continue to payment"}<IconArrowRight size={18} /></button>
    </section> : null}
    {stage === "payment" ? <section className="mt-7 grid gap-5">
      <div className={card}><h2 className="font-serif text-3xl">{it ? "Come preferisci pagare?" : "How would you like to pay?"}</h2><p className="mt-2 text-[var(--muted)]">{it ? "Adesione annuale: €100." : "Annual membership: €100."}</p></div>
      {submission.paymentMethod ? <div className={card}><p>{it ? "Hai già scelto un metodo di pagamento per questa adesione." : "A payment method has already been selected for this membership."}</p><button type="button" disabled={busy} onClick={continueExistingPayment} className="btn-primary mt-5 w-full">{it ? "Continua il pagamento" : "Continue payment"}</button></div> : <>
        <div className={card}><p className="font-semibold">{it ? "Rinnovo" : "Renewal"}</p><label className="mt-4 flex gap-3"><input type="radio" checked={renewal === "AUTO"} onChange={() => setRenewal("AUTO")} className="accent-[var(--primary)]" /><span>{it ? "Automatico — €100/anno. Puoi disattivarlo dal tuo account." : "Automatic — €100/year. You can turn it off from your account."}</span></label><label className="mt-3 flex gap-3"><input type="radio" checked={renewal === "MANUAL"} onChange={() => setRenewal("MANUAL")} className="accent-[var(--primary)]" /><span>{it ? "Manuale — ti ricorderemo di rinnovare." : "Manual — we'll remind you to renew."}</span></label></div>
        <div className={card}><div className="flex items-center gap-3"><IconCreditCard className="text-[var(--primary)]" /><h3 className="font-serif text-2xl">{it ? "Paga online" : "Pay online"}</h3></div><p className="mt-3 text-sm text-[var(--muted)]">{it ? "Carta, Apple Pay o Google Pay sul sistema sicuro di Salento Local." : "Card, Apple Pay or Google Pay through Salento Local's secure payment system."}</p><button type="button" disabled={busy} onClick={() => choosePayment("ONLINE")} className="btn-primary mt-5 w-full">{it ? "Vai al pagamento online" : "Continue to online payment"}</button></div>
        <div className={card}><div className="flex items-center gap-3"><IconBuildingBank className="text-[var(--primary)]" /><h3 className="font-serif text-2xl">{it ? "Paga con bonifico" : "Pay by bank transfer"}</h3></div><p className="mt-3 text-sm text-[var(--muted)]">{it ? "Ricevi i dettagli del bonifico Stripe. La scheda va online dopo la conferma." : "Get Stripe bank transfer instructions. The listing goes live after confirmation."}</p><button type="button" disabled={busy} onClick={() => choosePayment("BANK_TRANSFER")} className="btn-secondary mt-5 w-full">{it ? "Mostra istruzioni" : "Show instructions"}</button></div>
      </>}
      {destination?.status === "bank" ? <div className={card}><h3 className="font-serif text-2xl">{it ? "Istruzioni per il bonifico" : "Bank transfer instructions"}</h3><dl className="mt-4 grid gap-3 break-all text-sm"><div><dt className="font-semibold">IBAN</dt><dd>{destination.instructions.iban}</dd></div><div><dt className="font-semibold">BIC</dt><dd>{destination.instructions.bic}</dd></div><div><dt className="font-semibold">{it ? "Beneficiario" : "Beneficiary"}</dt><dd>{destination.instructions.accountHolderName}</dd></div><div><dt className="font-semibold">{it ? "Riferimento" : "Reference"}</dt><dd>{destination.instructions.reference}</dd></div></dl><a href={destination.instructions.hostedInstructionsUrl} className="btn-primary mt-6 w-full" target="_blank" rel="noopener noreferrer">{it ? "Apri istruzioni Stripe" : "Open Stripe instructions"}</a></div> : null}
      {destination?.status === "paid" ? <div className={card}><IconCheck className="text-[var(--primary)]" /><h3 className="font-serif text-2xl">{it ? "Pagamento ricevuto" : "Payment received"}</h3></div> : null}
    </section> : null}
    {stage === "complete" ? <section className={`${card} mt-7 text-center`}><IconCheck className="mx-auto text-[var(--primary)]" size={40} /><h2 className="mt-4 font-serif text-3xl">{stopped ? (it ? "Scelta salvata" : "Choice saved") : title}</h2></section> : null}
    {error && verified ? <p role="alert" className="mt-5 rounded-xl bg-[#fff3ec] p-4 text-sm text-[var(--accent)]">{error}</p> : null}
    {stage !== "complete" ? <div className="mt-9 flex flex-wrap gap-5 text-sm">{stopped ? <span className="text-[var(--primary)]">{it ? "Promemoria interrotti" : "Reminders stopped"}</span> : <button type="button" disabled={busy} onClick={() => close("stop-reminders")} className="text-[var(--primary)] underline">{it ? "Interrompi i promemoria" : "Stop reminders"}</button>}<button type="button" disabled={busy} onClick={() => close("decline")} className="text-[var(--muted)] underline">{it ? "Rifiuta l'invito" : "Decline invitation"}</button></div> : null}
  </div></main>;
}

function formatHours(value: string, locale: Locale) {
  try {
    const parsed = JSON.parse(value) as Array<{ day?: string; closed?: boolean; open1?: string; close1?: string; open2?: string; close2?: string }>;
    if (!Array.isArray(parsed)) return value;
    const labels = locale === "it"
      ? { monday: "Lunedì", tuesday: "Martedì", wednesday: "Mercoledì", thursday: "Giovedì", friday: "Venerdì", saturday: "Sabato", sunday: "Domenica" }
      : { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
    return parsed.map((day) => `${labels[day.day as keyof typeof labels] ?? day.day ?? ""}: ${day.closed ? locale === "it" ? "chiuso" : "closed" : [day.open1 && day.close1 ? `${day.open1}–${day.close1}` : "", day.open2 && day.close2 ? `${day.open2}–${day.close2}` : ""].filter(Boolean).join(", ")}`).join(" · ");
  } catch { return value; }
}
