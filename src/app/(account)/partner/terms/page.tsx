import Link from "next/link";
import { redirect } from "next/navigation";

import { acceptUpdatedPartnerTermsAction } from "./actions";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { LEGAL_DOCUMENTS } from "@/lib/legal";
import { prisma } from "@/lib/prisma";

export default async function PartnerTermsPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [viewer, locale, params] = await Promise.all([
    requireCompletedViewer(), getCurrentLocale(), searchParams,
  ]);
  if (viewer.role !== "GETTER") redirect("/dashboard");
  const accepted = await prisma.legalAcceptance.findFirst({
    where: { userId: viewer.id, documentType: "PARTNER_TERMS", documentVersion: LEGAL_DOCUMENTS.partnerTerms.version },
    select: { id: true },
  });
  const it = locale === "it";

  return <main className="shell px-4 py-10 sm:px-6">
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard" className="btn-secondary">{it ? "Torna all'area Partner" : "Back to Partner dashboard"}</Link>
      <section className="card mt-6 p-6 sm:p-8">
        <p className="section-kicker">{it ? "Termini Partner aggiornati" : "Updated Partner Terms"}</p>
        <h1 className="mt-3 font-serif text-3xl text-[var(--foreground)]">{it ? "Condivisione dei tuoi recapiti" : "Sharing your contact details"}</h1>
        <p className="mt-4 text-sm leading-7 text-[var(--foreground)]">
          {it
            ? "Il tuo nome, l'email e il numero WhatsApp o di telefono registrati saranno condivisi soltanto con i titolari delle attività che registri, per domande e assistenza relative alla loro scheda. Questi recapiti non saranno pubblicati nella directory per questo scopo."
            : "Your registered name, email, and WhatsApp or phone number will be shared only with the owners of businesses you register, so they can ask you about their listing. These details will not be published in the directory for this purpose."}
        </p>
        <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
          {it ? "Consulta i " : "Read the "}<Link href="/terms#partner-terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--primary)] underline">{it ? "Termini Partner completi" : "full Partner Terms"}</Link>
          {it ? " e la " : " and "}<Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--primary)] underline">{it ? "Informativa sulla Privacy" : "Privacy Policy"}</Link>.
        </p>
        {accepted ? <p className="mt-6 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--primary)]">{it ? "Hai già accettato questa versione dei Termini Partner." : "You have already accepted this version of the Partner Terms."}</p> : <form action={acceptUpdatedPartnerTermsAction} className="mt-6 space-y-5">
          <input type="hidden" name="version" value={LEGAL_DOCUMENTS.partnerTerms.version} />
          <label className="flex items-start gap-3 text-sm leading-6 text-[var(--foreground)]">
            <input type="checkbox" name="accepted" required className="mt-1 h-4 w-4 accent-[var(--primary)]" />
            <span>{it ? "Ho letto e accetto i Termini Partner aggiornati e dichiaro di aver preso visione dell'Informativa sulla Privacy aggiornata." : "I have read and accept the updated Partner Terms and acknowledge the updated Privacy Policy."}</span>
          </label>
          {params.error ? <p role="alert" className="text-sm text-[var(--accent)]">{it ? "Conferma l'accettazione della versione attuale e riprova." : "Accept the current version and try again."}</p> : null}
          <button type="submit" className="btn-primary">{it ? "Accetta i Termini aggiornati" : "Accept updated terms"}</button>
        </form>}
      </section>
    </div>
  </main>;
}
