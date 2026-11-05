"use client";

import { IconArrowRight, IconBook2, IconBuildingStore, IconChevronRight, IconCoinEuro, IconMapPin, IconPlus, IconWallet } from "@tabler/icons-react";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";
import { startPartnerPayoutSetupAction } from "@/app/(account)/actions";
import { DashboardNav } from "@/components/account/dashboard-nav";
import { PartnerWorkspaceNav } from "@/components/account/partner-workspace-nav";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { formatCurrencyFromCents, getSubmissionStatusLabel, isDraftLikeSubmission } from "@/lib/account";
import { getPartnerCommissionDisplay, getPartnerInitialHoldProgress, type DashboardCommission } from "@/lib/partner-dashboard-display";
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
type Props = { now: string; balances: { available: number; debt: number; paid: number; pending: number; testActivity: number; totalEarned: number; unverifiedActivity: number }; commissionLedger: Commission[]; holdDays: number; locale: Locale; payoutsPaused: boolean; recentCommissions: Commission[]; payableCommissionIds: string[]; setup: Setup; submissions: Submission[]; totals: { drafts: number }; username: string };

const copy = {
  en: { add: "Add business", all: "View all", attention: "Needs your attention", available: "Available for payout", balance: "Eligible commissions", businesses: "Your businesses", connect: "Connect payout account", connectBody: "Set up a way to receive eligible commissions.", debt: "Outstanding payout debt", debtStatus: "Eligible · payout debt applies", draft: "Draft", draftAction: "Finish your latest draft", drafts: "Drafts", earnings: "EARNINGS", emptyActivity: "Commission activity will appear here after an eligible payment.", emptyAttention: "You’re all caught up for now.", emptyBusinesses: "Add your first business to start building your portfolio.", guide: "Open partner guide", guideBody: "Tips for talking to owners, taking photos and earning commissions.", guideTitle: "Need a refresher?", hold: "Pending commissions", holdNote: "New business commissions have a 14-day refund hold.", localPartner: "LOCAL PARTNER", nextSteps: "NEXT STEPS", paused: "Real Partner payouts are paused while test payments are in use.", pausedStatus: "Eligible · payouts paused", paid: "Paid out", portfolio: "PORTFOLIO", published: "Published", recent: "Recent activity", recentLabel: "COMMISSIONS", restricted: "Payout setup needs attention", restrictedBody: "Review your payout account setup.", safeguard: "Test and unverified commissions are excluded from eligible commissions.", subtitle: "Here’s what’s happening with your partner account.", test: "Test activity", total: "Total eligible earnings", unverified: "Unverified history", viewEarnings: "View earnings", waiting: "Awaiting payment", welcome: "Welcome" },
  it: { add: "Aggiungi attività", all: "Vedi tutte", attention: "Richiede attenzione", available: "Disponibile per il pagamento", balance: "Commissioni idonee", businesses: "Le tue attività", connect: "Collega il conto per i pagamenti", connectBody: "Imposta un metodo per ricevere le commissioni idonee.", debt: "Debito da pagamenti precedente", debtStatus: "Idonea · debito da compensare", draft: "Bozza", draftAction: "Completa l’ultima bozza", drafts: "Bozze", earnings: "GUADAGNI", emptyActivity: "Le commissioni compariranno qui dopo un pagamento idoneo.", emptyAttention: "Per ora è tutto a posto.", emptyBusinesses: "Aggiungi la prima attività per creare il tuo portfolio.", guide: "Apri la guida Partner", guideBody: "Consigli per parlare con i titolari, scattare foto e guadagnare commissioni.", guideTitle: "Serve un ripasso?", hold: "Commissioni in sospeso", holdNote: "Le nuove commissioni hanno un’attesa di 14 giorni per eventuali rimborsi.", localPartner: "PARTNER LOCALE", nextSteps: "PROSSIMI PASSI", paused: "I pagamenti reali ai Partner sono sospesi durante l’uso dei pagamenti test.", pausedStatus: "Idonea · pagamenti sospesi", paid: "Già pagato", portfolio: "PORTFOLIO", published: "Pubblicate", recent: "Attività recente", recentLabel: "COMMISSIONI", restricted: "Il conto per i pagamenti richiede attenzione", restrictedBody: "Controlla la configurazione del conto.", safeguard: "Le commissioni test e non verificate sono escluse dalle commissioni idonee.", subtitle: "Ecco cosa succede nel tuo account partner.", test: "Attività test", total: "Totale guadagni idonei", unverified: "Storico non verificato", viewEarnings: "Vedi guadagni", waiting: "In attesa di pagamento", welcome: "Benvenuto" },
} as const;

function isPublished(entry: Submission, now: Date) {
  const membership = entry.createdBusiness?.membership;
  return entry.status === "PUBLISHED" && entry.paymentStatus === "PAID" && Boolean(entry.createdBusiness?.slug) && !membership?.entitlementRevokedAt && (!membership || new Date(membership.graceEndsAt).getTime() > now.getTime());
}

export function PartnerDashboard({ now, balances, commissionLedger, holdDays, locale, payoutsPaused, recentCommissions, payableCommissionIds, setup, submissions, totals, username }: Props) {
  const t = copy[locale];
  const currentDate = new Date(now);
  const firstName = username.trim().split(/\s+/)[0] || username;
  const payableIds = new Set(payableCommissionIds);
  const setupReady = setup?.setupState === "ready" && Boolean(setup.payoutsEnabled);
  const drafts = submissions.filter((entry) => isDraftLikeSubmission(entry));
  const awaiting = drafts.filter(isAwaitingPartnerPayment);
  const unfinished = drafts.filter((entry) => !isAwaitingPartnerPayment(entry));
  const latestDraft = [...unfinished].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  const publishedCount = submissions.filter((entry) => isPublished(entry, currentDate)).length;
  const hasInitialHold = commissionLedger.some((entry) => entry.amountCents > 0 && getPartnerInitialHoldProgress(entry, currentDate, holdDays) && !commissionLedger.some((row) => row.type === "REVERSAL" && row.sourceKey === `commission:reversal:${entry.id}` && ["REVERSED", "DEBT"].includes(row.status)));
  const actions = Number(!setupReady) + Number(Boolean(latestDraft));
  return <div className={styles.page}>
    <PartnerWorkspaceNav active="dashboard" locale={locale} />
    <div className={`${styles.desktopNav} shell px-4 pt-5 sm:px-6`}><DashboardNav active="dashboard" draftCount={totals.drafts} locale={locale} role="GETTER" /></div>
    <main className={styles.main}>
      <header className={styles.welcome}><div><span className={styles.eyebrow}>{t.localPartner}</span><h1>{t.welcome}, {firstName}.</h1><p>{t.subtitle}</p></div><HardNavigationLink href="/publish" className={styles.primary}><IconPlus aria-hidden="true" size={22} />{t.add}</HardNavigationLink></header>
      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.earnings}`} aria-labelledby="partner-earnings-heading">
          <div className={styles.cardHeader}><div><span className={styles.eyebrow}>{t.earnings}</span><h2 id="partner-earnings-heading">{payoutsPaused || !setupReady || balances.debt > 0 ? t.balance : t.available}</h2></div><HardNavigationLink href="/dashboard/earnings" className={styles.textLink}>{t.viewEarnings}<IconArrowRight aria-hidden="true" size={20} /></HardNavigationLink></div>
          <div className={styles.balanceLine}><strong>{formatCurrencyFromCents(balances.available, locale)}</strong>{!payoutsPaused && setupReady && balances.debt === 0 ? <span>{t.available}</span> : null}</div>
          <div className={styles.metrics}><Metric label={t.total} value={formatCurrencyFromCents(balances.totalEarned, locale)} /><Metric label={t.hold} value={formatCurrencyFromCents(balances.pending, locale)} detail={hasInitialHold ? t.holdNote : undefined} /><Metric label={t.paid} value={formatCurrencyFromCents(balances.paid, locale)} /></div>
          <div className={styles.financialNote}><span aria-hidden="true">✓</span><div>{payoutsPaused ? <strong>{t.paused} </strong> : null}{t.safeguard}{balances.testActivity > 0 || balances.unverifiedActivity > 0 ? <span className={styles.excluded}> {t.test}: {formatCurrencyFromCents(balances.testActivity, locale)} · {t.unverified}: {formatCurrencyFromCents(balances.unverifiedActivity, locale)}</span> : null}{balances.debt > 0 ? <span className={styles.excluded}> {t.debt}: {formatCurrencyFromCents(balances.debt, locale)}</span> : null}</div></div>
        </section>
        <section className={`${styles.card} ${styles.attention}`} aria-labelledby="partner-attention-heading"><div className={styles.cardHeader}><div><span className={styles.eyebrow}>{t.nextSteps}</span><h2 id="partner-attention-heading">{t.attention}</h2></div><span className={styles.count}>{actions}</span></div><div className={styles.rows}>
          {!setupReady ? <form action={startPartnerPayoutSetupAction} className={styles.actionForm}><input type="hidden" name="locale" value={locale} /><input type="hidden" name="returnTo" value="/dashboard" /><button className={styles.row}><span className={styles.rowIcon}><IconWallet aria-hidden="true" size={22} /></span><span className={styles.rowText}><strong>{setup?.setupState === "restricted" || setup?.setupState === "action-required" ? t.restricted : t.connect}</strong><small>{setup?.setupState === "restricted" || setup?.setupState === "action-required" ? t.restrictedBody : t.connectBody}</small></span><IconChevronRight aria-hidden="true" size={20} /></button></form> : null}
          {latestDraft ? <HardNavigationLink href={`/publish?submission=${encodeURIComponent(latestDraft.id)}`} className={styles.row}><span className={`${styles.rowIcon} ${styles.draftIcon}`}><IconBuildingStore aria-hidden="true" size={22} /></span><span className={styles.rowText}><strong>{t.draftAction}</strong><small>{latestDraft.businessName}</small></span><IconChevronRight aria-hidden="true" size={20} /></HardNavigationLink> : null}{!actions ? <p className={styles.empty}>{t.emptyAttention}</p> : null}
        </div></section>
        <section className={`${styles.card} ${styles.activity}`} aria-labelledby="partner-activity-heading"><div className={styles.cardHeader}><div><span className={styles.eyebrow}>{t.recentLabel}</span><h2 id="partner-activity-heading">{t.recent}</h2></div><HardNavigationLink href="/dashboard/earnings" className={styles.textLink}>{t.viewEarnings}<IconArrowRight aria-hidden="true" size={20} /></HardNavigationLink></div><div className={styles.rows}>{recentCommissions.length ? recentCommissions.slice(0, 3).map((entry) => {
          const financial = getPartnerCommissionDisplay(entry, commissionLedger, payableIds, locale);
          const name = entry.business?.name || entry.businessSubmission?.businessName || "—";
          const submission = submissions.find((item) => item.id === entry.businessSubmissionId || item.createdBusiness?.id === entry.businessId);
          const date = entry.payment?.paidAt || entry.earnedAt || entry.createdAt;
          const status = payableIds.has(entry.id) && payoutsPaused ? t.pausedStatus : payableIds.has(entry.id) && balances.debt > 0 ? t.debtStatus : financial.label.split(" · ").slice(1).join(" · ");
          return <div className={styles.row} key={entry.id}><span className={styles.rowIcon}><IconCoinEuro aria-hidden="true" size={22} /></span><span className={styles.rowText}><strong>{name}</strong><small>{[submission?.town.name, new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", { day: "2-digit", month: "short" }).format(new Date(date))].filter(Boolean).join(" · ")}</small></span><span className={styles.activityAmount}>{formatCurrencyFromCents(entry.amountCents, locale)}</span><span className={`${styles.status} ${styles[financial.tone]}`}>{status}</span></div>;
        }) : <p className={styles.empty}>{t.emptyActivity}</p>}</div></section>
        <section className={`${styles.card} ${styles.businesses}`} aria-labelledby="partner-businesses-heading"><div className={styles.cardHeader}><div><span className={styles.eyebrow}>{t.portfolio}</span><h2 id="partner-businesses-heading">{t.businesses}</h2></div><HardNavigationLink href="/dashboard/businesses" className={styles.textLink}>{t.all}<IconArrowRight aria-hidden="true" size={20} /></HardNavigationLink></div><div className={styles.businessStats}><Metric label={locale === "it" ? "Totale" : "Total"} value={String(submissions.length)} /><Metric label={t.published} value={String(publishedCount)} /><Metric label={t.waiting} value={String(awaiting.length)} /><Metric label={t.drafts} value={String(unfinished.length)} /></div><div className={styles.rows}>{submissions.length ? submissions.slice(0, 3).map((entry) => {
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

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>; }
