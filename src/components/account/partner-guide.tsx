import {
  IconBuildingStore,
  IconCreditCard,
  IconFileText,
  IconMapPin,
  IconMessage,
  IconPhoto,
  IconUserCheck,
} from "@tabler/icons-react";
import type { TablerIcon } from "@tabler/icons-react";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import type { Locale } from "@/lib/i18n";

export function PartnerGuide({ locale }: { locale: Locale }) {
  const copy =
    locale === "it"
      ? {
          checklist: [
            ["Informazioni attivita", "Nome, categoria e indirizzo", IconBuildingStore],
            ["Contatti", "Telefono, WhatsApp ed email quando disponibili", IconMessage],
            ["Titolare o responsabile", "La persona che approvera la scheda", IconUserCheck],
            ["Dettagli e orari", "Cosa offre l'attivita e i suoi orari", IconFileText],
            ["Foto", "Le foto per rendere completa la pagina", IconPhoto],
            ["Approvazione e pagamento", "Il titolare conferma e paga tramite Salento Local", IconCreditCard],
          ],
          checklistTitle: "Cosa ti serve",
          cta: "Aggiungi un'attivita",
          earnings: "Guadagni €50 per ogni attivita che entra con successo nella piattaforma. La commissione viene registrata nel dashboard in base allo stato reale della pratica.",
          earningsTitle: "Guadagni e pagamenti",
          how: [
            "Trova un'attivita locale e parla con il titolare o responsabile.",
            "Spiega che Salento Local aiuta le persone a scoprire le attivita del territorio.",
            "Create insieme la scheda con le informazioni necessarie.",
            "Il titolare rivede, approva e paga direttamente sulla piattaforma.",
          ],
          howTitle: "Come funziona",
          intro: "Una guida rapida da tenere con te quando incontri un'attivita.",
          payment: "Non raccogli mai personalmente il pagamento.",
          script: "Ciao! Lavoro con Salento Local, una guida online dedicata alle attivita del Salento. Stiamo aggiungendo attivita della zona e volevo mostrarle velocemente come funziona.",
          scriptHint: "Inizia chiedendo se il titolare o il responsabile e disponibile.",
          scriptTitle: "Cosa dico?",
          title: "Guida Partner locale",
        }
      : {
          checklist: [
            ["Business information", "Name, category, and address", IconBuildingStore],
            ["Contact details", "Phone, WhatsApp, and email when available", IconMessage],
            ["Owner or manager", "The person who will approve the listing", IconUserCheck],
            ["Details and hours", "What the business offers and its regular hours", IconFileText],
            ["Photos", "The photos that make the listing complete", IconPhoto],
            ["Approval and payment", "The owner confirms and pays through Salento Local", IconCreditCard],
          ],
          checklistTitle: "What you will need",
          cta: "Add a business",
          earnings: "You earn €50 for every business that successfully joins the platform. Your commission is recorded in the dashboard according to the listing's real status.",
          earningsTitle: "Earnings and payment",
          how: [
            "Find a local business and speak with the owner or manager.",
            "Explain that Salento Local helps people discover businesses across the area.",
            "Create the listing together with the information it needs.",
            "The owner reviews, approves, and pays directly through the platform.",
          ],
          howTitle: "How it works",
          intro: "A quick guide to keep with you when you meet a business.",
          payment: "You never personally collect payment.",
          script: "Hi! I work with Salento Local, an online guide dedicated to businesses in Salento. We are adding local businesses and I wanted to quickly show you how it works.",
          scriptHint: "Start by asking whether the owner or manager is available.",
          scriptTitle: "What do I say?",
          title: "Local Partner guide",
        };

  return (
    <div className="grid gap-8">
      <section className="card overflow-hidden bg-[linear-gradient(135deg,rgba(42,98,87,0.10),rgba(255,255,255,0.96)_58%,rgba(191,91,42,0.08))] p-7 sm:p-10">
        <p className="section-kicker mb-3">{locale === "it" ? "PARTNER LOCALE" : "LOCAL PARTNER"}</p>
        <h1 className="font-serif text-4xl text-[var(--foreground)] sm:text-5xl">{copy.title}</h1>
        <p className="mt-4 max-w-2xl text-[var(--muted)]">{copy.intro}</p>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="card p-7">
          <p className="section-kicker mb-3">{copy.howTitle}</p>
          <div className="grid gap-4">
            {copy.how.map((item, index) => (
              <div key={item} className="flex gap-4 rounded-[1.35rem] bg-[color:rgba(247,244,239,0.68)] p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <p className="pt-1 text-sm leading-6 text-[var(--foreground)]">{item}</p>
              </div>
            ))}
          </div>
        </article>
        <article className="card p-7">
          <p className="section-kicker mb-3">{copy.scriptTitle}</p>
          <p className="text-sm text-[var(--muted)]">{copy.scriptHint}</p>
          <blockquote className="mt-5 rounded-[1.5rem] border border-[color:rgba(42,98,87,0.18)] bg-[color:rgba(42,98,87,0.07)] p-6 font-serif text-2xl leading-9 text-[var(--foreground)]">
            &ldquo;{copy.script}&rdquo;
          </blockquote>
          <p className="mt-5 rounded-[1.2rem] bg-[color:rgba(191,91,42,0.10)] px-5 py-4 text-sm font-medium text-[var(--foreground)]">
            {copy.payment}
          </p>
        </article>
      </section>

      <section className="card p-7">
        <p className="section-kicker mb-3">{copy.checklistTitle}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {copy.checklist.map((item) => {
            const [title, body, Icon] = item as [string, string, TablerIcon];

            return (
              <div key={title} className="flex gap-3 rounded-[1.35rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.56)] p-4">
                <Icon size={19} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                <div>
                  <h2 className="font-medium text-[var(--foreground)]">{title}</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-5 rounded-[1.75rem] border border-[color:rgba(42,98,87,0.15)] bg-[color:rgba(42,98,87,0.06)] p-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="section-kicker mb-2">{copy.earningsTitle}</p>
          <p className="text-[var(--foreground)]">{copy.earnings}</p>
        </div>
        <HardNavigationLink href="/publish" className="btn-primary shrink-0">
          <IconMapPin size={18} />
          {copy.cta}
        </HardNavigationLink>
      </section>
    </div>
  );
}
