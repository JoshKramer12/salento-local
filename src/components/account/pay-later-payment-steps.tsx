"use client";

import {
  IconArrowLeft, IconArrowRight, IconBuildingBank, IconCheck, IconCreditCard,
  IconMail, IconQrcode, IconReceipt2,
} from "@tabler/icons-react";
import type { Locale } from "@/lib/i18n";
import styles from "./pay-later-payment-steps.module.css";

type Renewal = "AUTO" | "MANUAL";
type Method = "ONLINE" | "BANK_TRANSFER";

function Topline({ locale, step }: { locale: Locale; step?: number }) {
  return <div className={styles.topline}><span className={styles.kicker}>{locale === "it" ? "Pagamento" : "Payment"}</span>{step ? <span className={styles.count}>{step} {locale === "it" ? "di" : "of"} 3</span> : null}</div>;
}

function Back({ locale, onClick }: { locale: Locale; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={styles.back}><IconArrowLeft size={20} aria-hidden="true" />{locale === "it" ? "Indietro" : "Back"}</button>;
}

function StepRow({ locale, bank = false }: { locale: Locale; bank?: boolean }) {
  const labels = locale === "it"
    ? ["Mostra QR", "Scansiona", bank ? "Segui le istruzioni" : "Paga"]
    : ["Show QR", "Scan", bank ? "Follow instructions" : "Pay"];
  return <div className={styles.stepRow} aria-label={labels.join(" → ")}>
    {labels.map((label, index) => <div className={styles.stepItem} key={label}><span className={styles.stepNumber}>{index + 1}</span><span>{label}</span>{index < 2 ? <IconArrowRight className={styles.stepArrow} size={17} aria-hidden="true" /> : null}</div>)}
  </div>;
}

export function PartnerHandoffStep({ locale, onNow, onLater, onBack, onSave, busy, payLaterEnabled }: {
  locale: Locale; onNow: () => void; onLater: () => void; onBack: () => void; onSave: () => void;
  busy: boolean; payLaterEnabled: boolean;
}) {
  const it = locale === "it";
  return <div className={styles.handoff}>
    <span className={styles.heroIcon}><IconCheck size={35} aria-hidden="true" /></span>
    <span className={styles.kicker}>{it ? "Parte del Partner completata" : "Partner section complete"}</span>
    <h1 className={styles.title}>{it ? "Come preferisci continuare?" : "How would you like to continue?"}</h1>
    <p className={styles.subtitle}>{it ? "Il titolare può scegliere come proseguire." : "The owner can choose how to continue."}</p>
    <div className={styles.handoffChoices}>
      <button type="button" disabled={busy} onClick={onNow} className={`${styles.choice} ${styles.choicePrimary}`}><IconCreditCard size={30} aria-hidden="true" /><span>{it ? "Sono il titolare, voglio pagare ora" : "I'm the owner and want to pay now"}</span><IconArrowRight size={26} aria-hidden="true" /></button>
      {payLaterEnabled ? <button type="button" disabled={busy} onClick={onLater} className={`${styles.choice} ${styles.choiceOutline}`}><IconMail size={30} aria-hidden="true" /><span>{it ? "Sono il titolare, voglio pagare dopo" : "I'm the owner and want to pay later"}</span><IconArrowRight size={26} aria-hidden="true" /></button> : null}
      {payLaterEnabled ? <p className={styles.choiceNote}>{it ? "Per pagare dopo, riceverai un link via email." : "To pay later, you'll receive a link by email."}</p> : null}
    </div>
    <div className={styles.footer}><Back locale={locale} onClick={onBack} /><button type="button" disabled={busy} onClick={onSave} className={styles.back}>{it ? "Salva ed esci" : "Save & exit"}</button></div>
  </div>;
}

export function PaymentDecisionStep({ locale, onNow, onLater, onBack, allowLater = true, alreadyInvited = false, busy = false }: {
  locale: Locale; onNow: () => void; onLater?: () => void; onBack: () => void; allowLater?: boolean; alreadyInvited?: boolean; busy?: boolean;
}) {
  const it = locale === "it";
  return <div className={styles.screen}><Topline locale={locale} step={1} />
    <h1 className={styles.title}>{it ? "Quando preferisci pagare?" : "When would you like to pay?"}</h1>
    <p className={styles.subtitle}>{it ? "La quota annuale è di €100." : "The annual fee is €100."}</p>
    <div className={styles.decisionChoices}>
      <button type="button" disabled={busy} onClick={onNow} className={`${styles.choice} ${styles.choicePrimary}`}><IconCreditCard size={32} aria-hidden="true" /><span><strong>{it ? "Paga ora" : "Pay now"}</strong><small>{it ? "Completa il pagamento. La scheda sarà pubblicata dopo il pagamento e l’approvazione." : "Complete payment. The listing is published after payment and approval."}</small></span><IconArrowRight size={27} aria-hidden="true" /></button>
      {allowLater && onLater ? <button type="button" disabled={busy} onClick={onLater} className={`${styles.choice} ${styles.choiceOutline}`}><IconMail size={32} aria-hidden="true" /><span><strong>{it ? "Paga più tardi" : "Pay later"}</strong><small>{it ? "Ricevi un link sicuro via email per completare il pagamento quando vuoi." : "Get a secure email link to complete payment when you like."}</small></span><IconArrowRight size={27} aria-hidden="true" /></button> : alreadyInvited ? <p className={styles.info}>{it ? "Hai già ricevuto un invito. Puoi tornare a questo link per pagare più tardi." : "You already have an invitation. Return to this link to pay later."}</p> : null}
    </div>
    <Back locale={locale} onClick={onBack} />
  </div>;
}

export function RenewalSelectionStep({ locale, value, onChange, onContinue, onBack, autoAvailable = true }: {
  locale: Locale; value: Renewal | null; onChange: (value: Renewal) => void; onContinue: () => void; onBack: () => void; autoAvailable?: boolean;
}) {
  const it = locale === "it";
  return <div className={styles.screen}><Topline locale={locale} step={2} />
    <h1 className={styles.title}>{it ? "Come vuoi rinnovare la tua scheda?" : "How would you like to renew your listing?"}</h1>
    <p className={styles.subtitle}>{it ? "La quota è di €100 all’anno." : "The fee is €100 per year."}</p>
    <div className={styles.renewalChoices}>
      {autoAvailable ? <label className={`${styles.renewalCard} ${value === "AUTO" ? styles.selected : ""}`}><input type="radio" name="renewalChoice" value="AUTO" checked={value === "AUTO"} onChange={() => onChange("AUTO")} /><span className={styles.radioMark} aria-hidden="true" /><span><span className={styles.cardHeading}>{it ? "Rinnovo automatico" : "Automatic renewal"}<span className={styles.badge}>{it ? "Consigliato" : "Recommended"}</span></span><span className={styles.cardDescription}>{it ? "€100/anno. Si rinnova automaticamente ogni anno. Puoi disattivarlo in qualsiasi momento dal tuo account." : "€100/year. Renews automatically every year. You can turn it off anytime in your account."}</span></span></label> : null}
      <label className={`${styles.renewalCard} ${value === "MANUAL" ? styles.selected : ""}`}><input type="radio" name="renewalChoice" value="MANUAL" checked={value === "MANUAL"} onChange={() => onChange("MANUAL")} /><span className={styles.radioMark} aria-hidden="true" /><span><span className={styles.cardHeading}>{it ? "Rinnovo manuale" : "Manual renewal"}</span><span className={styles.cardDescription}>{it ? "€100/anno. Ti ricorderemo prima della scadenza. Dovrai rinnovare manualmente ogni anno." : "€100/year. We'll remind you before expiry. You'll renew manually each year."}</span></span></label>
    </div>
    <button type="button" disabled={!value} onClick={onContinue} className={styles.primaryAction}>{it ? "Continua" : "Continue"}<IconArrowRight size={22} aria-hidden="true" /></button>
    <Back locale={locale} onClick={onBack} />
  </div>;
}

export function PaymentMethodStep({ locale, renewal, onOnline, onBank, onBack, busyMethod, error }: {
  locale: Locale; renewal: Renewal; onOnline: () => void; onBank: () => void; onBack: () => void;
  busyMethod?: Method | null; error?: string;
}) {
  const it = locale === "it";
  return <div className={styles.screen}><Topline locale={locale} step={3} />
    <h1 className={styles.title}>{it ? "Come preferisci pagare?" : "How would you like to pay?"}</h1>
    <p className={styles.subtitle}>{it ? "La quota annuale è di €100." : "The annual fee is €100."}</p>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <div className={styles.methods}>
      <article className={`${styles.methodCard} ${styles.onlineCard}`}><div className={styles.methodHeader}><span className={styles.methodIcon}><IconQrcode size={27} aria-hidden="true" /></span><div><span className={styles.badge}>{it ? "Consigliato" : "Recommended"}</span><h2>{it ? "Carta, Apple Pay o Google Pay" : "Card, Apple Pay or Google Pay"}</h2><p>{it ? "Pagamento online sicuro dal telefono." : "Secure online payment by phone."}</p></div></div><StepRow locale={locale} /><p className={styles.accepts}>{it ? "Accetta: Carta" : "Accepts: Card"} · Apple Pay · Google Pay</p><button type="button" disabled={Boolean(busyMethod)} onClick={onOnline} className={styles.primaryAction}><IconQrcode size={20} aria-hidden="true" />{busyMethod === "ONLINE" ? (it ? "Apertura..." : "Opening...") : it ? "Mostra QR di pagamento" : "Show payment QR"}</button></article>
      <article className={`${styles.methodCard} ${styles.bankCard}`}><div className={styles.methodHeader}><span className={`${styles.methodIcon} ${styles.bankIcon}`}><IconBuildingBank size={27} aria-hidden="true" /></span><div><h2>{it ? "Bonifico bancario" : "Bank transfer"}</h2><p>{it ? "Usa questa opzione se preferisci fare un bonifico." : "Choose this if you prefer a bank transfer."}</p></div></div><StepRow locale={locale} bank /><p className={styles.bankNotice}><IconReceipt2 size={17} aria-hidden="true" />{it ? "La scheda sarà online dopo la ricezione del bonifico e l’approvazione." : "The listing goes online after the transfer is received and approved."}</p>{renewal === "AUTO" ? <p className={styles.bankRestriction}>{it ? "Per il bonifico, torna indietro e scegli il rinnovo manuale." : "For bank transfer, go back and choose manual renewal."}</p> : null}<button type="button" disabled={Boolean(busyMethod) || renewal === "AUTO"} onClick={onBank} className={styles.secondaryAction}><IconQrcode size={20} aria-hidden="true" />{busyMethod === "BANK_TRANSFER" ? (it ? "Apertura..." : "Opening...") : it ? "Mostra QR del bonifico" : "Show bank transfer QR"}</button></article>
    </div>
    <Back locale={locale} onClick={onBack} />
  </div>;
}
