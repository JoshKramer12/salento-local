"use client";

import { IconArrowLeft, IconArrowRight, IconBrandWhatsapp, IconCheck, IconInfoCircle, IconMail } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import styles from "./pay-later-payment-steps.module.css";

type Props = {
  submissionId: string; businessName: string; ownerEmail: string; ownerPhone: string; locale: Locale;
  financialPaymentPaused?: boolean;
  onBack: () => void; onCorrectEmail: (nextEmail?: string) => void;
};

export function PayLaterPartnerInvitation({ submissionId, businessName, ownerEmail, ownerPhone, locale, financialPaymentPaused = false, onBack, onCorrectEmail }: Props) {
  const it = locale === "it";
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const [emailState, setEmailState] = useState<"idle" | "accepted" | "pending">("idle");
  const [statusLoading, setStatusLoading] = useState(Boolean(submissionId));
  const [emailInput, setEmailInput] = useState("");
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim());
  const validPhone = /^\+[1-9]\d{7,14}$/.test(ownerPhone.trim());
  const enteredEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim());

  async function refreshStatus() {
    if (!submissionId) return;
    setError("");
    setStatusLoading(true);
    try {
      const response = await fetch(`/api/pay-later/invitations?submissionId=${encodeURIComponent(submissionId)}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const result = await response.json() as { email: "idle" | "accepted" | "pending" };
      setEmailState(result.email);
    } catch {
      setError(it ? "Non possiamo verificare lo stato dell’invito. Riprova tra poco." : "We couldn't check the invitation status. Try again shortly.");
    } finally { setStatusLoading(false); }
  }

  useEffect(() => {
    if (!submissionId) return;
    let active = true;
    fetch(`/api/pay-later/invitations?submissionId=${encodeURIComponent(submissionId)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("unavailable"); return response.json() as Promise<{ email: "idle" | "accepted" | "pending" }>; })
      .then((result) => { if (active) setEmailState(result.email); })
      .catch(() => { if (active) setError(it ? "Non possiamo verificare lo stato dell’invito." : "We couldn't check the invitation status."); })
      .finally(() => { if (active) setStatusLoading(false); });
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
    } catch { setError(it ? "Condivisione non disponibile. Riprova più tardi." : "Sharing is unavailable. Try again later."); }
  }

  async function send() {
    if (!submissionId || !validEmail || sending.current) return;
    sending.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/pay-later/invitations", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, mode: validPhone ? "email_whatsapp" : "email", locale }),
      });
      const result: { email?: "accepted" | "pending"; whatsappUrl?: string | null; error?: string } = await response.json();
      if (!response.ok && response.status !== 202) throw new Error(result.error || "unavailable");
      setEmailState(result.email === "accepted" ? "accepted" : "pending");
      setWhatsappUrl(result.email === "accepted" ? result.whatsappUrl ?? null : null);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "unavailable";
      setError(code === "cooldown"
        ? it ? "Attendi qualche minuto prima di inviare di nuovo." : "Wait a few minutes before trying again."
        : code === "pay_later_submission_ineligible"
          ? it ? "Salva tutti i dati richiesti prima di inviare il link." : "Save all required listing details before sending the link."
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
    {validPhone && emailState === "accepted" ? whatsappUrl
      ? <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={styles.secondaryAction}><IconBrandWhatsapp size={20} aria-hidden="true" />{it ? "Condividi su WhatsApp" : "Share on WhatsApp"}</a>
      : <button type="button" onClick={shareOnWhatsApp} className={styles.secondaryAction}><IconBrandWhatsapp size={20} aria-hidden="true" />{it ? "Condividi su WhatsApp" : "Share on WhatsApp"}</button> : null}
    {emailState === "pending" ? <button type="button" disabled={statusLoading} onClick={refreshStatus} className={styles.back}>{it ? "Controlla di nuovo l’invio" : "Check sending again"}</button> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
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
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {error ? <button type="button" disabled={statusLoading} onClick={refreshStatus} className={styles.secondaryAction}>{it ? "Riprova verifica invito" : "Retry invitation status check"}</button> : null}
    <button type="button" disabled={!validEmail || !submissionId || pending || statusLoading || Boolean(error)} onClick={send} className={styles.sendButton}><IconMail size={25} aria-hidden="true" /><span>{pending || statusLoading ? (it ? "Verifica in corso..." : "Checking...") : it ? "Invia il link via email" : "Send email link"}</span><IconArrowRight size={24} aria-hidden="true" /></button>
    <div className={styles.emailInfo}><IconInfoCircle size={25} aria-hidden="true" /><p><strong>{it ? "Nessun pagamento richiesto ora." : "No payment required now."}</strong><span>{it ? "La tua scheda sarà pubblicata solo dopo il pagamento e l’approvazione." : "Your listing will be published only after payment and approval."}</span></p></div>
    <button type="button" onClick={onBack} className={styles.back}><IconArrowLeft size={20} aria-hidden="true" />{it ? "Indietro" : "Back"}</button>
  </section>;
}
