import { IconArrowRight, IconBuildingStore, IconCheck, IconCoins, IconFileText, IconUserCheck } from "@tabler/icons-react";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import { getCurrentLocale } from "@/lib/locale";

export default async function EarnWithUsPage() {
  const locale = await getCurrentLocale();
  const copy = locale === "it" ? {
    already: "Sei gia Partner? Accedi",
    bottom: "Inizia a guadagnare",
    benefits: [
      ["Quando ti e comodo", "Nessun turno fisso: scegli tu quando parlare con le attivita."],
      ["Tutto dentro Salento Local", "Non raccogli personalmente il pagamento del titolare."],
      ["Tieni tutto sotto controllo", "Schede, bozze, pagamenti e commissioni sono nel tuo dashboard."],
    ],
    benefitsTitle: "Un modo semplice per iniziare",
    cta: "Diventa Partner locale",
    eyebrow: "PARTNER LOCALE",
    hero: "Aiuta le attivita locali a entrare in Salento Local e guadagna",
    next: "Crea il tuo account, completa pochi dati essenziali e sei pronto a iniziare.",
    steps: [
      ["Trova un'attivita", "Parla con ristoranti, bar, negozi, B&B e altre attivita della zona."],
      ["Crea la loro pagina", "Salento Local ti guida nel raccogliere le informazioni per la scheda."],
      ["L'attivita approva", "Il titolare verifica le informazioni e completa il processo sulla piattaforma."],
      ["Guadagni €50", "La commissione viene registrata nel tuo account Partner."],
    ],
    stepsTitle: "Come funziona",
  } : {
    already: "Already a partner? Log in",
    bottom: "Start earning",
    benefits: [
      ["Work when it suits you", "There are no fixed shifts. Talk to businesses when it works for you."],
      ["Everything happens in Salento Local", "You never personally collect the owner’s payment."],
      ["Track it in one place", "Listings, drafts, payment status, and commissions live in your dashboard."],
    ],
    benefitsTitle: "A simple way to get started",
    cta: "Become a Local Partner",
    eyebrow: "LOCAL PARTNER",
    hero: "Help local businesses join Salento Local and earn",
    next: "Create your account, add a few essential details, and you are ready to begin.",
    steps: [
      ["Find a business", "Speak with restaurants, bars, shops, B&Bs, and other local businesses."],
      ["Create their page", "Salento Local guides you through collecting what their listing needs."],
      ["They approve and join", "The owner reviews the information and completes the process directly in the platform."],
      ["You earn €50", "The commission is tracked in your Local Partner account."],
    ],
    stepsTitle: "How it works",
  };
  const icons = [IconBuildingStore, IconFileText, IconUserCheck, IconCoins];

  return <main className="shell px-4 py-10 sm:px-6 sm:py-14">
    <section className="overflow-hidden rounded-[2rem] border border-[var(--border)] bg-white p-7 shadow-[var(--shadow-soft)] sm:p-12">
      <h1 className="max-w-3xl font-serif text-4xl leading-tight text-[var(--foreground)] sm:text-6xl">{locale === "it" ? "Guadagna con Salento Local" : "Earn with Salento Local"}</h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--foreground)]">{copy.hero} <strong className="font-serif text-3xl text-[var(--primary)]">€50</strong> {locale === "it" ? "per ogni attivita che entra con successo nella piattaforma." : "for every business that successfully joins the platform."}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"><HardNavigationLink href="/partner/join" className="btn-primary">{copy.cta}<IconArrowRight size={18} /></HardNavigationLink><HardNavigationLink href="/login?redirectTo=%2Fpartner%2Fstart" className="text-sm font-medium text-[var(--primary)] underline underline-offset-4">{copy.already}</HardNavigationLink></div>
    </section>
    <section className="py-14 sm:py-20"><p className="section-kicker mb-3">{copy.stepsTitle}</p><div className="grid gap-4 md:grid-cols-4">{copy.steps.map(([title, body], index) => { const Icon = icons[index]; return <article key={title} className="card p-6"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:rgba(42,98,87,0.1)] text-[var(--primary)]"><Icon size={21}/></span><p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">0{index + 1}</p><h2 className="mt-2 font-serif text-2xl text-[var(--foreground)]">{title}</h2><p className="mt-3 text-sm leading-7 text-[var(--muted)]">{body}</p></article>})}</div></section>
    <section className="grid gap-5 rounded-[2rem] bg-[color:rgba(247,244,239,0.8)] p-7 sm:p-10 lg:grid-cols-3"><div className="lg:col-span-3"><p className="section-kicker mb-2">{copy.benefitsTitle}</p><p className="max-w-2xl text-[var(--muted)]">{copy.next}</p></div>{copy.benefits.map(([title, body]) => <article key={title} className="rounded-[1.5rem] border border-[var(--border)] bg-white/75 p-5"><IconCheck size={18} className="text-[var(--primary)]"/><h2 className="mt-4 font-serif text-2xl text-[var(--foreground)]">{title}</h2><p className="mt-2 text-sm leading-7 text-[var(--muted)]">{body}</p></article>)}</section>
    <section className="py-14 text-center"><h2 className="font-serif text-4xl text-[var(--foreground)]">{copy.bottom}</h2><HardNavigationLink href="/partner/join" className="btn-primary mt-6">{copy.cta}<IconArrowRight size={18}/></HardNavigationLink></section>
  </main>;
}
