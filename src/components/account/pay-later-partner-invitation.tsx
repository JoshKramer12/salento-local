"use client";

import { IconArrowLeft, IconArrowRight, IconBrandWhatsapp, IconCheck, IconInfoCircle, IconMail } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import styles from "./pay-later-payment-steps.module.css";

type Props = {
  submissionId: string; businessName: string; ownerEmail: string; ownerPhone: string; locale: Locale;
  financialPaymentPaused?: boolean;
  onBack: () => void; onCorrectEmail: (nextEmail?: string) => void;
  onFixField: (field: string) => void;
};

const fieldLabels: Record<string, { en: string; it: string }> = {
  businessName: { en: "Business name", it: "Nome attività" },
  categoryId: { en: "Category", it: "Categoria" },
  townId: { en: "Town", it: "Comune" },
  address: { en: "Verified address", it: "Indirizzo verificato" },
  phone: { en: "Business phone", it: "Telefono attività" },
  ownerName: { en: "Owner name", it: "Nome titolare" },
  ownerPhone: { en: "Owner phone", it: "Telefono titolare" },
  ownerEmail: { en: "Owner email", it: "Email titolare" },
  longDescription: { en: "Business description", it: "Descrizione attività" },
  openingHours: { en: "Opening hours", it: "Orari di apertura" },
  photoUrls: { en: "Exterior and interior photos", it: "Foto esterna e interna" },
};

export function PayLaterPartnerInvitation({ submissionId, businessName, ownerEmail, ownerPhone, locale, financialPaymentPaused = false, onBack, onCorrectEmail, onFixField }: Props) {
  const it = locale === "it";
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const statusVersion = useRef(0);
  const [emailState, setEmailState] = useState<"idle" | "accepted" | "pending">("idle");
  const [statusLoading, setStatusLoading] = useState(Boolean(submissionId));
  const [emailInput, setEmailInput] = useState("");
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [whatsappAvailable, setWhatsappAvailable] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [sendError, setSendError] = useState("");
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(0);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim());
  const validPhone = /^\+[1-9]\d{7,14}$/.test(ownerPhone.trim());
  const enteredEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim());
  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    if (!cooldownUntil || cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  async function refreshStatus() {
    if (!submissionId) return;
    const version = ++statusVersion.current;
    setStatusError("");
    setStatusLoading(true);
    try {
      const response = await fetch(`/api/pay-later/invitations?submissionId=${encodeURIComponent(submissionId)}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const result = await response.json() as { email: "idle" | "accepted" | "pending"; whatsappAvailable?: boolean };
      if (version === statusVersion.current) { setEmailState(result.email); setWhatsappAvailable(Boolean(result.whatsappAvailable)); }
    } catch {
      if (version === statusVersion.current) setStatusError(it ? "Non possiamo verificare lo stato dell’invito. Riprova tra poco." : "We couldn't check the invitation status. Try again shortly.");
    } finally { if (version === statusVersion.current) setStatusLoading(false); }
  }

  useEffect(() => {
    if (!submissionId) return;
    let active = true;
    const version = ++statusVersion.current;
    fetch(`/api/pay-later/invitations?submissionId=${encodeURIComponent(submissionId)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("unavailable"); return response.json() as Promise<{ email: "idle" | "accepted" | "pending"; whatsappAvailable?: boolean }>; })
      .then((result) => { if (active && version === statusVersion.current) { setEmailState(result.email); setWhatsappAvailable(Boolean(result.whatsappAvailable)); } })
      .catch(() => { if (active && version === statusVersion.current) setStatusError(it ? "Non possiamo verificare lo stato dell’invito." : "We couldn't check the invitation status."); })
      .finally(() => { if (active && version === statusVersion.current) setStatusLoading(false); });
    return () => { active = false; };
  }, [submissionId, ownerEmail, it]);

  async function shareOnWhatsApp() {
    if (!submissionId || !validPhone) return;
    try {
      const response = await fetch("/api/pay-later/invitations", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId, mode: "share", locale }) });
      const result = await response.json() as { whatsappUrl?: string };
      if (!response.ok || !result.whatsappUrl) throw new Error("unavailable");
      window.location.assign(result.whatsappUrl);
    } catch { setSendError(it ? "Condivisione non disponibile. Riprova più tardi." : "Sharing is unavailable. Try again later."); }
  }

  async function send() {
    if (!submissionId || !validEmail || sending.current || cooldownSeconds > 0) return;
    sending.current = true; statusVersion.current++; setStatusLoading(false);
    setPending(true); setSendError(""); setMissingFields([]);
    try {
      const response = await fetch("/api/pay-later/invitations", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, mode: validPhone ? "email_whatsapp" : "email", locale }),
      });
      const result: { email?: "accepted" | "pending"; whatsappUrl?: string | null; error?: string; invalidFields?: string[]; retryAfterSeconds?: number } = await response.json();
      setStatusError("");
      if (response.status === 429 && result.error === "cooldown") {
        setCooldownUntil(Date.now() + Math.max(1, result.retryAfterSeconds ?? 300) * 1000);
        setNow(Date.now());
        return;
      }
      if (response.status === 409 && result.error === "pay_later_missing_fields") {
        setMissingFields((result.invalidFields ?? []).filter((field) => field in fieldLabels));
        setSendError(it ? "Completa questi dati della scheda prima di inviare il link:" : "Complete these listing details before sending the link:");
        return;
      }
      if (!response.ok && response.status !== 202) throw new Error(result.error || "unavailable");
      setEmailState(result.email === "accepted" ? "accepted" : "pending");
      setWhatsappUrl(result.email === "accepted" ? result.whatsappUrl ?? null : null);
      setWhatsappAvailable(result.email === "accepted" && Boolean(result.whatsappUrl));
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "unavailable";
      setSendError(code === "pay_later_submission_ineligible"
        ? it ? "Questa bozza non può più ricevere un invito. Aggiorna la pagina e controlla lo stato della scheda." : "This draft can no longer receive an invitation. Refresh and check its status."
        : it ? "Invio non riuscito. La scheda è salvata; riprova più tardi." : "Sending failed. The listing is saved; try again later.");
    } finally { sending.current = false; setPending(false); }
  }

  if (emailState !== "idle") return <section className={styles.emailScreen} aria-live="polite">
    <span className={styles.heroIcon}><IconCheck size={39} aria-hidden="true" /></span>
    <span className={styles.kicker}>{it ? "Invito al titolare" : "Owner invitation"}</span>
    <h1 className={styles.title}>{emailState === "accepted" ? (it ? "Link inviato!" : "Link sent!") : (it ? "Invito salvato" : "Invitation saved")}</h1>
    <p className={styles.subtitle}>{emailState === "accepted"
      ? it ? "Il provider ha accettato l’email. Il titolare potrà completare la procedura quando vuole." : "The email provider accepted the message. The owner can complete the process later."
      : it ? "L’email è in attesa di un nuovo tentativo. Non è ancora stata confermata la consegna." : "The email is awaiting a retry. Delivery has not been confirmed."}</p>
    <p className={styles.successEmail}>{ownerEmail}</p>
    <p className={styles.info}>{it ? `${businessName} resterà non pubblicata fino al pagamento e all’approvazione.` : `${businessName} remains unpublished until payment and approval.`}</p>
    <a href="/dashboard/businesses" className={styles.primaryAction}>{it ? "Torna alla dashboard" : "Return to dashboard"}<IconArrowRight size={20} aria-hidden="true" /></a>
    {whatsappAvailable && emailState === "accepted" ? whatsappUrl
      ? <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={styles.secondaryAction}><IconBrandWhatsapp size={20} aria-hidden="true" />{it ? "Condividi su WhatsApp" : "Share on WhatsApp"}</a>
      : <button type="button" onClick={shareOnWhatsApp} className={styles.secondaryAction}><IconBrandWhatsapp size={20} aria-hidden="true" />{it ? "Condividi su WhatsApp" : "Share on WhatsApp"}</button> : null}
    {emailState === "pending" ? <button type="button" disabled={statusLoading} onClick={refreshStatus} className={styles.back}>{it ? "Controlla di nuovo l’invio" : "Check sending again"}</button> : null}
    {sendError ? <p role="alert" className={styles.error}>{sendError}</p> : null}
    {statusError ? <p role="alert" className={styles.error}>{statusError}</p> : null}
  </section>;

  return <section className={styles.emailScreen}>
    <div className={styles.topline}><span className={styles.kicker}>{it ? "Pagamento" : "Payment"}</span><span className={styles.count}>{it ? "1 di 2" : "1 of 2"}</span></div>
    <span className={styles.heroIcon}><IconMail size={38} aria-hidden="true" /></span>
    <h1 className={styles.title}>{it ? "Vuoi pagare più tardi?" : "Would you like to pay later?"}</h1>
    <p className={styles.subtitle}>{it ? "Ti invieremo un link sicuro via email per continuare quando vuoi." : "We'll send a secure email link so you can continue when you like."}</p>
    {financialPaymentPaused ? <p role="status" className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">{it ? "I pagamenti sono temporaneamente sospesi durante i test. L'invito, la verifica e la firma restano disponibili; non verrà addebitato nulla ora." : "Payments are temporarily paused during testing. The invitation, verification and signature remain available; no charge will be made now."}</p> : null}
    <div className={styles.emailCard}>
      <div><span className={styles.emailLabel}>{it ? "Email del titolare" : "Owner email"}</span>
        {validEmail ? <strong className={styles.emailValue}>{ownerEmail}</strong> : <><input type="email" inputMode="email" autoComplete="email" value={emailInput} onChange={(event) => setEmailInput(event.target.value)} placeholder={it ? "Email del titolare" : "Owner email"} className={styles.emailInput} aria-label={it ? "Email del titolare" : "Owner email"} /><small className={styles.emailHelp}>{it ? "Per pagare più tardi serve un’email controllata dal titolare." : "Pay Later requires an email controlled by the owner."}</small></>}</div>
      {validEmail ? <button type="button" onClick={() => onCorrectEmail()} className={styles.editEmail}>{it ? "Modifica" : "Edit"}</button>
        : <button type="button" disabled={!enteredEmailValid} onClick={() => onCorrectEmail(emailInput.trim())} className={styles.editEmail}>{it ? "Continua" : "Continue"}</button>}
    </div>
    {sendError ? <div role="alert" className={styles.error}><p>{sendError}</p>{missingFields.map((field) => <button key={field} type="button" onClick={() => onFixField(field)} className={styles.secondaryAction}>{fieldLabels[field][locale]} · {it ? "Modifica" : "Edit"}</button>)}</div> : null}
    {statusError ? <p role="alert" className={styles.error}>{statusError}</p> : null}
    {statusError ? <button type="button" disabled={statusLoading} onClick={refreshStatus} className={styles.secondaryAction}>{it ? "Riprova verifica invito" : "Retry invitation status check"}</button> : null}
    {cooldownSeconds > 0 ? <p role="status" className={styles.error}>{it ? `Attendi ${cooldownSeconds} secondi prima di riprovare.` : `Try again in ${cooldownSeconds} seconds.`}</p> : null}
    <button type="button" disabled={!validEmail || !submissionId || pending || cooldownSeconds > 0} onClick={send} className={styles.sendButton}><IconMail size={25} aria-hidden="true" /><span>{pending ? (it ? "Invio in corso..." : "Sending...") : it ? "Invia il link via email" : "Send email link"}</span><IconArrowRight size={24} aria-hidden="true" /></button>
    <div className={styles.emailInfo}><IconInfoCircle size={25} aria-hidden="true" /><p><strong>{it ? "Nessun pagamento richiesto ora." : "No payment required now."}</strong><span>{it ? "La tua scheda sarà pubblicata solo dopo il pagamento e l’approvazione." : "Your listing will be published only after payment and approval."}</span></p></div>
    <button type="button" onClick={onBack} className={styles.back}><IconArrowLeft size={20} aria-hidden="true" />{it ? "Indietro" : "Back"}</button>
  </section>;
}
