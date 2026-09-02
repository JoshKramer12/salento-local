import { OwnerAccessRequestForm } from "@/components/account/owner-access-forms";
import { getCurrentLocale } from "@/lib/locale";

export default async function ManageBusinessPage() {
  const locale = await getCurrentLocale();
  const copy = locale === "it"
    ? { body: "Inserisci l'email usata durante l'adesione della tua attività. Se è collegata a una scheda Salento Local, ti invieremo un link sicuro.", eyebrow: "Accesso attività", title: "Gestisci la mia attività" }
    : { body: "Enter the email used when your business joined. If it is linked to a Salento Local listing, we will send you a secure link.", eyebrow: "Business access", title: "Manage my business" };
  return <main className="shell px-4 py-12 sm:px-6"><div className="mx-auto max-w-xl"><p className="section-kicker mb-3">{copy.eyebrow}</p><h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1><p className="mt-4 mb-7 text-[var(--muted)]">{copy.body}</p><OwnerAccessRequestForm locale={locale} /></div></main>;
}
