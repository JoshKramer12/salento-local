"use client";

import { useState } from "react";
import { turnOffMembershipAutoRenewAction } from "@/app/(account)/membership-actions";
import type { Locale } from "@/lib/i18n";

export function AutoRenewCancelControl({ businessId, endDate, locale }: { businessId: string; endDate: string; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const italian = locale === "it";
  return <>
    <button type="button" className="btn-secondary min-h-11" onClick={() => setOpen(true)}>{italian ? "Disattiva rinnovo automatico" : "Turn off automatic renewal"}</button>
    {open ? <div role="dialog" aria-modal="true" aria-label={italian ? "Disattiva rinnovo automatico" : "Turn off automatic renewal"} className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><h2 className="font-serif text-2xl text-[var(--foreground)]">{italian ? "Disattivare il rinnovo automatico?" : "Turn off automatic renewal?"}</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{italian ? `La Pagina Attività resterà attiva fino al ${endDate}. Non ti verrà addebitato automaticamente dopo questa data. Puoi rinnovare manualmente o riattivare il rinnovo prima della fine del periodo.` : `Your Business Page will remain active until ${endDate}. You will not be charged automatically after that date. You can renew manually or turn automatic renewal back on before the term ends.`}</p><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" className="btn-secondary min-h-11" onClick={() => setOpen(false)}>{italian ? "Mantieni rinnovo automatico" : "Keep automatic renewal"}</button><form action={turnOffMembershipAutoRenewAction}><input type="hidden" name="businessId" value={businessId} /><button type="submit" className="btn-primary min-h-11">{italian ? "Disattiva rinnovo automatico" : "Turn off automatic renewal"}</button></form></div></div></div> : null}
  </>;
}
