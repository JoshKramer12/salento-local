"use client";

import { IconArrowLeft, IconBrandWhatsapp, IconMail, IconCheck } from "@tabler/icons-react";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";

type Props = {
  submissionId: string;
  businessName: string;
  ownerEmail: string;
  ownerPhone: string;
  locale: Locale;
  onBack: () => void;
  onCorrectEmail: () => void;
};

export function PayLaterPartnerInvitation({ submissionId, businessName, ownerEmail, ownerPhone, locale, onBack, onCorrectEmail }: Props) {
  const it = locale === "it";
  const [pending, setPending] = useState(false);
  const [emailState, setEmailState] = useState<"idle" | "accepted" | "pending">("idle");
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim());
  const validPhone = /^\+[1-9]\d{7,14}$/.test(ownerPhone.trim());

  async function send(mode: "email" | "email_whatsapp") {
    if (!submissionId || !validEmail || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/pay-later/invitations", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, mode, locale }),
      });
      const result: { email?: "accepted" | "pending"; whatsappUrl?: string | null; error?: string } = await response.json();
      if (!response.ok && response.status !== 202) throw new Error(result.error || "unavailable");
      setEmailState(result.email === "accepted" ? "accepted" : "pending");
      if (result.email === "accepted" && result.whatsappUrl) {
        setWhatsappUrl(result.whatsappUrl);
        window.open(result.whatsappUrl, "_blank", "noopener,noreferrer");
      }
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "unavailable";
      setError(code === "cooldown"
        ? it ? "Attendi qualche minuto prima di inviare di nuovo." : "Wait a few minutes before sending again."
        : code === "pay_later_submission_ineligible"
          ? it ? "Completa i dati richiesti della scheda e salva prima di inviare." : "Complete the required listing details and save before sending."
          : it ? "Invio non riuscito. La scheda è salvata; riprova più tardi." : "Sending failed. The listing is saved; try again later.");
    } finally { setPending(false); }
  }

  return <div className="mx-auto grid max-w-xl gap-5">
    <div><p className="section-kicker">{it ? "Invito al titolare" : "Owner invitation"}</p>
      <h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">{it ? "Completa più tardi" : "Complete later"}</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{it
        ? `La scheda di ${businessName} è salvata. Il titolare riceverà un link sicuro per verificare la propria email, controllare la scheda, firmare e decidere come pagare €100 all’anno.`
        : `The listing for ${businessName} is saved. The owner will receive a secure link to verify their email, review the listing, sign, and choose how to pay €100 per year.`}</p>
    </div>
    <div className="rounded-[1.5rem] border border-[var(--border)] bg-white p-5">
      <p className="text-sm font-semibold text-[var(--foreground)]">{it ? "Conferma il destinatario" : "Confirm the recipient"}</p>
      <dl className="mt-3 grid gap-2 text-sm"><div><dt className="font-semibold">Email</dt><dd className="break-all text-[var(--muted)]">{ownerEmail || (it ? "Mancante" : "Missing")}</dd></div>
        <div><dt className="font-semibold">{it ? "Telefono" : "Phone"}</dt><dd className="text-[var(--muted)]">{ownerPhone || (it ? "Mancante" : "Missing")}</dd></div></dl>
      {!validEmail ? <p role="alert" className="mt-4 text-sm text-[var(--accent)]">{it ? "Per Pay Later serve un’email valida del titolare." : "Pay Later requires a valid owner email."}</p> : null}
      <button type="button" onClick={onCorrectEmail} className="mt-4 text-sm font-semibold text-[var(--primary)] underline">{it ? "Correggi i contatti del titolare" : "Correct owner contact details"}</button>
    </div>
    {error ? <p role="alert" className="rounded-xl bg-[rgba(191,91,42,.08)] p-3 text-sm text-[var(--accent)]">{error}</p> : null}
    {emailState === "idle" ? <div className="grid gap-3">
      <button type="button" disabled={!validEmail || !submissionId || pending} onClick={() => send("email")} className="btn-primary w-full justify-center disabled:opacity-50"><IconMail size={19} />{pending ? (it ? "Invio..." : "Sending...") : it ? "Invia invito via email" : "Send email invitation"}</button>
      {validPhone ? <button type="button" disabled={!validEmail || !submissionId || pending} onClick={() => send("email_whatsapp")} className="btn-secondary w-full justify-center disabled:opacity-50"><IconBrandWhatsapp size={19} />{it ? "Email + WhatsApp" : "Email + WhatsApp"}</button> : null}
      <p className="text-center text-xs text-[var(--muted)]">{it ? "L’email è sempre obbligatoria. WhatsApp apre solo la condivisione: non conferma l’invio del messaggio." : "Email is always required. Opening WhatsApp does not confirm that the message was sent."}</p>
    </div> : <div className="rounded-[1.5rem] border border-[rgba(42,98,87,.3)] bg-[rgba(237,248,242,.65)] p-5">
      <div className="flex gap-3"><IconCheck className="shrink-0 text-[var(--primary)]" />
        <div><p className="font-semibold">{emailState === "accepted" ? (it ? "Email accettata dal provider" : "Email accepted by provider") : (it ? "Invito salvato, email in attesa di nuovo tentativo" : "Invitation saved, email awaiting retry")}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{it ? "La scheda resta non pubblicata e non pagata fino al completamento da parte del titolare." : "The listing remains unpublished and unpaid until the owner completes it."}</p></div></div>
      {whatsappUrl ? <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary mt-4 w-full justify-center"><IconBrandWhatsapp size={19} />{it ? "Apri WhatsApp per condividere" : "Open WhatsApp to share"}</a> : null}
      <a href="/dashboard/businesses" className="btn-primary mt-4 w-full justify-center">{it ? "Vai alla dashboard" : "Go to dashboard"}</a>
    </div>}
    <button type="button" onClick={onBack} className="btn-secondary justify-self-start"><IconArrowLeft size={18} />{it ? "Indietro" : "Back"}</button>
  </div>;
}
