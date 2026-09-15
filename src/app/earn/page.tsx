import {
  IconArrowDown,
  IconArrowRight,
  IconBuildingStore,
  IconChartBar,
  IconCheck,
  IconClock,
  IconCoins,
  IconFileText,
  IconPlant2,
  IconSchool,
  IconUserCheck,
  IconUsersGroup,
} from "@tabler/icons-react";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import { getCurrentLocale } from "@/lib/locale";

const partnerJoinHref = "/partner/join";
const partnerLoginHref = "/login?redirectTo=%2Fpartner%2Fstart";

export default async function EarnWithUsPage() {
  const locale = await getCurrentLocale();
  const copy = locale === "it" ? {
    already: "Sei già Partner? Accedi",
    benefits: [
      ["Quando ti è più comodo", "Non ci sono turni fissi. Parla con le attività quando fa comodo a te."],
      ["Tutto avviene in Salento Local", "Non raccogli mai personalmente il pagamento del titolare. Gestiamo i pagamenti in modo sicuro attraverso la nostra piattaforma."],
      ["Tieni tutto sotto controllo", "Schede, bozze, stato dei pagamenti e commissioni sono nel tuo dashboard."],
    ],
    benefitsEyebrow: "UN MODO SEMPLICE PER INIZIARE",
    benefitsIntro: "Crea il tuo account, aggiungi pochi dati essenziali e sei pronto a iniziare.",
    benefitsTitle: "Tutto il supporto di cui hai bisogno",
    businessFirstYear: "Membership annuale dell'attività",
    cta: "Diventa Partner locale",
    directPayment: "L'attività paga Salento Local direttamente. Non raccogli mai tu il pagamento.",
    earningsBody: "Un grande valore per le attività locali e una ricompensa equa per te.",
    earningsTitle: "Guadagni semplici e trasparenti",
    finalBody: "Unisciti a Salento Local e aiuta le attività locali a crescere online.",
    finalTitle: "Inizia a guadagnare oggi",
    hero: "Aiuta le attività locali del Salento a essere online e guadagna €50 quando un’attività aderisce, più €15 ogni anno in cui la stessa attività rinnova con successo.",
    howBody: "Trova attività locali, crea la loro pagina e guadagna €50 quando entrano con successo.",
    howEyebrow: "COME FUNZIONA",
    howTitle: "Un processo semplice",
    studentBenefits: ["Flessibile e part-time", "Sostieni le attività locali", "Guadagna premi concreti", "Fai un'esperienza preziosa"],
    studentTitle: "Una grande opportunità per gli studenti del posto.",
    steps: [
      ["Trova un'attività", "Parla con ristoranti, bar, negozi, B&B e altre attività locali."],
      ["Crea la loro pagina", "Aggiungi i dati dell'attività, foto, orari di apertura e altro ancora."],
      ["Approvano e aderiscono", "Il titolare controlla la pagina e, se desidera aderire, paga €100 all'anno per quell'attività direttamente a Salento Local."],
      ["Guadagni €50", "La commissione viene registrata nel tuo account Partner locale."],
    ],
    yourCommission: "La tua commissione",
  } : {
    already: "Already a partner? Log in",
    benefits: [
      ["Work when it suits you", "There are no fixed shifts. Talk to businesses when it works for you."],
      ["Everything happens in Salento Local", "You never personally collect the owner’s payment. We handle payments securely through our platform."],
      ["Track it in one place", "Listings, drafts, payment status, and commissions live in your dashboard."],
    ],
    benefitsEyebrow: "A SIMPLE WAY TO GET STARTED",
    benefitsIntro: "Create your account, add a few essential details, and you’re ready to begin.",
    benefitsTitle: "All the support you need",
    businessFirstYear: "Business annual membership",
    cta: "Become a Local Partner",
    directPayment: "The business pays Salento Local directly. You never collect their payment yourself.",
    earningsBody: "A great value for local businesses and a fair reward for you.",
    earningsTitle: "Simple, transparent earnings",
    finalBody: "Join Salento Local and help local businesses grow online.",
    finalTitle: "Start earning today",
    hero: "Help local businesses in Salento get online and earn €50 when a business joins, plus €15 every year that same business successfully renews.",
    howBody: "Find local businesses, create their page, and earn €50 when they successfully join.",
    howEyebrow: "HOW IT WORKS",
    howTitle: "A simple process",
    studentBenefits: ["Flexible and part-time", "Support local businesses", "Earn real rewards", "Gain valuable experience"],
    studentTitle: "A great opportunity for local students.",
    steps: [
      ["Find a business", "Speak with restaurants, bars, shops, B&Bs and other local businesses."],
      ["Create their page", "Add their business details, photos, opening hours and more."],
      ["They approve and join", "The owner reviews their page and, if they want to join, pays €100 per year for that business directly to Salento Local."],
      ["You earn €50", "The commission is tracked in your Local Partner account."],
    ],
    yourCommission: "Your commission",
  };
  const stepIcons = [IconBuildingStore, IconFileText, IconUserCheck, IconCoins];
  const benefitIcons = [IconClock, IconUsersGroup, IconChartBar];
  const stepIconStyles = [
    "bg-[rgba(223,244,235,0.82)] text-[var(--primary)]",
    "bg-[rgba(255,225,214,0.84)] text-[var(--accent)]",
    "bg-[rgba(220,239,250,0.9)] text-[var(--color-blue)]",
    "bg-[rgba(255,239,199,0.92)] text-[#bd7600]",
  ];

  return (
    <div className="shell px-4 pb-12 pt-9 sm:px-6 sm:pb-16 sm:pt-12 lg:pt-10">
      <section className="grid items-center gap-9 lg:grid-cols-[minmax(0,1.42fr)_minmax(20rem,0.88fr)] lg:gap-14">
        <div className="min-w-0 py-1 lg:py-6">
          <h1 className="max-w-[42rem] font-serif text-[clamp(2.55rem,6.25vw,4.7rem)] leading-[0.94] tracking-[-0.045em] text-[var(--foreground)]">
            <span className="block">{locale === "it" ? "Guadagna con" : "Earn with"}</span>
            <span className="block text-[var(--primary)]">Salento Local</span>
          </h1>
          <p className="mt-5 max-w-[40rem] text-[1.08rem] leading-[1.55] text-[var(--foreground)] sm:mt-6 sm:text-[1.25rem]">
            {copy.hero.split("€50")[0]}<strong className="font-bold text-[var(--primary)]">€50</strong>{copy.hero.split("€50")[1]}
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:items-center sm:gap-6">
            <HardNavigationLink href={partnerJoinHref} className="btn-primary min-h-12 px-6 text-base shadow-[0_12px_25px_rgba(42,98,87,0.16)] sm:w-auto">
              {copy.cta}<IconArrowRight size={20} aria-hidden="true" />
            </HardNavigationLink>
            <HardNavigationLink href={partnerLoginHref} className="min-h-11 self-start rounded-lg py-2 text-sm font-medium text-[var(--foreground)] underline decoration-[var(--primary)]/60 underline-offset-4 transition hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(42,98,87,0.32)]">
              {copy.already}
            </HardNavigationLink>
          </div>
        </div>

        <aside className="rounded-[1.35rem] bg-[linear-gradient(135deg,rgba(231,245,238,0.9),rgba(245,248,245,0.86))] p-6 sm:p-8 lg:p-9">
          <span className="flex h-[5rem] w-[5rem] items-center justify-center rounded-full bg-[rgba(208,237,225,0.8)] text-[var(--primary)]">
            <IconSchool size={43} stroke={1.75} aria-hidden="true" />
          </span>
          <div className="mt-5 h-px w-12 bg-[var(--primary)]" />
          <h2 className="mt-5 max-w-[16rem] font-serif text-[1.75rem] leading-[1.05] tracking-[-0.025em] text-[var(--foreground)] sm:text-[2rem]">
            {copy.studentTitle}
          </h2>
          <ul className="mt-7 grid gap-4" role="list">
            {copy.studentBenefits.map((benefit) => (
              <li key={benefit} className="flex items-center gap-3 text-[0.98rem] text-[var(--foreground)]">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(208,237,225,0.74)] text-[var(--primary)]">
                  <IconCheck size={16} stroke={2.5} aria-hidden="true" />
                </span>
                {benefit}
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="pt-16 sm:pt-20" aria-labelledby="how-it-works-heading">
        <p className="section-kicker">{copy.howEyebrow}</p>
        <h2 id="how-it-works-heading" className="mt-3 font-serif text-[clamp(2.25rem,4.2vw,3.25rem)] leading-none tracking-[-0.035em] text-[var(--foreground)]">
          {copy.howTitle}
        </h2>
        <p className="mt-2 max-w-3xl text-[1rem] leading-7 text-[var(--muted)] sm:text-[1.08rem]">{copy.howBody}</p>

        <ol className="mt-7 grid gap-11 md:grid-cols-4 md:gap-4" role="list">
          {copy.steps.map(([title, body], index) => {
            const Icon = stepIcons[index];
            return (
              <li key={title} className="relative min-w-0">
                <article className="card h-full rounded-[1.15rem] p-5 shadow-[0_11px_26px_rgba(36,50,58,0.045)] sm:p-6">
                  <span className={`flex h-16 w-16 items-center justify-center rounded-full ${stepIconStyles[index]}`}>
                    <Icon size={31} stroke={1.85} aria-hidden="true" />
                  </span>
                  <p className="mt-5 text-sm font-bold tracking-[0.08em] text-[var(--primary)]">0{index + 1}</p>
                  <h3 className="mt-2 font-serif text-[1.5rem] leading-[1.05] tracking-[-0.025em] text-[var(--foreground)]">{title}</h3>
                  <p className="mt-3 text-[0.92rem] leading-[1.45] text-[var(--muted)]">{body}</p>
                </article>
                {index < copy.steps.length - 1 ? <>
                  <IconArrowRight className="pointer-events-none absolute -right-[1.05rem] top-1/2 hidden -translate-y-1/2 text-[var(--color-blue-deep)] md:block" size={27} stroke={1.6} aria-hidden="true" />
                  <IconArrowDown className="pointer-events-none absolute bottom-[-2rem] left-1/2 -translate-x-1/2 text-[var(--color-blue-deep)] md:hidden" size={25} stroke={1.6} aria-hidden="true" />
                </> : null}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mt-5 grid gap-6 rounded-[1.2rem] bg-[linear-gradient(90deg,rgba(232,245,239,0.82),rgba(236,247,242,0.66))] p-6 sm:mt-6 sm:p-7 lg:grid-cols-[minmax(15rem,1.1fr)_minmax(25rem,1.55fr)_minmax(13rem,0.82fr)] lg:items-center lg:gap-7" aria-labelledby="earnings-heading">
        <div>
          <h2 id="earnings-heading" className="font-serif text-[1.75rem] leading-[1.05] tracking-[-0.025em] text-[var(--foreground)]">{copy.earningsTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{copy.earningsBody}</p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-4">
          <div className="min-w-0 rounded-xl bg-white/90 px-3 py-4 text-center shadow-[0_8px_16px_rgba(36,50,58,0.035)]">
            <IconBuildingStore className="mx-auto text-[var(--primary)]" size={28} stroke={1.9} aria-hidden="true" />
            <p className="mt-1 font-serif text-[1.6rem] leading-none text-[var(--primary)]">€100</p>
            <p className="mt-1 text-xs leading-4 text-[var(--muted)]">{copy.businessFirstYear}</p>
          </div>
          <IconArrowRight className="hidden text-[var(--color-blue-deep)] sm:block" size={28} stroke={1.6} aria-hidden="true" />
          <IconArrowDown className="self-center text-[var(--color-blue-deep)] sm:hidden" size={24} stroke={1.6} aria-hidden="true" />
          <div className="min-w-0 rounded-xl bg-white/90 px-3 py-4 text-center shadow-[0_8px_16px_rgba(36,50,58,0.035)]">
            <IconCoins className="mx-auto text-[var(--accent)]" size={28} stroke={1.9} aria-hidden="true" />
            <p className="mt-1 font-serif text-[1.6rem] leading-none text-[var(--accent)]">€50</p>
            <p className="mt-1 text-xs leading-4 text-[var(--muted)]">{copy.yourCommission}</p>
          </div>
        </div>
        <p className="border-t border-[rgba(42,98,87,0.18)] pt-4 text-sm leading-6 text-[var(--foreground)] lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">{copy.directPayment}</p>
      </section>

      <section className="pt-16 sm:pt-20" aria-labelledby="support-heading">
        <p className="section-kicker">{copy.benefitsEyebrow}</p>
        <h2 id="support-heading" className="mt-3 font-serif text-[clamp(2.25rem,4.2vw,3.25rem)] leading-none tracking-[-0.035em] text-[var(--foreground)]">
          {copy.benefitsTitle}
        </h2>
        <p className="mt-2 max-w-3xl text-[1rem] leading-7 text-[var(--muted)] sm:text-[1.08rem]">{copy.benefitsIntro}</p>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {copy.benefits.map(([title, body], index) => {
            const Icon = benefitIcons[index];
            const iconStyle = index === 1 ? "bg-[rgba(255,225,214,0.84)] text-[var(--accent)]" : index === 2 ? "bg-[rgba(220,239,250,0.9)] text-[var(--color-blue)]" : "bg-[rgba(223,244,235,0.82)] text-[var(--primary)]";
            return <article key={title} className="card rounded-[1.15rem] p-6 shadow-[0_11px_26px_rgba(36,50,58,0.045)]">
              <span className={`flex h-14 w-14 items-center justify-center rounded-full ${iconStyle}`}><Icon size={27} stroke={1.85} aria-hidden="true" /></span>
              <h3 className="mt-5 font-serif text-[1.5rem] leading-[1.05] tracking-[-0.025em] text-[var(--foreground)]">{title}</h3>
              <p className="mt-3 text-[0.92rem] leading-[1.5] text-[var(--muted)]">{body}</p>
            </article>;
          })}
        </div>
      </section>

      <section className="mt-8 grid gap-5 rounded-[1.2rem] bg-[linear-gradient(90deg,rgba(232,245,239,0.9),rgba(236,247,242,0.72))] p-6 sm:mt-10 sm:p-7 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-6" aria-label={copy.finalTitle}>
        <span className="flex h-14 w-14 items-center justify-center rounded-full text-[var(--primary)]"><IconPlant2 size={40} stroke={1.75} aria-hidden="true" /></span>
        <div>
          <h2 className="font-serif text-[1.8rem] leading-none tracking-[-0.025em] text-[var(--foreground)]">{copy.finalTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{copy.finalBody}</p>
        </div>
        <div className="flex flex-col items-stretch gap-3 lg:items-end">
          <HardNavigationLink href={partnerJoinHref} className="btn-primary min-h-12 px-6 text-base shadow-[0_12px_25px_rgba(42,98,87,0.14)]">
            {copy.cta}<IconArrowRight size={20} aria-hidden="true" />
          </HardNavigationLink>
          <HardNavigationLink href={partnerLoginHref} className="rounded-lg px-1 py-1 text-center text-sm font-medium text-[var(--foreground)] underline decoration-[var(--primary)]/60 underline-offset-4 transition hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(42,98,87,0.32)]">
            {copy.already}
          </HardNavigationLink>
        </div>
      </section>
    </div>
  );
}
