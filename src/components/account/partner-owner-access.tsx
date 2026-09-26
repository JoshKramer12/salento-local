"use client";

import { useState } from "react";
import { IconKey, IconMail, IconBrandWhatsapp } from "@tabler/icons-react";
import type { Locale } from "@/lib/i18n";

import styles from "./partner-owner-access.module.css";

const copy = {
  en: { title: "Owner access", help: "Help the owner access their business.", email: "Send access by email", whatsapp: "Send via WhatsApp", sent: "Access email sent.", noEmail: "Email unavailable", noWhatsapp: "WhatsApp unavailable", error: "Access could not be sent. Please try again.", cooldown: "An access email was recently sent. Please wait a few minutes.", loading: "Checking access options…", sending: "Sending…" },
  it: { title: "Accesso titolare", help: "Aiuta il titolare ad accedere alla sua attività.", email: "Invia accesso via email", whatsapp: "Invia tramite WhatsApp", sent: "Email di accesso inviata.", noEmail: "Email non disponibile", noWhatsapp: "WhatsApp non disponibile", error: "Impossibile inviare l'accesso. Riprova.", cooldown: "Un'email di accesso è stata inviata di recente. Attendi qualche minuto.", loading: "Verifica delle opzioni…", sending: "Invio…" },
} as const;

export function PartnerOwnerAccess({ locale, submissionId }: { locale: Locale; submissionId: string }) {
  const [open, setOpen] = useState(false);
  const [methods, setMethods] = useState<{ email: boolean; whatsapp: boolean } | null>(null);
  const [busy, setBusy] = useState<"email" | "whatsapp" | null>(null);
  const [message, setMessage] = useState("");
  const text = copy[locale];

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setMessage("");
    try {
      const response = await fetch(`/api/partner/owner-access?submission=${encodeURIComponent(submissionId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("options unavailable");
      setMethods(await response.json());
    } catch { setMessage(text.error); }
  }

  async function send(method: "email" | "whatsapp") {
    if (busy) return;
    setBusy(method);
    setMessage("");
    try {
      const response = await fetch("/api/partner/owner-access", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({ submissionId, method }),
      });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error === "cooldown" ? text.cooldown : text.error); return; }
      if (method === "email") setMessage(text.sent);
      else if (result.status === "ready" && typeof result.href === "string" && result.href.startsWith("https://wa.me/")) window.location.assign(result.href);
      else setMessage(text.error);
    } catch { setMessage(text.error); }
    finally { setBusy(null); }
  }

  return <div className={styles.wrap}>
    <button type="button" className={styles.toggle} aria-expanded={open} onClick={toggle}><IconKey aria-hidden="true" size={17} />{text.title}</button>
    {open ? <div className={styles.panel}>
      <p>{text.help}</p>
      {methods ? <div className={styles.actions}>
        {methods.email ? <button type="button" disabled={Boolean(busy)} onClick={() => send("email")}><IconMail aria-hidden="true" size={18} />{busy === "email" ? text.sending : text.email}</button> : <span>{text.noEmail}</span>}
        {methods.whatsapp ? <button type="button" disabled={Boolean(busy)} onClick={() => send("whatsapp")}><IconBrandWhatsapp aria-hidden="true" size={18} />{busy === "whatsapp" ? text.sending : text.whatsapp}</button> : <span>{text.noWhatsapp}</span>}
      </div> : !message ? <span className={styles.loading}>{text.loading}</span> : null}
      {message ? <p role="status" className={styles.message}>{message}</p> : null}
    </div> : null}
  </div>;
}
