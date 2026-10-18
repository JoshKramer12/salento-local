"use client";

import { IconArrowRight, IconBuildingStore, IconCamera, IconCircleCheck, IconClock, IconCoin, IconFileText, IconMapPin, IconMessageCircle, IconUser } from "@tabler/icons-react";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";

import { startPartnerPayoutSetupAction } from "@/app/(account)/actions";
import { DashboardNav } from "@/components/account/dashboard-nav";
import { PartnerWorkspaceNav } from "@/components/account/partner-workspace-nav";
import { PartnerOwnerAccess } from "@/components/account/partner-owner-access";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { formatCurrencyFromCents, getSubmissionStatusLabel } from "@/lib/account";
import { getBusinessPhotoUrls } from "@/lib/business-photos";
import { getPartnerCommissionDisplay, getPartnerInitialHoldProgress, type DashboardCommission } from "@/lib/partner-dashboard-display";
import type { Locale } from "@/lib/i18n";

import styles from "./partner-dashboard.module.css";

type Submission = { businessName: string; category: { name: string; slug: string }; partnerCommissions: (DashboardCommission & { eligibleAt: Date | null })[]; createdAt: Date; createdBusiness: { id: string; images: { alt: string; url: string }[]; slug: string; membership: { entitlementRevokedAt: Date | null; graceEndsAt: Date } | null } | null; id: string; paymentMethod: PaymentMethod | null; paymentStatus: PaymentStatus; photoUrls?: unknown; status: Parameters<typeof getSubmissionStatusLabel>[0]; town: { name: string } };
type Commission = DashboardCommission & { business: { name: string } | null; businessId: string | null; businessSubmission: { businessName: string } | null; businessSubmissionId: string | null; createdAt: Date; earnedAt: Date | null; eligibleAt: Date | null };
type Payout = { amountCents: number; id: string; initiatedAt: Date; paidAt: Date | null; status: "ACTION_REQUIRED" | "CANCELED" | "FAILED" | "PAID" | "PROCESSING" | "SCHEDULED" };
type Setup = { bankAccountLast4?: string | null; bankName?: string | null; payoutsEnabled?: boolean; setupState: "action-required" | "ready" | "restricted" | "setup-incomplete" | "setup-not-started" } | null;
type Props = { now: string; balances: { available: number; nextPayoutDate: Date; paid: number; testActivity: number; totalEarned: number; unverifiedActivity: number }; commissionLedger: Commission[]; commissionRates: { initial: number; renewal: number }; history: Payout[]; holdDays: number; locale: Locale; payoutsPaused: boolean; recentCommissions: Commission[]; payableCommissionIds: string[]; setup: Setup; submissions: Submission[]; totals: { drafts: number; published: number; awaitingPayment: number }; username: string };

const copy = { en: { add: "Add a business", allBusinesses: "View all businesses", businesses: "Your businesses", connect: "Connect payout account", connected: "Payout account connected", continue: "Continue", drafts: "Drafts", emptyEarnings: "Your earnings will appear here after a business joins.", emptyBusinesses: "Add a local business to start tracking it here.", first: "Ready to earn your first €50?", guide: "Partner guide", guideBody: "Everything you need, right on your phone.", guideTitle: "Talking to a business?", latest: "Latest", localPartner: "LOCAL PARTNER", newBusiness: "New business", nextPayout: "Eligible for real payout", noDate: "No real payout scheduled", paid: "Verified live payouts", payout: "PAYOUT ACCOUNT", payoutBody: "Connect your payout account so we can send your eligible commissions.", recentBusinesses: "Recent businesses", recentEarnings: "Recent earnings", renewal: "Renewal", setup: "Finish setting up your payout account", setupAction: "Finish setup", total: "Verified live earnings", viewEarnings: "View earnings & payouts", viewListing: "View listing", welcome: "Welcome", welcomeAgain: "Ready to earn another €50?", waiting: "Waiting for payment", waitingBody: "The owner hasn't paid yet.", yourEarnings: "YOUR EARNINGS" }, it: { add: "Aggiungi attività", allBusinesses: "Vedi tutte le attività", businesses: "Le tue attività", connect: "Collega il conto per i pagamenti", connected: "Conto per pagamenti collegato", continue: "Continua", drafts: "Bozze", emptyEarnings: "I tuoi guadagni compariranno qui quando un'attività aderisce.", emptyBusinesses: "Aggiungi un'attività locale per iniziare a seguirla qui.", first: "Pronto a guadagnare i tuoi primi €50?", guide: "Guida Partner", guideBody: "Tutto ciò che ti serve, direttamente sul tuo telefono.", guideTitle: "Stai parlando con un'attività?", latest: "Ultimo", localPartner: "PARTNER LOCALE", newBusiness: "Nuova attività", nextPayout: "Idoneo al pagamento reale", noDate: "Nessun pagamento reale previsto", paid: "Pagamenti live verificati", payout: "CONTO PAGAMENTI", payoutBody: "Collega il conto per ricevere le commissioni idonee.", recentBusinesses: "Attività recenti", recentEarnings: "Guadagni recenti", renewal: "Rinnovo", setup: "Completa la configurazione del conto per i pagamenti", setupAction: "Completa configurazione", total: "Guadagni live verificati", viewEarnings: "Vedi guadagni e pagamenti", viewListing: "Vedi scheda", welcome: "Benvenuto", welcomeAgain: "Pronto a guadagnare altri €50?", waiting: "In attesa di pagamento", waitingBody: "Il titolare non ha ancora pagato.", yourEarnings: "I TUOI GUADAGNI" } } as const;

const overviewCopy = {
  en: { subtitle: "Here’s an overview of your commissions.", commissions: "YOUR COMMISSIONS", total: "Total earned", pending: "Pending (14-day hold)", available: "Available for payout", paid: "Paid out", noticeTitle: "Some commissions are pending", notice: "Each new business commission has a 14-day waiting period to allow for refunds. Once that period ends, and the payment remains valid, the commission may become eligible for payout if all other conditions are met.", learn: "Learn more about payouts", payout: "Payout account", breakdown: "Commission breakdown", initial: "New business (initial payment)", renewal: "Renewal (successful annual renewal)", earningsSubtitle: "Your latest commissions and their status.", viewAll: "View all earnings", business: "Business", type: "Type", commission: "Commission", paymentDate: "Payment date", refundPeriod: "Refund period", status: "Status", availableOn: "Available on", noHold: "No initial hold", holdEnded: "Hold ended", unknown: "—", dayOf: (days: number) => `${days} of 14 days` },
  it: { subtitle: "Ecco una panoramica delle tue commissioni.", commissions: "LE TUE COMMISSIONI", total: "Totale maturato", pending: "In attesa (14 giorni)", available: "Disponibile per il pagamento", paid: "Già pagato", noticeTitle: "Alcune commissioni sono in attesa", notice: "Ogni nuova commissione per un'attività ha un periodo di attesa di 14 giorni per consentire eventuali rimborsi. Trascorso questo periodo, se il pagamento resta valido, la commissione può diventare idonea al pagamento se sono soddisfatte anche le altre condizioni.", learn: "Scopri di più sui pagamenti", payout: "Conto per i pagamenti", breakdown: "Dettaglio commissioni", initial: "Nuova attività (primo pagamento)", renewal: "Rinnovo (rinnovo annuale riuscito)", earningsSubtitle: "Le tue ultime commissioni e il loro stato.", viewAll: "Vedi tutti i guadagni", business: "Attività", type: "Tipo", commission: "Commissione", paymentDate: "Data pagamento", refundPeriod: "Periodo rimborsi", status: "Stato", availableOn: "Disponibile dal", noHold: "Nessuna attesa iniziale", holdEnded: "Attesa terminata", unknown: "—", dayOf: (days: number) => `${days} di 14 giorni` },
} as const;

function formatDate(locale: Locale, value: Date) { return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", { dateStyle: "medium" }).format(value); }
function commissionKind(entry: DashboardCommission, locale: Locale) { const isInitial = entry.payment?.purpose === "INITIAL_MEMBERSHIP" || entry.sourceKey.startsWith("commission:submission:"); return { isInitial, label: isInitial ? copy[locale].newBusiness : copy[locale].renewal }; }

export function PartnerDashboard({ now, balances, commissionLedger, commissionRates, holdDays, locale, payoutsPaused, recentCommissions, payableCommissionIds, setup, submissions, totals, username }: Props) {
  const text = copy[locale];
  const overview = overviewCopy[locale];
  const firstName = username.trim().split(/\s+/)[0] || username;
  const setupReady = setup?.setupState === "ready" && Boolean(setup.payoutsEnabled);
  const submitted = submissions.length;
  const payableIds = new Set(payableCommissionIds);
  const ledger = submissions.flatMap((submission) => submission.partnerCommissions);
  const currentDate = new Date(now);
  // A display-only subset: the existing balance summary keeps its own financial definitions.
  const pendingHold = commissionLedger.reduce((sum, commission) =>
    commission.amountCents > 0 && getPartnerInitialHoldProgress(commission, currentDate, holdDays) &&
    !ledger.some((row) => row.type === "REVERSAL" && row.sourceKey === `commission:reversal:${commission.id}` && ["REVERSED", "DEBT"].includes(row.status))
      ? sum + commission.amountCents : sum, 0);
  return <div className={styles.page}>
    <PartnerWorkspaceNav active="dashboard" locale={locale} />
    <div className={`${styles.desktopNav} shell px-4 pt-5 sm:px-6`}><DashboardNav active="dashboard" draftCount={totals.drafts} locale={locale} role="GETTER" /></div>
    <main className={styles.main}>
      <section className={styles.welcome}>
        <div className={styles.welcomeCopy}><span className={styles.eyebrow}>{text.localPartner}</span><h1>{text.welcome}, {firstName}.</h1><h2>{overview.subtitle}</h2></div>
        <div className={styles.welcomeAction}><HardNavigationLink href="/publish" className={styles.primary}><span>+</span>{text.add}<IconArrowRight aria-hidden="true" size={19} /></HardNavigationLink><small><b>{formatCurrencyFromCents(commissionRates.initial, locale)}</b> {locale === "it" ? "quando un'attività aderisce, più" : "when a business joins, plus"} {formatCurrencyFromCents(commissionRates.renewal, locale)} {locale === "it" ? "a ogni rinnovo riuscito" : "on each successful renewal"}</small></div>
      </section>
      <div className={styles.dashboardGrid}>
        <section className={styles.earningsCard}>
          <div className={styles.commissionsHeading}><span className={styles.coinIcon}><IconCoin size={24} stroke={1.6} aria-hidden="true" /></span><span className={styles.eyebrow}>{overview.commissions}</span></div>
          <div className={styles.earningBreakdown}>
            <Earning label={overview.total} value={formatCurrencyFromCents(balances.totalEarned + pendingHold, locale)} />
            <Earning label={overview.pending} value={formatCurrencyFromCents(pendingHold, locale)} />
            <Earning label={overview.available} value={formatCurrencyFromCents(balances.available, locale)} />
            <Earning label={overview.paid} value={formatCurrencyFromCents(balances.paid, locale)} />
          </div>
          <div className={styles.holdNotice}><span className={styles.noticeIcon}><IconClock size={23} stroke={1.7} aria-hidden="true" /></span><div><strong>{overview.noticeTitle}</strong><p>{overview.notice}</p><HardNavigationLink href="/dashboard/earnings">{overview.learn}<IconArrowRight size={17} aria-hidden="true" /></HardNavigationLink></div></div>
        </section>
        <div className={styles.payoutColumn}>
          <section className={styles.payoutCard}><h2>{overview.payout}</h2>{setupReady ? <><div className={styles.payoutStatus}><IconCircleCheck aria-hidden="true" /><div><h3>{text.connected}</h3>{setup?.bankAccountLast4 ? <p>{setup.bankName ? `${setup.bankName} ` : ""}•••• {setup.bankAccountLast4}</p> : null}</div></div><HardNavigationLink href="/partner/payout" className={styles.ghostButton}>{locale === "it" ? "Gestisci pagamenti" : "Manage payouts"}<IconArrowRight aria-hidden="true" size={18} /></HardNavigationLink></> : <><div className={styles.payoutStatus}><span className={styles.payoutPending}>€</span><div><h3>{setup?.setupState === "setup-not-started" || !setup ? (locale === "it" ? "Preparati a ricevere i tuoi guadagni" : "Get ready to receive your earnings") : text.setup}</h3><p>{text.payoutBody}</p></div></div><PayoutAction locale={locale} label={setup?.setupState === "setup-not-started" || !setup ? text.connect : text.setupAction} /></>}</section>
          <section className={styles.breakdownCard}><h2>{overview.breakdown}</h2><p><strong>{formatCurrencyFromCents(commissionRates.initial, locale)}</strong><span>{overview.initial}</span></p><p><strong>{formatCurrencyFromCents(commissionRates.renewal, locale)}</strong><span>{overview.renewal}</span></p></section>
        </div>
        <aside className={styles.financialNote}>
          {payoutsPaused ? <span>{locale === "it" ? "Test in corso: i pagamenti reali ai Partner sono sospesi. " : "Testing in progress: real Partner payouts are paused. "}</span> : null}
          {locale === "it" ? "Le commissioni test e lo storico non verificato non sono pagabili." : "Test commissions and unverified history are not payable."}
          {" "}{locale === "it" ? "Test" : "Test"}: {formatCurrencyFromCents(balances.testActivity, locale)} · {locale === "it" ? "Storico non verificato" : "Unverified history"}: {formatCurrencyFromCents(balances.unverifiedActivity, locale)}
        </aside>
        <section className={styles.recentEarnings}>
          <div className={styles.recentHeader}><div><h2>{text.recentEarnings}</h2><p>{overview.earningsSubtitle}</p></div><HardNavigationLink href="/dashboard/earnings">{overview.viewAll}<IconArrowRight size={18} aria-hidden="true" /></HardNavigationLink></div>
          {recentCommissions.length ? <div className={styles.commissionList}><div className={styles.commissionHead}><span>{overview.business}</span><span>{overview.type}</span><span>{overview.commission}</span><span>{overview.paymentDate}</span><span>{overview.refundPeriod}</span><span>{overview.status}</span><span>{overview.availableOn}</span></div>{recentCommissions.map((commission) => <CommissionRow key={commission.id} entry={commission} holdDays={holdDays} locale={locale} ledger={ledger} now={currentDate} payableIds={payableIds} submissions={submissions} />)}</div> : <div className={styles.emptyEarnings}><IconCoin aria-hidden="true" size={25} /><p>{text.emptyEarnings}</p></div>}
        </section>
        <section className={styles.businessPanel}><SectionTitle eyebrow={locale === "it" ? "LE TUE ATTIVITÀ" : "YOUR BUSINESSES"} title={text.recentBusinesses} href="/dashboard/businesses" locale={locale} />{submissions.length ? <div className={styles.businessCards}>{submissions.slice(0, 4).map((submission) => <BusinessCard key={submission.id} entry={submission} locale={locale} now={now} payableIds={payableIds} />)}</div> : <EmptyBusinesses locale={locale} />}</section>
        <section className={styles.guide}><div><span className={styles.eyebrow}>{text.guide.toUpperCase()}</span><h2>{text.guideTitle}</h2><p>{text.guideBody}</p></div><div className={styles.guideTopics}><GuideTopic Icon={IconMessageCircle} label={locale === "it" ? "Cosa dire" : "What to say"} /><GuideTopic Icon={IconCamera} label={locale === "it" ? "Foto da fare" : "Photos to take"} /><GuideTopic Icon={IconCoin} label={locale === "it" ? "Come funziona il pagamento" : "How payment works"} /><GuideTopic Icon={IconUser} label={locale === "it" ? "Le tue commissioni" : "Your commissions"} /><GuideTopic Icon={IconFileText} label="FAQs" /></div><HardNavigationLink href="/partner/onboarding?guide=1" className={styles.primary}>{locale === "it" ? "Apri la guida Partner" : "Open partner guide"}<IconArrowRight aria-hidden="true" size={19} /></HardNavigationLink></section>
        <section className={styles.businessSummary}><SectionTitle eyebrow={locale === "it" ? "LE TUE ATTIVITÀ" : "YOUR BUSINESSES"} locale={locale} title={text.businesses} /><div className={styles.summaryStats}><SummaryStat label={locale === "it" ? "Totale" : "Total"} value={submitted} /><SummaryStat label={locale === "it" ? "Pubblicate" : "Published"} value={submissions.filter((entry) => entry.status === "PUBLISHED" && entry.paymentStatus === "PAID" && entry.createdBusiness?.slug && (!entry.createdBusiness.membership || (!entry.createdBusiness.membership.entitlementRevokedAt && new Date(entry.createdBusiness.membership.graceEndsAt).getTime() > new Date(now).getTime()))).length} accent="green" /><SummaryStat label={text.waiting} value={totals.awaitingPayment} accent="amber" /><SummaryStat label={text.drafts} value={totals.drafts} accent="gray" /></div><HardNavigationLink href="/dashboard/businesses" className={styles.ghostButton}>{text.allBusinesses}<IconArrowRight aria-hidden="true" size={18} /></HardNavigationLink></section>
      </div>
    </main>
  </div>;
}

function SectionTitle({ eyebrow, href, locale, title }: { eyebrow?: string; href?: string; locale: Locale; title: string }) { return <div className={styles.sectionTitle}><div>{eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}<h2>{title}</h2></div>{href ? <HardNavigationLink href={href}>{locale === "it" ? "Vedi tutte" : "View all"}<IconArrowRight aria-hidden="true" size={16} /></HardNavigationLink> : null}</div>; }
function PayoutAction({ label, locale }: { label: string; locale: Locale }) { return <form action={startPartnerPayoutSetupAction}><input type="hidden" name="locale" value={locale} /><input type="hidden" name="returnTo" value="/dashboard" /><button className={styles.ghostButton}>{label}<IconArrowRight aria-hidden="true" size={18} /></button></form>; }
function Earning({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function SummaryStat({ accent, label, value }: { accent?: "amber" | "gray" | "green"; label: string; value: number }) { return <div><strong>{accent ? <i className={`${styles.dot} ${styles[accent]}`} aria-hidden="true" /> : null}{value}</strong><span>{label}</span></div>; }
function GuideTopic({ Icon, label }: { Icon: typeof IconCamera; label: string }) { return <span><Icon aria-hidden="true" size={24} stroke={1.7} />{label}</span>; }
function EmptyBusinesses({ locale }: { locale: Locale }) { return <div className={styles.emptyBusinesses}><IconBuildingStore aria-hidden="true" size={38} /><div><h3>{copy[locale].first}</h3><p>{copy[locale].emptyBusinesses}</p></div><HardNavigationLink href="/publish" className={styles.primary}>{copy[locale].add}<IconArrowRight aria-hidden="true" size={18} /></HardNavigationLink></div>; }
function CommissionRow({ entry, holdDays, locale, ledger, now, payableIds, submissions }: { entry: Commission; holdDays: number; locale: Locale; ledger: DashboardCommission[]; now: Date; payableIds: ReadonlySet<string>; submissions: Submission[] }) {
  const overview = overviewCopy[locale];
  const kind = commissionKind(entry, locale);
  const financial = getPartnerCommissionDisplay(entry, ledger, payableIds, locale);
  const hold = financial.tone === "yellow" ? getPartnerInitialHoldProgress(entry, now, holdDays) : null;
  const submission = submissions.find((item) => item.id === entry.businessSubmissionId || item.createdBusiness?.id === entry.businessId);
  const photo = submission ? getBusinessPhotoUrls(submission.createdBusiness?.images || [], submission.photoUrls)[0] : null;
  const label = financial.label.split(" · ").slice(1).join(" · ");
  const paymentDate = entry.payment?.paidAt;
  const availableOn = hold ? new Date(Math.max(hold.holdEndsAt.getTime(), entry.eligibleAt?.getTime() ?? 0)) :
    financial.tone === "green" && entry.eligibleAt ? entry.eligibleAt : null;
  return <article className={styles.commissionRow}>
    <div className={styles.commissionBusiness}><span className={styles.commissionPhoto}>{photo ? <img src={photo} alt="" /> : <IconBuildingStore size={25} aria-hidden="true" />}</span><span><b>{entry.business?.name || entry.businessSubmission?.businessName || overview.unknown}</b><small>{submission?.town.name || ""}</small></span></div>
    <div className={styles.commissionType} data-label={overview.type}><span className={`${styles.badge} ${styles.new}`}>{kind.label}</span></div>
    <div className={styles.commissionAmount} data-label={overview.commission}>{formatCurrencyFromCents(entry.amountCents, locale)}</div>
    <div className={styles.commissionDate} data-label={overview.paymentDate}>{paymentDate ? formatDate(locale, paymentDate) : overview.unknown}</div>
    <div className={styles.commissionPeriod} data-label={overview.refundPeriod}>{hold ? <><span>{overview.dayOf(hold.days)}</span><span className={styles.progressTrack}><span style={{ width: `${hold.percent}%` }} /></span></> : kind.isInitial && paymentDate && now >= new Date(paymentDate.getTime() + holdDays * 86_400_000) && entry.payment?.stripeLivemode === true ? overview.holdEnded : kind.isInitial ? overview.unknown : overview.noHold}</div>
    <div className={styles.commissionStatus} data-label={overview.status}><span className={`${styles.financialStatus} ${styles[`financial${financial.tone}`]}`}>{label}</span></div>
    <div className={styles.commissionAvailable} data-label={overview.availableOn}>{availableOn ? formatDate(locale, availableOn) : overview.unknown}</div>
  </article>;
}
function BusinessCard({ entry, locale, now, payableIds }: { entry: Submission; locale: Locale; now: string; payableIds: ReadonlySet<string> }) {
  const text = copy[locale];
  const membership = entry.createdBusiness?.membership;
  const refunded = entry.paymentStatus === "REFUNDED" && Boolean(membership?.entitlementRevokedAt);
  const expired = Boolean(membership && !membership.entitlementRevokedAt && new Date(membership.graceEndsAt).getTime() <= new Date(now).getTime());
  const published = entry.status === "PUBLISHED" && entry.paymentStatus === "PAID" && Boolean(entry.createdBusiness?.slug) && !membership?.entitlementRevokedAt && !expired;
  const photo = getBusinessPhotoUrls(entry.createdBusiness?.images || [], entry.photoUrls)[0];
  const href = published ? `/businesses/${entry.createdBusiness?.slug}` : "/dashboard/businesses";
  const badge = refunded ? (locale === "it" ? "Rimborsata" : "Refunded") : expired ? (locale === "it" ? "Scaduta" : "Expired") : membership?.entitlementRevokedAt ? (locale === "it" ? "Inattiva" : "Inactive") : getSubmissionStatusLabel(entry.status, locale);
  const commissions = entry.partnerCommissions.filter((commission) => commission.type === "COMMISSION" && commission.amountCents > 0);
  return <article className={styles.businessCard}><div className={styles.photo}>{photo ? <img src={photo} alt={entry.createdBusiness?.images[0]?.alt || entry.businessName} /> : <IconBuildingStore aria-label={locale === "it" ? "Foto non disponibile" : "Photo unavailable"} size={34} />}</div><div className={styles.cardContent}><span className={`${styles.badge} ${published ? styles.published : styles.draft}`}>{badge}</span><h3>{entry.businessName}</h3><p><IconMapPin aria-hidden="true" size={15} />{entry.town.name}</p><div className={styles.financialStates}>{commissions.length ? commissions.map((commission) => {
    const financial = getPartnerCommissionDisplay(commission, entry.partnerCommissions, payableIds, locale);
    return <span key={commission.id} className={`${styles.financialStatus} ${styles[`financial${financial.tone}`]}`}>{commissionKind(commission, locale).label} · {financial.label}</span>;
  }) : <span className={`${styles.financialStatus} ${styles.financialyellow}`}>{locale === "it" ? "Commissione in sospeso" : "Commission on hold"}</span>}</div></div><div className={styles.cardActions}><HardNavigationLink href={href} className={styles.ghostButton}>{published ? text.viewListing : (locale === "it" ? "Vedi dettagli" : "See details")}<IconArrowRight aria-hidden="true" size={17} /></HardNavigationLink>{published ? <PartnerOwnerAccess locale={locale} submissionId={entry.id} /> : null}</div></article>;
}
