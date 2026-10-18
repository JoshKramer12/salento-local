"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconArrowRight, IconBuildingStore, IconCheck, IconCreditCard, IconMail } from "@tabler/icons-react";
import QRCode from "qrcode";
import { PaymentMethodStep, RenewalSelectionStep } from "@/components/account/pay-later-payment-steps";
import styles from "./pay-later-payment-steps.module.css";
import { OwnerAgreementStep } from "@/components/account/owner-agreement-step";
import { SignaturePad } from "@/components/account/signature-pad";
import { getAudienceTermsLink, getLegalLinks } from "@/lib/legal";
import type { Locale } from "@/lib/i18n";

export type PayLaterOwnerSubmission = {
  businessName: string; address: string; town: string; category: string; description: string;
  openingHours: string; phone: string; email: string; photos: string[]; ownerName: string;
  ownerSubmitted?: boolean;
  signedEarlier: boolean; paymentMethod: "ONLINE" | "BANK_TRANSFER" | null;
};
type Destination = { status: "paid" } | { status: "paused" } | { status: "online"; href: string } | {
  status: "bank"; instructions: { accountHolderName: string; amountRemainingCents: number;
    bic: string; hostedInstructionsUrl: string; iban: string; reference: string };
};

export function PayLaterOwnerClient({ token, locale, verified, emailHint, paymentPaused, paymentTestMode, submission }: {
  token: string; locale: Locale; verified: boolean; emailHint: string; paymentPaused: boolean; paymentTestMode: boolean; submission: PayLaterOwnerSubmission | null;
}) {
  const it = locale === "it";
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyMethod, setBusyMethod] = useState<"ONLINE" | "BANK_TRANSFER" | null>(null);
  const [stage, setStage] = useState<"review" | "agreement" | "signature" | "payment" | "complete">(submission?.paymentMethod ? "payment" : "review");
  const [confirmed, setConfirmed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState("OWNER");
  const [signerRoleOther, setSignerRoleOther] = useState("");
  const [signature, setSignature] = useState("");
  const [renewal, setRenewal] = useState<"AUTO" | "MANUAL">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.hash.replace(/^#/, "")).get("renewal") === "MANUAL" ? "MANUAL" : "AUTO");
  const [renewalChosen, setRenewalChosen] = useState(() => typeof window !== "undefined" &&
    ["AUTO", "MANUAL"].includes(new URLSearchParams(window.location.hash.replace(/^#/, "")).get("renewal") ?? ""));
  const [paymentSubstep, setPaymentSubstep] = useState<"renewal" | "methods">(() => {
    if (typeof window === "undefined") return "renewal";
    const value = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("step");
    return value === "methods" ? "methods" : "renewal";
  });
  const [destination, setDestination] = useState<Destination | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [stopped, setStopped] = useState(false);
  const approvalReady = confirmed && accepted && Boolean(signerName.trim()) && Boolean(signature) &&
    (signerRole !== "OTHER_AUTHORIZED_REPRESENTATIVE" || Boolean(signerRoleOther.trim()));
  const started = useRef(false);
  const endpoint = "/api/pay-later";

  function navigatePayment(next: "renewal" | "methods") {
    setPaymentSubstep(next);
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    hash.set("step", next);
    url.hash = hash.toString();
    window.history.pushState({ paymentStep: next }, "", url);
  }

  function returnToSignature() {
    setStage("signature");
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    hash.delete("step");
    url.hash = hash.toString();
    window.history.replaceState(window.history.state, "", url);
  }

  function selectRenewal(next: "AUTO" | "MANUAL") {
    setRenewal(next); setRenewalChosen(true);
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    hash.set("renewal", next);
    url.hash = hash.toString();
    window.history.replaceState(window.history.state, "", url);
  }

  useEffect(() => {
    const restorePaymentNavigation = () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const step = hash.get("step");
      setPaymentSubstep(step === "methods" ? "methods" : "renewal");
      if (submission?.paymentMethod || ((step === "renewal" || step === "methods" || step === "decision") && approvalReady))
        setStage((current) => current === "complete" ? current : "payment");
      else setStage((current) => current === "payment" ? "signature" : current);
      const preference = hash.get("renewal");
      setRenewalChosen(preference === "AUTO" || preference === "MANUAL");
      if (preference === "AUTO" || preference === "MANUAL") setRenewal(preference);
    };
    window.addEventListener("popstate", restorePaymentNavigation);
    return () => window.removeEventListener("popstate", restorePaymentNavigation);
  }, [approvalReady, submission?.paymentMethod]);

  useEffect(() => {
    const href = destination?.status === "online" ? destination.href
      : destination?.status === "bank" ? destination.instructions.hostedInstructionsUrl : null;
    if (!href) return;
    let active = true;
    const absolute = new URL(href, window.location.origin);
    QRCode.toDataURL(absolute.href, { margin: 1, width: 240 }).then((image) => {
      if (active) setQrImage(image);
    }).catch(() => { if (active) setQrImage(""); });
    return () => { active = false; };
  }, [destination]);

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
    if (!renewalChosen || (method === "BANK_TRANSFER" && renewal === "AUTO")) return;
    setBusyMethod(method);
    setBusy(true); setError("");
    try {
      const result = await request({ action: "choose-payment", choice: {
        method, renewal: method === "BANK_TRANSFER" ? "MANUAL" : renewal,
        ownerConfirmed: confirmed, termsAccepted: accepted, signerFullName: signerName,
        signerRole, signerRoleOther, signature,
      } }) as Destination;
      setDestination(result);
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "pay_later_payment_locked"
        ? it ? "Il metodo di pagamento è già stato scelto. Ricarica la pagina per continuare." : "A payment method is already selected. Reload to continue."
        : it ? "Non siamo riusciti ad aprire il pagamento. Riprova o contatta l’assistenza." : "We couldn't open payment. Try again or contact support.");
    } finally { setBusy(false); setBusyMethod(null); }
  }
  async function continueExistingPayment() {
    setBusy(true); setError("");
    try {
      const result = await request({ action: "get-payment" }) as Destination;
      setDestination(result);
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
    <nav aria-label={it ? "Avanzamento della procedura" : "Submission progress"} className={styles.progress}><ol>{["review", "agreement", "signature", "payment"].map((name, index) => <li key={name} className={stage === name ? styles.progressCurrent : ["review", "agreement", "signature", "payment", "complete"].indexOf(stage) > index ? styles.progressDone : ""}><span className={styles.progressIcon}>{index === 3 ? <IconCreditCard size={21} aria-hidden="true" /> : ["review", "agreement", "signature", "payment", "complete"].indexOf(stage) > index ? <IconCheck size={20} aria-hidden="true" /> : index + 1}</span><span>{it ? ["Conferma", "Accetta", "Firma", "Pagamento"][index] : ["Confirm", "Accept", "Sign", "Payment"][index]}</span></li>)}</ol></nav>
    {stage !== "payment" ? <header className="mt-7"><p className="section-kicker">Salento Local · {submission.ownerSubmitted ? (it ? "Il tuo invito" : "Your invitation") : (it ? "Invito del Local Partner" : "Local Partner invitation")}</p>
      <h1 className="mt-3 font-serif text-4xl">{title}</h1>
      <p className="mt-3 text-[var(--muted)]">{it ? "La tua scheda resta salvata e sarà pubblicata solo dopo la conferma del pagamento." : "Your listing is saved and will be published only after payment is confirmed."}</p></header> : null}
    {stage === "review" ? <section className={`${card} mt-7`}>
      <div className="flex items-center gap-3"><IconBuildingStore className="text-[var(--primary)]" size={30} /><div><h2 className="font-serif text-3xl">{submission.businessName}</h2><p className="text-sm text-[var(--muted)]">{submission.category} · {submission.town}</p></div></div>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="font-semibold">{it ? "Indirizzo" : "Address"}</dt><dd>{submission.address}</dd></div><div><dt className="font-semibold">{it ? "Contatti" : "Contact"}</dt><dd>{submission.phone}<br />{submission.email || "—"}</dd></div></dl>
      <div className="mt-6"><h3 className="font-semibold">{it ? "Descrizione" : "Description"}</h3><p className="mt-2 whitespace-pre-line text-sm leading-6">{submission.description}</p></div>
      <div className="mt-6"><h3 className="font-semibold">{it ? "Orari" : "Hours"}</h3><p className="mt-2 break-words text-sm text-[var(--muted)]">{formatHours(submission.openingHours, locale)}</p></div>
      {photos.length ? <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${submission.businessName} · ${index + 1}`} className="aspect-[4/3] w-full rounded-xl object-cover" />)}</div> : null}
      <label className="mt-7 flex items-start gap-3"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-5 w-5 accent-[var(--primary)]" /><span>{it ? "Confermo che le informazioni della mia attività sono corrette." : "I confirm that my business details are correct."}</span></label>
      <button type="button" disabled={!confirmed} onClick={() => setStage("agreement")} className="btn-primary mt-6 w-full disabled:opacity-50">{it ? "Continua" : "Continue"}<IconArrowRight size={18} /></button>
      <p className="mt-4 text-sm text-[var(--muted)]">{submission.ownerSubmitted
        ? (it ? "Qualcosa non va? Contatta l'assistenza prima di firmare." : "Something wrong? Contact support before signing.")
        : (it ? "Qualcosa non va? Chiedi al Local Partner di correggere la scheda prima di firmare." : "Something wrong? Ask the Local Partner to correct the listing before signing.")}</p>
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
      <button type="button" disabled={!approvalReady} onClick={() => { setStage("payment"); navigatePayment("renewal"); }} className="btn-primary mt-6 w-full disabled:opacity-50">{it ? "Continua al pagamento" : "Continue to payment"}<IconArrowRight size={18} /></button>
    </section> : null}
    {stage === "payment" ? <section className="mt-7">
      {paymentTestMode && !paymentPaused ? <p className="mb-4 text-sm leading-6 text-[var(--muted)]">{it ? "Durante questa anteprima i pagamenti sono simulati: non inviare denaro reale e usa una carta di prova." : "During this preview, payments are simulated: do not send real money and use a test card."}</p> : null}
      {destination?.status === "paused" ? <div role="status" className={card}><IconCheck className="text-[var(--primary)]" size={36} /><h2 className="mt-3 font-serif text-3xl">{it ? "Scelta salvata" : "Choice saved"}</h2><p className="mt-3 text-[var(--muted)]">{it ? "La tua conferma, firma e preferenza di rinnovo sono salvate. I pagamenti sono sospesi durante i test; non è stato addebitato nulla e la scheda non è ancora pubblicata." : "Your confirmation, signature and renewal choice are saved. Payments are paused during testing; nothing was charged and the listing is not yet published."}</p></div>
        : destination?.status === "paid" ? <div className={card}><IconCheck className="text-[var(--primary)]" size={36} /><h2 className="mt-3 font-serif text-3xl">{it ? "Pagamento ricevuto" : "Payment received"}</h2>{paymentTestMode ? <p className="mt-3 text-sm text-[var(--muted)]">{it ? "Pagamento simulato: nessun addebito reale." : "Simulated payment: no real charge."}</p> : null}</div>
        : destination?.status === "online" || destination?.status === "bank" ? <div className={`${card} ${styles.handoffResult}`}>
          <span className={styles.kicker}>{it ? "Pagamento" : "Payment"}</span>
          <h2 className="mt-5 font-serif text-3xl">{destination.status === "online" ? (it ? "Completa il pagamento" : "Complete payment") : (it ? "Istruzioni per il bonifico" : "Bank transfer instructions")}</h2>
          <p className="mt-3 text-[var(--muted)]">{destination.status === "online" ? (it ? "Scansiona il QR con il tuo telefono o continua su questo dispositivo." : "Scan the QR with your phone or continue on this device.") : (it ? "Usa i dettagli qui sotto. La scheda resterà in attesa finché Stripe non confermerà il bonifico." : "Use the details below. The listing remains pending until Stripe confirms the transfer.")}</p>
          {qrImage ? <img src={qrImage} alt={it ? "QR delle istruzioni di pagamento" : "Payment instructions QR"} className={styles.qrImage} /> : null}
          {destination.status === "online" ? <a href={destination.href} className={styles.primaryAction}>{it ? "Paga su questo dispositivo" : "Pay on this device"}<IconArrowRight size={20} /></a>
            : <><dl className="mt-5 grid gap-3 break-all text-sm"><div><dt className="font-semibold">{it ? "Importo" : "Amount"}</dt><dd>{new Intl.NumberFormat(it ? "it-IT" : "en-IE", { style: "currency", currency: "EUR" }).format(destination.instructions.amountRemainingCents / 100)}</dd></div><div><dt className="font-semibold">{it ? "Beneficiario" : "Beneficiary"}</dt><dd>{destination.instructions.accountHolderName}</dd></div><div><dt className="font-semibold">IBAN</dt><dd>{destination.instructions.iban}</dd></div><div><dt className="font-semibold">BIC</dt><dd>{destination.instructions.bic}</dd></div><div><dt className="font-semibold">{it ? "Riferimento" : "Reference"}</dt><dd>{destination.instructions.reference}</dd></div></dl><p className="mt-4 text-sm text-[var(--muted)]">{it ? "Puoi tornare a questo invito per rivedere le istruzioni." : "You can return to this invitation to view the instructions again."}</p><a href={destination.instructions.hostedInstructionsUrl} className={styles.primaryAction} target="_blank" rel="noopener noreferrer">{it ? "Apri istruzioni Stripe" : "Open Stripe instructions"}</a></>}
          <Link href="/" className="mt-5 inline-block text-sm font-semibold text-[var(--primary)] underline">{it ? "Salva ed esci" : "Save & exit"}</Link>
        </div> : submission.paymentMethod ? <div className={card}><p>{it ? "Hai già scelto un metodo di pagamento per questa adesione." : "A payment method has already been selected for this membership."}</p><button type="button" disabled={busy} onClick={continueExistingPayment} className="btn-primary mt-5 w-full">{it ? "Continua il pagamento" : "Continue payment"}</button></div>
        : paymentSubstep === "renewal" || !renewalChosen ? <RenewalSelectionStep locale={locale} value={renewalChosen ? renewal : null} onChange={selectRenewal} onContinue={() => navigatePayment("methods")} onBack={returnToSignature} />
        : <>{paymentPaused ? <p role="status" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">{it ? "I pagamenti sono temporaneamente sospesi. Puoi salvare la tua conferma, firma e scelta di rinnovo; non verrà creato alcun pagamento." : "Payments are temporarily paused. You can save your confirmation, signature and renewal choice; no payment will be created."}</p> : null}<PaymentMethodStep locale={locale} renewal={renewal} paymentPaused={paymentPaused} busyMethod={busyMethod} error={error} onOnline={() => choosePayment("ONLINE")} onBank={() => choosePayment("BANK_TRANSFER")} onBack={() => navigatePayment("renewal")} /></>}
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
