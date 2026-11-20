"use client";

import { IconArrowRight, IconBook2, IconBuildingStore, IconChevronRight, IconCoinEuro, IconInfoCircle, IconMapPin, IconPlus, IconWallet, IconX } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState } from "react";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";
import { startPartnerPayoutSetupAction } from "@/app/(account)/actions";
import { DashboardNav } from "@/components/account/dashboard-nav";
import { PartnerWorkspaceNav } from "@/components/account/partner-workspace-nav";
import { PartnerCashoutPanel } from "@/components/account/partner-cashout-panel";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { formatCurrencyFromCents, getSubmissionStatusLabel, isDraftLikeSubmission } from "@/lib/account";
import { getPartnerCommissionDisplay, getPartnerInitialHoldProgress, type DashboardCommission } from "@/lib/partner-dashboard-display";
import { cashoutBlockReason } from "@/lib/partner-cashout-presenter";
import { nextPendingEligibility } from "@/lib/partner-earnings-presentation";
import type { CashoutView } from "@/lib/partner-cashout-view";
import { isAwaitingPartnerPayment } from "@/lib/partner-submission-groups";
import type { Locale } from "@/lib/i18n";
import styles from "./partner-dashboard.module.css";

type Submission = {
  businessName: string; createdAt: Date; updatedAt: Date;
  createdBusiness: { id: string; slug: string; membership: { entitlementRevokedAt: Date | null; graceEndsAt: Date } | null } | null;
  id: string; paymentMethod: PaymentMethod | null; paymentStatus: PaymentStatus;
  payLaterInvitation: { revokedAt: Date | null; declinedAt: Date | null; completedAt: Date | null } | null;
  status: Parameters<typeof getSubmissionStatusLabel>[0]; town: { name: string };
};
type Commission = DashboardCommission & { business: { name: string } | null; businessId: string | null; businessSubmission: { businessName: string } | null; businessSubmissionId: string | null; createdAt: Date; earnedAt: Date | null; eligibleAt: Date | null };
type Setup = { payoutsEnabled?: boolean; setupState: "action-required" | "ready" | "restricted" | "setup-incomplete" | "setup-not-started" } | null;
type Props = { now: string; balances: { available: number; debt: number; paid: number; pending: number; testActivity: number; totalEarned: number; unverifiedActivity: number }; cashoutView: CashoutView; commissionLedger: Commission[]; holdDays: number; locale: Locale; payoutsPaused: boolean; preview?: boolean; recentCommissions: Commission[]; payableCommissionIds: string[]; setup: Setup; showDiagnostics?: boolean; submissions: Submission[]; totals: { drafts: number }; username: string };

const copy = {
  en: { add: "Add business", all: "View all", attention: "Needs your attention", available: "Available to cash out", cashout: "Cash out", cashoutUnavailable: "Cash Out is not available yet.", businesses: "Your businesses", connect: "Connect payout account", connectBody: "Set up a way to receive eligible commissions.", debt: "Outstanding payout debt", debtStatus: "Eligible · payout debt applies", draft: "Draft", draftAction: "Finish your latest draft", drafts: "Drafts", earnings: "YOUR EARNINGS", emptyActivity: "Commission activity will appear here after an eligible payment.", emptyAttention: "You’re all caught up.", emptyBusinesses: "Add your first business to start building your portfolio.", guide: "Open partner guide", guideBody: "Tips for talking to owners, taking photos and earning commissions.", guideTitle: "Need a refresher?", hold: "Pending", holdNote: "14-day hold", localPartner: "LOCAL PARTNER", nextSteps: "NEXT STEPS", paused: "Cash Out requests are currently paused.", pausedStatus: "Eligible · payouts paused", paid: "Paid out", portfolio: "YOUR BUSINESSES", published: "Published", recent: "Recent activity", recentLabel: "RECENT ACTIVITY", restricted: "Payout setup needs attention", restrictedBody: "Review your payout account setup.", safeguard: "Test and unverified commissions are excluded.", subtitle: "Here’s what’s happening with your partner account.", test: "Test activity", total: "Total eligible earnings", unverified: "Unverified history", viewEarnings: "View earnings", waiting: "Awaiting payment", welcome: "Welcome" },
  it: { add: "Aggiungi attività", all: "Vedi tutte", attention: "Richiede attenzione", available: "Disponibile per il prelievo", cashout: "Preleva", cashoutUnavailable: "Il prelievo non è ancora disponibile.", businesses: "Le tue attività", connect: "Collega il conto per i pagamenti", connectBody: "Imposta un metodo per ricevere le commissioni idonee.", debt: "Debito da pagamenti precedente", debtStatus: "Idonea · debito da compensare", draft: "Bozza", draftAction: "Completa l’ultima bozza", drafts: "Bozze", earnings: "I TUOI GUADAGNI", emptyActivity: "Le commissioni compariranno qui dopo un pagamento idoneo.", emptyAttention: "Per ora è tutto a posto.", emptyBusinesses: "Aggiungi la prima attività per creare il tuo portfolio.", guide: "Apri la guida Partner", guideBody: "Consigli per parlare con i titolari, scattare foto e guadagnare commissioni.", guideTitle: "Serve un ripasso?", hold: "In attesa", holdNote: "Attesa di 14 giorni", localPartner: "PARTNER LOCALE", nextSteps: "PROSSIMI PASSI", paused: "Le richieste di prelievo sono temporaneamente sospese.", pausedStatus: "Idonea · pagamenti sospesi", paid: "Già pagato", portfolio: "LE TUE ATTIVITÀ", published: "Pubblicate", recent: "Attività recente", recentLabel: "ATTIVITÀ RECENTE", restricted: "Il conto per i pagamenti richiede attenzione", restrictedBody: "Controlla la configurazione del conto.", safeguard: "Le commissioni test e non verificate sono escluse.", subtitle: "Ecco cosa succede nel tuo account partner.", test: "Attività test", total: "Totale guadagni idonei", unverified: "Storico non verificato", viewEarnings: "Vedi guadagni", waiting: "In attesa di pagamento", welcome: "Benvenuto" },
} as const;

function isPublished(entry: Submission, now: Date) {
  const membership = entry.createdBusiness?.membership;
  return entry.status === "PUBLISHED" && entry.paymentStatus === "PAID" && Boolean(entry.createdBusiness?.slug) && !membership?.entitlementRevokedAt && (!membership || new Date(membership.graceEndsAt).getTime() > now.getTime());
}

export function PartnerDashboard({ now, balances, cashoutView, commissionLedger, holdDays, locale, payoutsPaused, preview = false, recentCommissions, payableCommissionIds, setup, showDiagnostics = false, submissions, totals, username }: Props) {
  const t = copy[locale];
  const currentDate = new Date(now);
  const firstName = username.trim().split(/\s+/)[0] || username;
  const payableIds = new Set(payableCommissionIds);
  const setupReady = setup?.setupState === "ready" && Boolean(setup.payoutsEnabled) && cashoutView.destinationReady;
  const drafts = submissions.filter((entry) => isDraftLikeSubmission(entry));
  const awaiting = drafts.filter(isAwaitingPartnerPayment);
  const unfinished = drafts.filter((entry) => !isAwaitingPartnerPayment(entry));
  const latestDraft = [...unfinished].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  const publishedCount = submissions.filter((entry) => isPublished(entry, currentDate)).length;
  const blocker = cashoutBlockReason(cashoutView);
  const pendingNext = cashoutView.debtCents === 0 && !cashoutView.unresolvedLegacyPayoutId && !cashoutView.activeWithdrawalId
    ? nextPendingEligibility(commissionLedger, currentDate, holdDays) : null;
  const statusCopy = locale === "it" ? {
    active: "Hai già un prelievo in corso.", review: "Un pagamento richiede una verifica manuale.", debt: "Una rettifica per rimborso è in sospeso.",
    destination: cashoutView.destinationLast4 ? "Il conto per i pagamenti collegato richiede attenzione." : "Collega un conto per i pagamenti.", pending: "Le commissioni sono ancora in attesa.",
    minimum: cashoutView.availableCents === 0 ? "Nessun importo idoneo disponibile." : "Servono almeno €50 per il prelievo.",
  } : {
    active: "A withdrawal is already in progress.", review: "A payout needs manual review.", debt: "An outstanding refund adjustment applies.",
    destination: cashoutView.destinationLast4 ? "Your connected payout account needs attention." : "Connect a payout account to continue.", pending: "Commissions are still pending.",
    minimum: cashoutView.availableCents === 0 ? "No eligible funds are available." : "At least €50 is needed to cash out.",
  };
  const hasInitialHold = commissionLedger.some((entry) => entry.amountCents > 0 && getPartnerInitialHoldProgress(entry, currentDate, holdDays) && !commissionLedger.some((row) => row.type === "REVERSAL" && row.sourceKey === `commission:reversal:${entry.id}` && ["REVERSED", "DEBT"].includes(row.status)));
  const actions = Number(!setupReady) + Number(Boolean(latestDraft)) + Number(submissions.length === 0);
  const payoutStep = setup?.setupState === "setup-incomplete" ? (locale === "it" ? ["Completa la configurazione", "Completa il conto per ricevere i prelievi."] : ["Finish payout setup", "Complete your account setup to receive withdrawals."]) :
    setup?.setupState === "action-required" ? (locale === "it" ? ["Verifica il conto per i pagamenti", "Sono necessarie altre informazioni per ricevere i pagamenti."] : ["Verify payout account", "Additional information is required before you can receive payouts."]) :
    setup?.setupState === "restricted" || setup?.setupState === "ready" ? (locale === "it" ? ["Il conto per i pagamenti richiede attenzione", "Controlla il conto per continuare."] : ["Payout account needs attention", "Review your payout account to continue."]) : [t.connect, t.connectBody];
  const earningsInfo = locale === "it" ? [
    "Commissioni registrate da pagamenti reali verificati, escluse quelle annullate. Le rettifiche per rimborsi sono mostrate a parte. Include somme in attesa e già liquidate.",
    "Commissioni non ancora prelevabili. Possono essere in attesa del periodo di 14 giorni o di altri controlli; rimborsi e rettifiche possono modificare l’importo.",
    "Commissioni con pagamento del fornitore confermato. L’arrivo sul conto può richiedere altro tempo.",
  ] : [
    "Recorded commissions from verified live payments, excluding reversed commissions. Refund debt adjustments are shown separately. Includes pending and paid out amounts.",
    "Commissions not yet withdrawable. They may be in the 14-day waiting period or awaiting other checks; refunds and adjustments can change the amount.",
    "Commissions with a confirmed provider payout. Arrival in your bank account may take longer.",
  ];
  return <div className={styles.page}>
    <PartnerWorkspaceNav active="dashboard" locale={locale} />
    <div className={`${styles.desktopNav} shell px-4 pt-5 sm:px-6`}><DashboardNav active="dashboard" draftCount={totals.drafts} locale={locale} role="GETTER" /></div>
    <main className={styles.main}>
      <header className={styles.welcome}><div><span className={styles.eyebrow}>{t.localPartner}</span><h1>{t.welcome}, {firstName}.</h1><p>{t.subtitle}</p></div><HardNavigationLink href="/publish" className={styles.primary}><IconPlus aria-hidden="true" size={22} />{t.add}</HardNavigationLink></header>
      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.earnings}`} aria-labelledby="partner-earnings-heading">
          <div className={styles.cardHeader}><div><span className={styles.eyebrow}>{t.earnings}</span><h2 id="partner-earnings-heading">{t.available}</h2></div><HardNavigationLink href="/dashboard/earnings" className={styles.textLink}>{t.viewEarnings}<IconArrowRight aria-hidden="true" size={20} /></HardNavigationLink></div>
          <div className={styles.balanceLine}><strong>{formatCurrencyFromCents(cashoutView.availableCents, locale)}</strong>{blocker ? <button type="button" className={styles.cashout} disabled aria-describedby="cashout-unavailable"><IconWallet aria-hidden="true" size={22} />{t.cashout}</button> : <PartnerCashoutPanel view={cashoutView} locale={locale} preview={preview} triggerOnly triggerClassName={styles.cashout} />}</div>
          {blocker ? <p id="cashout-unavailable" className={styles.cashoutReason} role="status">{blocker === "paused" ? t.paused : statusCopy[blocker]}</p> : <p className={styles.cashoutReason}>{locale === "it" ? "Controlla e conferma l’importo prima di inviare la richiesta." : "Review and confirm the amount before submitting."}</p>}
          <div className={styles.metrics}><Metric label={locale === "it" ? "Guadagni live registrati" : "Recorded live earnings"} value={formatCurrencyFromCents(cashoutView.grossEarnedCents, locale)} info={earningsInfo[0]} locale={locale} /><Metric label={t.hold} value={formatCurrencyFromCents(cashoutView.pendingCents, locale)} info={earningsInfo[1]} locale={locale} detail={pendingNext ? `${locale === "it" ? "Previsti" : "Expected"}: ${formatCurrencyFromCents(pendingNext.amountCents, locale)} ${locale === "it" ? "dal" : "on"} ${new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(pendingNext.date)}` : hasInitialHold ? t.holdNote : undefined} /><Metric label={t.paid} value={formatCurrencyFromCents(cashoutView.paidCents, locale)} info={earningsInfo[2]} locale={locale} /></div>
          <div className={styles.financialNote}><span aria-hidden="true">ⓘ</span><div>{t.safeguard}{cashoutView.reservedCents > 0 ? <span className={styles.excluded}>{locale === "it" ? "Riservato" : "Reserved"}: {formatCurrencyFromCents(cashoutView.reservedCents, locale)}</span> : null}{showDiagnostics && (cashoutView.testCents > 0 || cashoutView.unverifiedCents > 0) ? <span className={styles.excluded}> {t.test}: {formatCurrencyFromCents(cashoutView.testCents, locale)} · {t.unverified}: {formatCurrencyFromCents(cashoutView.unverifiedCents, locale)}</span> : null}{cashoutView.debtCents > 0 ? <span className={styles.excluded}> {t.debt}: {formatCurrencyFromCents(cashoutView.debtCents, locale)}</span> : null}</div></div>
        </section>
        <section className={`${styles.card} ${styles.attention}`} aria-labelledby="partner-attention-heading"><div className={styles.cardHeader}><div><span className={styles.eyebrow}>{t.nextSteps}</span><h2 id="partner-attention-heading">{t.attention}</h2></div><span className={styles.count}>{actions}</span></div><div className={styles.rows}>
          {!setupReady ? <form action={startPartnerPayoutSetupAction} className={styles.actionForm}><input type="hidden" name="locale" value={locale} /><input type="hidden" name="returnTo" value="/dashboard" /><button className={styles.row}><span className={styles.rowIcon}><IconWallet aria-hidden="true" size={22} /></span><span className={styles.rowText}><strong>{payoutStep[0]}</strong><small>{payoutStep[1]}</small></span><IconChevronRight aria-hidden="true" size={20} /></button></form> : null}
          {latestDraft ? <HardNavigationLink href={`/publish?submission=${encodeURIComponent(latestDraft.id)}`} className={styles.row}><span className={`${styles.rowIcon} ${styles.draftIcon}`}><IconBuildingStore aria-hidden="true" size={22} /></span><span className={styles.rowText}><strong>{t.draftAction}</strong><small>{latestDraft.businessName}</small></span><IconChevronRight aria-hidden="true" size={20} /></HardNavigationLink> : null}{submissions.length === 0 ? <HardNavigationLink href="/publish" className={styles.row}><span className={`${styles.rowIcon} ${styles.draftIcon}`}><IconBuildingStore aria-hidden="true" size={22} /></span><span className={styles.rowText}><strong>{locale === "it" ? "Aggiungi la tua prima attività" : "Add your first business"}</strong><small>{locale === "it" ? "Inizia con una nuova segnalazione." : "Start your first submission."}</small></span><IconChevronRight aria-hidden="true" size={20} /></HardNavigationLink> : null}{!actions ? <p className={styles.empty}>{t.emptyAttention}</p> : null}
        </div></section>
        <section className={`${styles.card} ${styles.activity}`} aria-labelledby="partner-activity-heading"><div className={styles.cardHeader}><div><h2 id="partner-activity-heading" className={styles.eyebrow}>{t.recentLabel}</h2></div><HardNavigationLink href="/dashboard/earnings" className={styles.textLink}>{t.viewEarnings}<IconArrowRight aria-hidden="true" size={20} /></HardNavigationLink></div><div className={styles.rows}>{recentCommissions.length ? recentCommissions.slice(0, 3).map((entry) => {
          const financial = getPartnerCommissionDisplay(entry, commissionLedger, payableIds, locale);
          const name = entry.business?.name || entry.businessSubmission?.businessName || "—";
          const submission = submissions.find((item) => item.id === entry.businessSubmissionId || item.createdBusiness?.id === entry.businessId);
          const date = entry.payment?.paidAt || entry.earnedAt || entry.createdAt;
          const status = payableIds.has(entry.id) && payoutsPaused ? t.pausedStatus : payableIds.has(entry.id) && balances.debt > 0 ? t.debtStatus : financial.label.split(" · ").slice(1).join(" · ");
          return <div className={styles.row} key={entry.id}><span className={styles.rowIcon}><IconCoinEuro aria-hidden="true" size={22} /></span><span className={styles.rowText}><strong>{name}</strong><small>{[submission?.town.name, new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", { day: "2-digit", month: "short" }).format(new Date(date))].filter(Boolean).join(" · ")}</small></span><span className={styles.activityAmount}>{formatCurrencyFromCents(entry.amountCents, locale)}</span><span className={`${styles.status} ${styles[financial.tone]}`}>{status}</span></div>;
        }) : <p className={styles.empty}>{t.emptyActivity}</p>}</div></section>
        <section className={`${styles.card} ${styles.businesses}`} aria-labelledby="partner-businesses-heading"><div className={styles.cardHeader}><div><h2 id="partner-businesses-heading" className={styles.eyebrow}>{t.portfolio}</h2></div><HardNavigationLink href="/dashboard/businesses" className={styles.textLink}>{t.all}<IconArrowRight aria-hidden="true" size={20} /></HardNavigationLink></div><div className={styles.businessStats}><Metric label={locale === "it" ? "Totale" : "Total"} value={String(submissions.length)} /><Metric label={t.published} value={String(publishedCount)} /><Metric label={t.waiting} value={String(awaiting.length)} /><Metric label={t.drafts} value={String(unfinished.length)} /></div><div className={styles.rows}>{submissions.length ? submissions.slice(0, 3).map((entry) => {
          const published = isPublished(entry, currentDate);
          const draft = isDraftLikeSubmission(entry);
          const waiting = draft && isAwaitingPartnerPayment(entry);
          const status = published ? t.published : waiting ? t.waiting : draft ? t.draft : getSubmissionStatusLabel(entry.status, locale);
          const href = published ? `/businesses/${entry.createdBusiness?.slug}` : draft && !waiting ? `/publish?submission=${encodeURIComponent(entry.id)}` : "/dashboard/businesses";
          return <HardNavigationLink href={href} className={styles.row} key={entry.id}><span className={`${styles.rowIcon} ${styles.initials}`}>{entry.businessName.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("")}</span><span className={styles.rowText}><strong>{entry.businessName}</strong><small><IconMapPin aria-hidden="true" size={14} />{entry.town.name}</small></span><span className={`${styles.status} ${published ? styles.green : waiting ? styles.yellow : styles.neutral}`}>{status}</span><IconChevronRight aria-hidden="true" size={20} /></HardNavigationLink>;
        }) : <div className={styles.emptyBusiness}><p>{t.emptyBusinesses}</p><HardNavigationLink href="/publish" className={styles.textLink}>{t.add}<IconArrowRight aria-hidden="true" size={18} /></HardNavigationLink></div>}</div></section>
        <aside className={`${styles.card} ${styles.guide}`}><span className={styles.rowIcon}><IconBook2 aria-hidden="true" size={25} /></span><div><strong>{t.guideTitle}</strong><span>{t.guideBody}</span></div><HardNavigationLink href="/partner/onboarding?guide=1" className={styles.textLink}>{t.guide}<IconArrowRight aria-hidden="true" size={20} /></HardNavigationLink></aside>
      </div>
    </main>
  </div>;
}

function Metric({ label, value, detail, info, locale }: { label: string; value: string; detail?: string; info?: string; locale?: Locale }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className={styles.metric} ref={root}><div className={styles.metricLabel}><span>{label}</span>{info ? <button ref={trigger} type="button" className={styles.infoButton} aria-label={`${locale === "it" ? "Informazioni su" : "About"} ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined} onClick={() => setOpen((value) => !value)}><IconInfoCircle size={17} aria-hidden="true" /></button> : null}</div><strong>{value}</strong>{detail ? <small>{detail}</small> : null}{open && info ? <div id={id} className={styles.infoPopover} role="note"><p>{info}</p><button type="button" className={styles.infoClose} aria-label={locale === "it" ? "Chiudi informazioni" : "Close information"} onClick={() => { setOpen(false); trigger.current?.focus(); }}><IconX size={16} aria-hidden="true" /></button></div> : null}</div>;
}
