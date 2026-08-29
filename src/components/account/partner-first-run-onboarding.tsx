"use client";

import { useEffect, useState } from "react";

import { completePartnerFirstRunOnboardingAction } from "@/app/(account)/actions";
import type { Locale } from "@/lib/i18n";

import styles from "./partner-first-run-onboarding.module.css";

type Copy = { first: string; then: string; owner: string; thatsIt: string; partner: string; titleStart: string; titleEnd: string; intro: string; find: string; findBody: string; create: string; createBody: string; approves: string; approvesBody: string; earn: string; earnBody: string; neverCollect: string; showHow: string; firstBusiness: string; helloStart: string; helloEnd: string; helloIntro: string; script: string; interested: string; guide: string; ready: string; back: string };

const copyByLocale: Record<Locale, Copy> = {
  en: { first: "FIRST", then: "THEN", owner: "THE OWNER", thatsIt: "THAT'S IT", partner: "LOCAL PARTNER", titleStart: "Find a business.", titleEnd: "Earn €50.", intro: "Help a local business join Salento Local. We’ll guide you through everything else.", find: "Find a business", findBody: "Talk to the owner or manager.", create: "Create their page", createBody: "We guide you step by step.", approves: "Approves & pays", approvesBody: "Payment goes straight to Salento Local.", earn: "You earn €50", earnBody: "Your commission appears in your account.", neverCollect: "You never collect payment yourself.", showHow: "Show me how", firstBusiness: "YOUR FIRST BUSINESS", helloStart: "Start with", helloEnd: "a simple hello.", helloIntro: "Ask for the owner or manager. That’s all you need to remember.", script: "Hi! I’m working with Salento Local. We help people discover local businesses around Salento. Could I quickly show you how it works?", interested: "If they’re interested, start their page.", guide: "Salento Local will guide you through what to ask, the photos, approval and payment.", ready: "I’m ready", back: "Back" },
  it: { first: "PRIMA", then: "POI", owner: "IL TITOLARE", thatsIt: "TUTTO QUI", partner: "LOCAL PARTNER", titleStart: "Trova un'attività.", titleEnd: "Guadagna €50.", intro: "Aiuta un'attività locale a entrare in Salento Local. Ti guidiamo noi in tutto il resto.", find: "Trova un'attività", findBody: "Parla con il titolare o responsabile.", create: "Crea la loro pagina", createBody: "Ti guidiamo passo dopo passo.", approves: "Approva e paga", approvesBody: "Il pagamento va direttamente a Salento Local.", earn: "Tu guadagni €50", earnBody: "La commissione appare nel tuo account.", neverCollect: "Non raccogli mai il pagamento di persona.", showHow: "Fammi vedere come", firstBusiness: "LA TUA PRIMA ATTIVITÀ", helloStart: "Inizia con", helloEnd: "un semplice ciao.", helloIntro: "Chiedi del titolare o responsabile. È tutto quello che devi ricordare.", script: "Ciao! Collaboro con Salento Local. Aiutiamo le persone a scoprire le attività del Salento. Posso mostrarti velocemente come funziona?", interested: "Se sono interessati, iniziate la loro pagina.", guide: "Salento Local ti guiderà su cosa chiedere, le foto, l'approvazione e il pagamento.", ready: "Sono pronto", back: "Indietro" },
};

function Storefront() { return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 28h38v25H13z"/><path d="M10 28l5-14h34l5 14"/><path d="M20 28v25M44 28v25"/><path d="M26 53V38h12v15"/><path d="M10 28c0 5 8 5 8 0 0 5 8 5 8 0 0 5 8 5 8 0 0 5 8 5 8 0 0 5 8 5 8 0"/></svg>; }
function Phone() { return <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="18" y="8" width="28" height="48" rx="5"/><path d="M25 19h14M25 27h14M25 35h8"/><circle cx="32" cy="48" r="1.5"/><path d="M49 18v12M43 24h12"/></svg>; }
function Owner() { return <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="26" cy="22" r="9"/><path d="M10 50c2-10 8-15 16-15s14 5 16 15"/><circle cx="46" cy="39" r="12"/><path d="M40 39l4 4 8-9"/></svg>; }
function Arrow() { return <div className={styles.arrow} aria-hidden="true"><span/><b>→</b></div>; }

export function PartnerFirstRunOnboarding({ locale }: { locale: Locale }) {
  const [screen, setScreen] = useState<1 | 2>(1);
  const copy = copyByLocale[locale];

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo({ behavior: "smooth", top: 0 });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [screen]);

  const steps = [
    [copy.first, copy.find, copy.findBody, <Storefront key="store"/>],
    [copy.then, copy.create, copy.createBody, <Phone key="phone"/>],
    [copy.owner, copy.approves, copy.approvesBody, <Owner key="owner"/>],
    [copy.thatsIt, copy.earn, copy.earnBody, <span className={styles.money} key="money">€50</span>],
  ] as const;

  return <div className={styles.app}>
    <div className={styles.top}><div className={styles.brand}>SALENTO <span>LOCAL</span></div><div className={styles.progress} aria-label={`Onboarding ${screen} of 2`}><i className={styles.active}/><i className={screen === 2 ? styles.active : undefined}/></div></div>
    <section className={styles.surface}>
      {screen === 1 ? <div className={styles.content}>
        <p className={styles.kicker}>{copy.partner}</p><h1>{copy.titleStart}<br/><span>{copy.titleEnd}</span></h1><p className={styles.intro}>{copy.intro}</p>
        <div className={styles.flow} aria-label="How earning works">{steps.map(([label, title, body, icon], index) => <div className={styles.flowItem} key={title}><div className={`${styles.flowStep} ${index === 3 ? styles.finalStep : ""}`}><div className={`${styles.illustration} ${index === 3 ? styles.moneyIllustration : ""}`}>{icon}</div><div className={styles.flowCopy}><span>{label}</span><strong>{title}</strong><p>{body}</p></div></div>{index < 3 ? <Arrow/> : null}</div>)}</div>
        <div className={styles.bottom}><p><span>✦</span>{copy.neverCollect}</p><button type="button" onClick={() => setScreen(2)}>{copy.showHow}<b>→</b></button></div>
      </div> : <div className={`${styles.content} ${styles.second}`}>
        <button type="button" className={styles.back} onClick={() => setScreen(1)} aria-label={copy.back}>←</button><p className={styles.kicker}>{copy.firstBusiness}</p><h1>{copy.helloStart}<br/><span>{copy.helloEnd}</span></h1><p className={styles.intro}>{copy.helloIntro}</p>
        <div className={styles.say}><div>“</div><p>{copy.script}</p></div><div className={styles.micro}><div>✓</div><div><b>{copy.interested}</b><p>{copy.guide}</p></div></div>
        <form action={completePartnerFirstRunOnboardingAction}><button className={styles.mainButton}>{copy.ready}<span>→</span></button></form>
      </div>}
    </section>
  </div>;
}
