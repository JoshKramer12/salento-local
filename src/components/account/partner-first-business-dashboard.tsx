import {
  IconArrowDown,
  IconArrowRight,
  IconBook2,
  IconBuildingStore,
  IconCoins,
  IconFileText,
  IconMessageCircle,
  IconPlant2,
} from "@tabler/icons-react";

import { DashboardNav } from "@/components/account/dashboard-nav";
import { PartnerWorkspaceNav } from "@/components/account/partner-workspace-nav";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import type { Locale } from "@/lib/i18n";

import styles from "./partner-first-business-dashboard.module.css";

type Props = {
  locale: Locale;
  username: string;
};

type Copy = {
  activity: string;
  activityBody: string;
  addFirst: string;
  addFirstLong: string;
  addStep: string;
  addStepBody: string;
  commission: string;
  firstYear: string;
  guide: string;
  guidePrompt: string;
  heroBody: string;
  howItWorks: string;
  localPartner: string;
  noBusinesses: string;
  paymentNote: string;
  ready: string;
  startHere: string;
  startSteps: string;
  startTitle: string;
  stepFind: string;
  stepFindBody: string;
  stepTalk: string;
  stepTalkBody: string;
  welcome: string;
  welcomeBody: string;
  welcomePrompt: string;
  welcomeTitle: string;
  opportunityTitle: string;
};

const copyByLocale: Record<Locale, Copy> = {
  en: {
    activity: "YOUR ACTIVITY",
    activityBody: "Your submissions, earnings and progress will appear here after you add your first business.",
    addFirst: "+ Add my first business",
    addFirstLong: "+ Add my first business",
    addStep: "Add their business",
    addStepBody: "Tap the button and we’ll guide you through everything from there.",
    commission: "Your commission",
    firstYear: "Business annual membership",
    guide: "View Partner Guide",
    guidePrompt: "Need a refresher?",
    heroBody: "Find local businesses, create their page, and earn €50 when they successfully join, plus €15 on each successful annual renewal.",
    howItWorks: "HOW IT WORKS",
    localPartner: "LOCAL PARTNER",
    noBusinesses: "No businesses yet.",
    paymentNote: "The business pays Salento Local directly. You never collect their payment yourself.",
    ready: "Ready to get started?",
    startHere: "START HERE",
    startSteps: "It’s simple — just follow these steps.",
    startTitle: "Find your first business",
    stepFind: "Find a local business",
    stepFindBody: "Speak with restaurants, bars, shops, B&Bs and other local businesses.",
    stepTalk: "Talk to the owner",
    stepTalkBody: "Explain Salento Local using the simple conversation from our Partner Guide.",
    welcome: "Welcome",
    welcomeBody: "You’re now part of a community of local people helping Salento’s businesses get discovered.",
    welcomePrompt: "Ready to earn your first €50?",
    welcomeTitle: "Good to have you here!",
    opportunityTitle: "A great opportunity for you and local businesses.",
  },
  it: {
    activity: "LA TUA ATTIVITÀ",
    activityBody: "Le tue segnalazioni, i guadagni e i progressi appariranno qui dopo aver aggiunto la tua prima attività.",
    addFirst: "+ Aggiungi la mia prima attività",
    addFirstLong: "+ Aggiungi la mia prima attività",
    addStep: "Aggiungi la loro attività",
    addStepBody: "Tocca il pulsante e ti guideremo in tutto il resto.",
    commission: "La tua commissione",
    firstYear: "Membership annuale dell’attività",
    guide: "Rivedi la guida Partner",
    guidePrompt: "Vuoi rivedere come funziona?",
    heroBody: "Trova attività locali, crea la loro pagina e guadagna €50 quando entrano con successo, più €15 a ogni rinnovo annuale riuscito.",
    howItWorks: "COME FUNZIONA",
    localPartner: "PARTNER LOCALE",
    noBusinesses: "Ancora nessuna attività.",
    paymentNote: "L’attività paga direttamente Salento Local. Tu non incassi mai personalmente il pagamento.",
    ready: "Pronto per iniziare?",
    startHere: "INIZIA QUI",
    startSteps: "È semplice — segui questi passaggi.",
    startTitle: "Trova la tua prima attività",
    stepFind: "Trova un’attività locale",
    stepFindBody: "Parla con ristoranti, bar, negozi, B&B e altre attività locali.",
    stepTalk: "Parla con il titolare",
    stepTalkBody: "Spiega Salento Local usando la semplice conversazione della Guida Partner.",
    welcome: "Benvenuto",
    welcomeBody: "Ora fai parte di una comunità di persone del posto che aiutano le attività del Salento a farsi scoprire.",
    welcomePrompt: "Pronto a guadagnare i tuoi primi €50?",
    welcomeTitle: "Che bello averti qui!",
    opportunityTitle: "Una grande opportunità per te e per le attività locali.",
  },
};

export function PartnerFirstBusinessDashboard({ locale, username }: Props) {
  const copy = copyByLocale[locale];
  const firstName = username.trim().split(/\s+/)[0] || username;

  return (
    <div className={styles.page}>
      <PartnerWorkspaceNav active="dashboard" locale={locale} />
      <div className="dashboard-nav-shell shell px-4 pt-12 sm:px-6">
        <DashboardNav active="dashboard" draftCount={0} locale={locale} role="GETTER" />
      </div>
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>{copy.localPartner}</span>
            <h1>{copy.welcome}, {firstName}.</h1>
            <h2>{copy.welcomePrompt}</h2>
            <p>{copy.heroBody}</p>
          </div>
          <aside className={styles.welcomeCard}>
            <IconPlant2 aria-hidden="true" size={43} stroke={1.7} />
            <div>
              <h2>{copy.welcomeTitle}</h2>
              <p>{copy.welcomeBody}</p>
            </div>
          </aside>
        </section>

        <section className={styles.startCard}>
          <div className={styles.startContent}>
            <span className={styles.pill}>{copy.startHere}</span>
            <h2>{copy.startTitle}</h2>
            <p className={styles.startIntro}>{copy.startSteps}</p>
            <div className={styles.steps}>
              <Step color="green" description={copy.stepFindBody} icon={IconBuildingStore} number="1" title={copy.stepFind} />
              <Arrow />
              <Step color="orange" description={copy.stepTalkBody} icon={IconMessageCircle} number="2" title={copy.stepTalk} />
              <Arrow />
              <Step color="blue" description={copy.addStepBody} icon={IconFileText} number="3" title={copy.addStep} />
            </div>
          </div>
          <div className={styles.startActions}>
            <HardNavigationLink className={styles.primaryAction} href="/publish">
              {copy.addFirst}<IconArrowRight aria-hidden="true" size={20} stroke={2.2} />
            </HardNavigationLink>
            <div className={styles.guideLink}>
              <IconBook2 aria-hidden="true" size={28} stroke={1.8} />
              <div>
                <span>{copy.guidePrompt}</span>
                <HardNavigationLink href="/partner/onboarding?guide=1">
                  {copy.guide}<IconArrowRight aria-hidden="true" size={16} stroke={2.2} />
                </HardNavigationLink>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.opportunity}>
          <div className={styles.opportunityIntro}>
            <span className={styles.eyebrow}>{copy.howItWorks}</span>
            <h2>{copy.opportunityTitle}</h2>
          </div>
          <div className={styles.moneyFlow}>
            <MoneyCard color="green" icon={IconBuildingStore} label={copy.firstYear} value="€100" />
            <FlowArrow />
            <MoneyCard color="orange" icon={IconCoins} label={copy.commission} value="€50" />
          </div>
          <p className={styles.paymentNote}>{copy.paymentNote}</p>
        </section>

        <section className={styles.activity}>
          <div>
            <span className={styles.pill}>{copy.activity}</span>
            <h2>{copy.noBusinesses}</h2>
            <p>{copy.activityBody}</p>
          </div>
          <div className={styles.activityAction}>
            <IconBuildingStore aria-hidden="true" size={44} stroke={1.6} />
            <span>{copy.ready}</span>
            <HardNavigationLink className={styles.primaryAction} href="/publish">
              {copy.addFirstLong}
            </HardNavigationLink>
          </div>
        </section>
      </main>
    </div>
  );
}

function Step({
  color,
  description,
  icon: Icon,
  number,
  title,
}: {
  color: "blue" | "green" | "orange";
  description: string;
  icon: typeof IconBuildingStore;
  number: string;
  title: string;
}) {
  return (
    <article className={styles.step}>
      <div className={styles.stepVisual}>
        <span className={`${styles.number} ${styles[color]}`}>{number}</span>
        <span className={`${styles.stepIcon} ${styles[color]}`}><Icon aria-hidden="true" size={29} stroke={1.8} /></span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

function Arrow() {
  return <span className={styles.stepArrow} aria-hidden="true"><IconArrowRight size={29} stroke={1.65} /></span>;
}

function FlowArrow() {
  return <span className={styles.moneyArrow} aria-hidden="true"><IconArrowRight className={styles.desktopArrow} size={29} stroke={1.65} /><IconArrowDown className={styles.mobileArrow} size={26} stroke={1.65} /></span>;
}

function MoneyCard({
  color,
  icon: Icon,
  label,
  value,
}: {
  color: "green" | "orange";
  icon: typeof IconBuildingStore;
  label: string;
  value: string;
}) {
  return <article className={styles.moneyCard}><span className={`${styles.moneyIcon} ${styles[color]}`}><Icon aria-hidden="true" size={28} stroke={1.85} /></span><strong className={styles[color]}>{value}</strong><span>{label}</span></article>;
}
