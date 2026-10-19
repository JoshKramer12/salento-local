import Link from "next/link";

import type { Locale } from "@/lib/i18n";

export function PartnerTermsNotice({ locale }: { locale: Locale }) {
  const it = locale === "it";
  return <div className="shell px-4 pt-6 sm:px-6">
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] p-5 text-sm leading-6 text-[var(--foreground)]">
      <p className="font-semibold">{it ? "Termini Partner aggiornati" : "Updated Partner Terms"}</p>
      <p className="mt-1">{it ? "Accetta i nuovi termini prima che i tuoi recapiti siano condivisi con i titolari delle attività che registri. Puoi continuare ad accedere al tuo account e ai guadagni." : "Accept the new terms before your contact details are shared with owners of businesses you register. Your account and earnings remain available."}</p>
      <Link href="/partner/terms" className="mt-3 inline-block font-semibold text-[var(--primary)] underline">{it ? "Leggi e accetta" : "Read and accept"}</Link>
    </div>
  </div>;
}
