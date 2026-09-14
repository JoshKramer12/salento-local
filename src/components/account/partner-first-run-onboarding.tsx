"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconArrowLeft, IconArrowRight, IconBulb, IconBrowser, IconCheck, IconConfetti,
  IconCreditCard, IconCurrencyEuro, IconEye, IconFileText, IconPlus, IconSettings,
  IconUsersGroup, type TablerIcon,
} from "@tabler/icons-react";

import { completePartnerFirstRunOnboardingAction } from "@/app/(account)/actions";
import { getNextPartnerFirstRunStep, getPreviousPartnerFirstRunStep, type PartnerFirstRunStep } from "@/lib/partner-first-run-navigation";
import type { Locale } from "@/lib/i18n";

import styles from "./partner-first-run-onboarding.module.css";

type Color = "blue" | "green" | "orange" | "yellow";
type Item = { body: React.ReactNode; color: Color; icon: TablerIcon; title: string };
type Conversation = { body: React.ReactNode; hint: string; title: string };
type Copy = {
  back: string; benefitCallout: string; benefits: Item[]; businessIntro: string; businessTitle: React.ReactNode;
  conversation: Conversation[]; conversationIntro: string; conversationTitle: string; done: string; guideDone: string; guideLabel: string;
  howFlow: Item[]; howIntro: string; howTitle: React.ReactNode; next: string; nextCallout: string; nextCalloutBody: string;
  nextIntro: string; nextSteps: Item[]; nextTitle: React.ReactNode; partner: string; progress: [string, string, string, string];
  step: string; tip: string; tipBody: string; you: string;
};

const copyByLocale: Record<Locale, Copy> = {
  en: {
    back: "Back",
    benefits: [
      { title: "Their own mini website", body: "A professional page for their business on an established site — no need to build or promote a website themselves.", color: "green", icon: IconBrowser },
      { title: "More visibility", body: "They can be found by tourists and locals who are exploring Salento and looking for places to eat, stay, shop and more.", color: "orange", icon: IconUsersGroup },
      { title: "€100 for the first year", body: <>Then just €50 per year to renew. That’s <strong>less than €2 per week</strong> for great exposure.</>, color: "yellow", icon: IconCurrencyEuro },
      { title: "A complete page", body: "Their photos, opening hours, contact details, directions and key information — all in one place. You help set it up, and they review everything before paying.", color: "blue", icon: IconSettings },
    ],
    benefitCallout: "A small investment. A bigger presence in Salento.",
    businessIntro: "For €100, they get a professional business page on Salento Local — a trusted local guide that helps people discover the best places in Salento.",
    businessTitle: <>What are business<br/><span>owners paying for?</span></>,
    conversation: [
      { title: "Start with a simple hello.", hint: "Ask for the owner or manager.", body: <>Hi! I’m working with Salento Local. We help local businesses get discovered in Salento. Could I quickly show you how it works?</> },
      { title: "Explain what it is.", hint: "If they’re interested, give a quick summary.", body: <>It’s a mini website page for your business on Salento Local. It includes your photos, opening hours, contact details and directions — all in one place.</> },
      { title: "Mention the price.", hint: "Be clear and simple.", body: <>The first year is <strong>€100</strong>, then <strong>€50</strong> per year to renew. That’s <strong>less than €2 per week.</strong></> },
      { title: "Make it easy.", hint: "Reassure them.", body: <>If you’d like, I can prepare the page with you. You’ll review everything before deciding and paying.</> },
    ],
    conversationIntro: "Here’s a simple conversation you can use. Keep it natural and friendly.", conversationTitle: "What to say.", done: "I’m ready", guideDone: "Back to dashboard", guideLabel: "Partner guide",
    howFlow: [
      { title: "Find a business", body: "Talk to the owner or manager.", color: "green", icon: IconBrowser },
      { title: "Create their page", body: "We guide you step by step.", color: "orange", icon: IconFileText },
      { title: "Owner approves & pays", body: "They pay €100 for the first year directly to Salento Local.", color: "yellow", icon: IconCreditCard },
      { title: "You earn €50", body: "Your commission appears in your account.", color: "blue", icon: IconConfetti },
    ],
    howIntro: "Help a local business join Salento Local. We’ll guide you through everything else.", howTitle: <>Find a business.<br/><span>Earn €50.</span></>, next: "Next",
    nextCallout: "You don’t need to remember everything.", nextCalloutBody: "The form will guide you, and you can always come back to this tutorial from your dashboard.",
    nextIntro: "Great! Here’s what to do next. We’ll guide you step by step.",
    nextSteps: [
      { title: "Tap Add Business", body: "Start a new submission in your account.", color: "green", icon: IconPlus },
      { title: "Follow the steps", body: "Add the business details, photos, hours and owner information.", color: "orange", icon: IconFileText },
      { title: "Owner reviews", body: "The owner checks everything and confirms their page is correct.", color: "blue", icon: IconEye },
      { title: "They pay directly", body: "The owner pays €100 for the first year (then €50 per year) directly to Salento Local.", color: "yellow", icon: IconCreditCard },
      { title: "You earn €50", body: "After the business is published, your €50 commission appears in your account.", color: "green", icon: IconConfetti },
    ],
    nextTitle: <>They’re interested.<br/><span>Now what?</span></>, partner: "LOCAL PARTNER", progress: ["How it works", "What businesses get", "What to say", "Next steps"], step: "STEP",
    tip: "Tip: Be yourself.", tipBody: "Keep it friendly, clear and short. Most business owners are happy to learn more.", you: "You",
  },
  it: {
    back: "Indietro",
    benefits: [
      { title: "Il loro mini sito", body: "Una pagina professionale per la loro attività su un sito già affermato — senza dover creare o promuovere un sito da soli.", color: "green", icon: IconBrowser },
      { title: "Più visibilità", body: "Possono farsi trovare da turisti e persone del posto che esplorano il Salento e cercano dove mangiare, dormire, fare acquisti e molto altro.", color: "orange", icon: IconUsersGroup },
      { title: "€100 per il primo anno", body: <>Poi solo €50 all’anno per rinnovare. <strong>Meno di €2 a settimana</strong> per una grande visibilità.</>, color: "yellow", icon: IconCurrencyEuro },
      { title: "Una pagina completa", body: "Foto, orari di apertura, contatti, indicazioni e informazioni importanti — tutto in un unico posto. Tu aiuti a prepararla e loro controllano tutto prima di pagare.", color: "blue", icon: IconSettings },
    ],
    benefitCallout: "Un piccolo investimento. Una presenza più grande nel Salento.",
    businessIntro: "Con €100 ottengono una pagina professionale su Salento Local — una guida locale affidabile che aiuta le persone a scoprire i posti migliori del Salento.",
    businessTitle: <>Per cosa pagano i titolari<br/><span>delle attività?</span></>,
    conversation: [
      { title: "Inizia con un semplice ciao.", hint: "Chiedi del titolare o del responsabile.", body: <>Ciao! Collaboro con Salento Local. Aiutiamo le attività locali a farsi trovare nel Salento. Posso mostrarti velocemente come funziona?</> },
      { title: "Spiega di cosa si tratta.", hint: "Se sono interessati, fai un breve riassunto.", body: <>È una pagina web per la tua attività su Salento Local. Include foto, orari di apertura, contatti e indicazioni — tutto in un unico posto.</> },
      { title: "Parla del prezzo.", hint: "Sii chiaro e semplice.", body: <>Il primo anno costa <strong>€100</strong>, poi <strong>€50</strong> all’anno per rinnovare. Sono <strong>meno di €2 a settimana.</strong></> },
      { title: "Rendi tutto semplice.", hint: "Rassicurali.", body: <>Se vuoi, posso preparare la pagina insieme a te. Potrai controllare tutto prima di decidere e pagare.</> },
    ],
    conversationIntro: "Ecco una semplice conversazione che puoi usare. Mantienila naturale e amichevole.", conversationTitle: "Cosa dire.", done: "Sono pronto", guideDone: "Torna al dashboard", guideLabel: "Guida Partner",
    howFlow: [
      { title: "Trova un’attività", body: "Parla con il titolare o il responsabile.", color: "green", icon: IconBrowser },
      { title: "Crea la loro pagina", body: "Ti guidiamo passo dopo passo.", color: "orange", icon: IconFileText },
      { title: "Il titolare approva e paga", body: "Paga €100 per il primo anno direttamente a Salento Local.", color: "yellow", icon: IconCreditCard },
      { title: "Tu guadagni €50", body: "La commissione appare nel tuo account.", color: "blue", icon: IconConfetti },
    ],
    howIntro: "Aiuta un’attività locale a entrare in Salento Local. Ti guidiamo noi in tutto il resto.", howTitle: <>Trova un’attività.<br/><span>Guadagna €50.</span></>, next: "Avanti",
    nextCallout: "Non devi ricordare tutto.", nextCalloutBody: "Il modulo ti guiderà e potrai sempre tornare a questo tutorial dal dashboard.",
    nextIntro: "Ottimo! Ecco cosa fare dopo. Ti guideremo passo dopo passo.",
    nextSteps: [
      { title: "Tocca Aggiungi attività", body: "Avvia una nuova segnalazione dal tuo account.", color: "green", icon: IconPlus },
      { title: "Segui i passaggi", body: "Aggiungi i dettagli dell’attività, foto, orari e informazioni sul titolare.", color: "orange", icon: IconFileText },
      { title: "Il titolare controlla", body: "Il titolare verifica tutto e conferma che la pagina sia corretta.", color: "blue", icon: IconEye },
      { title: "Paga direttamente", body: "Il titolare paga €100 per il primo anno (poi €50 all’anno) direttamente a Salento Local.", color: "yellow", icon: IconCreditCard },
      { title: "Tu guadagni €50", body: "Dopo la pubblicazione dell’attività, la commissione di €50 appare nel tuo account.", color: "green", icon: IconConfetti },
    ],
    nextTitle: <>Sono interessati.<br/><span>E adesso?</span></>, partner: "PARTNER LOCALE", progress: ["Come funziona", "Cosa ottengono le attività", "Cosa dire", "Prossimi passi"], step: "PASSAGGIO",
    tip: "Consiglio: sii te stesso.", tipBody: "Sii amichevole, chiaro e breve. Molti titolari sono felici di saperne di più.", you: "Tu",
  },
};

function Progress({ copy, screen }: { copy: Copy; screen: PartnerFirstRunStep }) {
  return <ol className={styles.progress} aria-label={`${copy.partner}: ${copy.step} ${screen} ${copy.step === "PASSAGGIO" ? "di" : "of"} 4`}>
    {copy.progress.map((label, index) => {
      const step = (index + 1) as PartnerFirstRunStep;
      const state = step < screen ? "complete" : step === screen ? "current" : "future";
      return <li className={styles[`progress${state[0].toUpperCase()}${state.slice(1)}`]} key={label} aria-current={step === screen ? "step" : undefined}>
        <span className={styles.progressDot}>{step < screen ? <IconCheck size={18} stroke={2.8} /> : step}</span><span className={styles.progressLabel}>{label}</span>
      </li>;
    })}
  </ol>;
}

function FlowCards({ items, screen }: { items: Item[]; screen: 1 | 4 }) {
  return <div className={screen === 1 ? styles.howFlow : styles.nextFlow}>{items.map(({ body, color, icon: Icon, title }, index) => <div className={styles.flowItem} key={title}>
    <article className={`${styles.flowCard} ${screen === 4 && index === 4 ? styles.flowFinal : ""}`}>
      {screen === 4 ? <span className={`${styles.number} ${styles[color]}`}>{index + 1}</span> : null}
      <span className={`${styles.icon} ${styles[color]}`}><Icon aria-hidden="true" size={screen === 1 ? 31 : 34} stroke={1.8}/></span><h2>{title}</h2><p>{body}</p>
    </article>{index < items.length - 1 ? <span className={styles.flowArrow} aria-hidden="true"><i/><IconArrowRight size={22}/></span> : null}
  </div>)}</div>;
}

export function PartnerFirstRunOnboarding({ isGuide = false, locale }: { isGuide?: boolean; locale: Locale }) {
  const [screen, setScreen] = useState<PartnerFirstRunStep>(1);
  const copy = useMemo(() => copyByLocale[locale], [locale]);
  const previous = getPreviousPartnerFirstRunStep(screen);
  const following = getNextPartnerFirstRunStep(screen);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => window.scrollTo({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", top: 0 }));
    return () => window.cancelAnimationFrame(frameId);
  }, [screen]);

  const nextLabel = screen === 1 ? `${copy.next}: ${copy.progress[1]}` : screen === 2 ? `${copy.next}: ${copy.progress[2]}` : screen === 3 ? `${copy.next}: ${locale === "it" ? "Sono interessati" : "They said yes"}` : copy.done;
  return <div className={styles.app}><section className={styles.surface} aria-label={copy.guideLabel}>
    <div className={styles.meta}><div><p>{copy.partner}</p><span>{copy.step} {screen} {locale === "it" ? "DI" : "OF"} 4</span></div><Progress copy={copy} screen={screen}/></div>
    <div className={styles.content}>
      {screen === 1 ? <><h1>{copy.howTitle}</h1><p className={styles.intro}>{copy.howIntro}</p><FlowCards items={copy.howFlow} screen={1}/><div className={styles.reassurance}><IconCheck aria-hidden="true" size={19}/><p>{locale === "it" ? "Non riscuoti mai personalmente il pagamento." : "You never collect payment yourself."}</p></div></> : null}
      {screen === 2 ? <><h1>{copy.businessTitle}</h1><p className={styles.intro}>{copy.businessIntro}</p><div className={styles.benefits}>{copy.benefits.map(({ body, color, icon: Icon, title }) => <article className={styles.benefit} key={title}><span className={`${styles.icon} ${styles[color]}`}><Icon aria-hidden="true" size={33} stroke={1.8}/></span><h2>{title}</h2><p>{body}</p></article>)}</div><aside className={styles.callout}><IconBulb aria-hidden="true" size={28}/><p>{copy.benefitCallout}</p></aside></> : null}
      {screen === 3 ? <><h1>{copy.conversationTitle}</h1><p className={styles.intro}>{copy.conversationIntro}</p><div className={styles.conversations}>{copy.conversation.map(({ body, hint, title }, index) => <article className={styles.conversation} key={title}><div className={styles.conversationHead}><span>{index + 1}</span><div><h2>{title}</h2><p>{hint}</p></div></div><div className={styles.speech}><span className={styles.person}><IconUsersGroup aria-hidden="true" size={20}/></span><div><b>{copy.you}</b><p>{body}</p></div></div></article>)}</div><aside className={styles.callout}><IconBulb aria-hidden="true" size={28}/><div><strong>{copy.tip}</strong><p>{copy.tipBody}</p></div></aside></> : null}
      {screen === 4 ? <><h1>{copy.nextTitle}</h1><p className={styles.intro}>{copy.nextIntro}</p><FlowCards items={copy.nextSteps} screen={4}/><aside className={styles.callout}><IconBulb aria-hidden="true" size={28}/><div><strong>{copy.nextCallout}</strong><p>{copy.nextCalloutBody}</p></div></aside></> : null}
      <nav className={styles.navigation} aria-label={locale === "it" ? "Navigazione del tutorial" : "Tutorial navigation"}>
        {previous ? <button className={styles.back} type="button" onClick={() => setScreen(previous)}><IconArrowLeft size={18}/>{copy.back}</button> : <span/>}
        {following ? <button className={styles.next} type="button" onClick={() => setScreen(following)}>{nextLabel}<IconArrowRight size={19}/></button> : isGuide ? <a className={styles.next} href="/dashboard">{copy.guideDone}<IconArrowRight size={19}/></a> : <form action={completePartnerFirstRunOnboardingAction}><button className={styles.next} type="submit">{nextLabel}<IconArrowRight size={19}/></button></form>}
      </nav>
    </div>
  </section></div>;
}
