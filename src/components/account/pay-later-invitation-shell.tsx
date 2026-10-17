"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { PayLaterOwnerClient, type PayLaterOwnerSubmission } from "@/components/account/pay-later-owner-client";

type Loaded = { token: string; verified: boolean; emailHint: string; paymentPaused: boolean; paymentTestMode: boolean; submission: PayLaterOwnerSubmission | null };

export function PayLaterInvitationShell({ locale }: { locale: Locale }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("invite") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      queueMicrotask(() => { if (active) setError(true); });
      return () => { active = false; };
    }
    fetch("/api/pay-later", { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "load", token }) })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<Omit<Loaded, "token">>;
      })
      .then((result) => { if (active) setLoaded({ ...result, token }); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  if (error) return <main className="shell px-4 py-16"><section className="card mx-auto max-w-lg p-7 text-center"><h1 className="font-serif text-3xl">{locale === "it" ? "Invito non disponibile" : "Invitation unavailable"}</h1><p className="mt-4 text-[var(--muted)]">{locale === "it" ? "Il link è scaduto o non è più valido. Contatta chi ha creato la scheda per un nuovo invito." : "This link has expired or is no longer valid. Contact the person who created the listing for a new invitation."}</p></section></main>;
  if (!loaded) return <main className="shell px-4 py-16"><div role="status" className="card mx-auto max-w-lg p-7 text-center">{locale === "it" ? "Caricamento dell’invito..." : "Loading invitation..."}</div></main>;
  return <PayLaterOwnerClient {...loaded} locale={locale} />;
}
