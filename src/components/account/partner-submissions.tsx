"use client";

import { type ReactNode, useMemo, useState } from "react";
import {
  IconArrowRight,
  IconBuildingStore,
  IconBulb,
  IconChevronDown,
  IconFileDescription,
  IconMapPin,
  IconSearch,
} from "@tabler/icons-react";

import { DraftDeleteButton } from "@/components/account/draft-delete-button";
import { PartnerOwnerAccess } from "@/components/account/partner-owner-access";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { formatCurrencyFromCents, getPaymentStatusLabel, getSubmissionStatusLabel } from "@/lib/account";
import { getBusinessPhotoUrls } from "@/lib/business-photos";
import type { Locale } from "@/lib/i18n";

import styles from "./partner-submissions.module.css";

type Commission = {
  amountCents: number;
  eligibleAt: Date | null;
  payment: { status: string; refundRequestedAt: Date | null; refundStatus?: string | null } | null;
  sourceKey: string;
  status: "PENDING" | "AVAILABLE" | "RESERVED" | "PAID" | "REVERSED" | "DEBT";
  type: "COMMISSION" | "REVERSAL" | "ADJUSTMENT";
};

type Submission = {
  addressPlaceId: string | null;
  businessName: string;
  category: { name: string };
  createdAt: Date;
  createdBusiness: { images: { alt: string; url: string }[]; slug: string; membership: { entitlementRevokedAt: Date | null; graceEndsAt: Date } | null } | null;
  id: string;
  longDescription: string;
  openingHours: string;
  ownerEmail: string;
  ownerHasNoEmail: boolean;
  ownerName: string;
  ownerPhone: string;
  paymentStatus: "NOT_REQUIRED" | "PENDING_PAYMENT" | "AWAITING_BANK_TRANSFER" | "PAID" | "FAILED" | "REFUNDED";
  phone: string;
  photoUrls: unknown;
  status: Parameters<typeof getSubmissionStatusLabel>[0];
  town: { name: string };
  updatedAt: Date;
  partnerCommissions: Commission[];
};

type Props = { drafts: Submission[]; locale: Locale; now: string; submissions: Submission[] };

const copy = {
  en: {
    add: "Add business",
    addBody: "Know a great local business that's not on Salento Local yet? Add a new listing and earn €50 when they join.",
    addTitle: "Find more businesses",
    all: "All",
    continue: "Continue editing",
    continueBody: "Finish this listing to continue the owner handoff process.",
    continueTitle: "Continue where you left off",
    details: "Details",
    draft: "Draft",
    drafts: "Drafts",
    draftsBody: "Saved drafts appear here first so you can jump back in quickly.",
    earnings: "Your earnings",
    earned: "earned",
    empty: "No submitted listings match these filters.",
    headerBody: "Manage your business listings, drafts and track their progress.",
    initialCommission: "Initial commission",
    lastUpdated: "Last updated",
    ownerPayment: "Owner payment",
    pending: "pending",
    paymentPaid: "Paid",
    progress: "Progress",
    renewalCommission: "Renewal / reactivation",
    search: "Search your submissions...",
    submitted: "Submitted",
    submittedBody: "All the businesses you've submitted and their current status.",
    submittedListings: "Submitted listings",
    title: "My submissions",
    viewDetails: "View details",
    viewListing: "View listing",
  },
  it: {
    add: "Aggiungi attività",
    addBody: "Conosci una bella attività locale che non è ancora su Salento Local? Aggiungi una scheda e guadagna €50 quando aderisce.",
    addTitle: "Trova altre attività",
    all: "Tutte",
    continue: "Continua la modifica",
    continueBody: "Completa questa scheda per proseguire con il passaggio al titolare.",
    continueTitle: "Riprendi da dove eri rimasto",
    details: "Dettagli",
    draft: "Bozza",
    drafts: "Bozze",
    draftsBody: "Le bozze salvate compaiono qui per prime, così puoi riprendere subito il lavoro.",
    earnings: "I tuoi guadagni",
    earned: "guadagnati",
    empty: "Nessuna scheda inviata corrisponde a questi filtri.",
    headerBody: "Gestisci le tue schede attività, le bozze e segui i loro progressi.",
    initialCommission: "Commissione iniziale",
    lastUpdated: "Ultimo aggiornamento",
    ownerPayment: "Pagamento titolare",
    pending: "in attesa",
    paymentPaid: "Pagato",
    progress: "Progresso",
    renewalCommission: "Rinnovo / riattivazione",
    search: "Cerca tra le tue segnalazioni...",
    submitted: "Inviata",
    submittedBody: "Tutte le attività che hai inviato e il loro stato attuale.",
    submittedListings: "Schede inviate",
    title: "Le mie segnalazioni",
    viewDetails: "Vedi dettagli",
    viewListing: "Vedi scheda",
  },
} as const;

function formatDate(value: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", { dateStyle: "medium" }).format(value);
}

function draftProgress(submission: Submission, locale: Locale) {
  const names = locale === "it"
    ? ["Attività", "Contatti", "Titolare", "Descrizione", "Orari", "Foto"]
    : ["Business details", "Contact", "Owner", "About", "Hours", "Photos"];
  const offerCount = submission.longDescription
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^(notes collected on site|punti raccolti sul posto):$/i.test(line)).length;
  const hasHours = (() => {
    try {
      const value = JSON.parse(submission.openingHours) as Array<{ closed?: boolean; open1?: string; close1?: string }>;
      return Array.isArray(value) && value.some((day) => day.closed || Boolean(day.open1 && day.close1));
    } catch { return false; }
  })();
  const photoCount = getBusinessPhotoUrls([], submission.photoUrls).length;
  const checks = [
    Boolean(submission.businessName && submission.category && submission.addressPlaceId && submission.town),
    Boolean(submission.phone),
    Boolean(submission.ownerName && submission.ownerPhone && (submission.ownerEmail || submission.ownerHasNoEmail)),
    offerCount >= 2,
    hasHours,
    photoCount >= 2,
  ];
  const current = Math.min(checks.findIndex((ready) => !ready) + 1 || 6, 6);
  return { current, label: names[current - 1], percentage: Math.round((current / 6) * 100) };
}

function statusTone(status: Submission["status"]) {
  if (status === "PUBLISHED") return styles.published;
  if (status === "REJECTED" || status === "NEEDS_REVIEW") return styles.neutral;
  return styles.waiting;
}

function paymentDisplay(submission: Submission, locale: Locale) {
  const paid = submission.paymentStatus === "PAID";
  return { label: paid ? copy[locale].paymentPaid : getPaymentStatusLabel(submission.paymentStatus, locale), paid };
}

function commissionDisplay(submission: Submission, locale: Locale, now: string) {
  const initial = submission.partnerCommissions.filter((entry) => (entry.sourceKey === `commission:submission:${submission.id}` || entry.sourceKey.startsWith("commission:refund-repurchase:")) && entry.type === "COMMISSION");
  const commission = initial.find((entry) => entry.status !== "REVERSED" && entry.status !== "DEBT");
  if (!commission) return { label: initial.some((entry) => entry.status === "REVERSED") ? `${formatCurrencyFromCents(5000, locale)} ${locale === "it" ? "annullata" : "canceled"}` : "—", tone: styles.mutedEarning };
  const unresolvedRefund = Boolean(commission.payment?.refundRequestedAt && commission.payment?.refundStatus !== "support_closed");
  const settled = commission.status === "RESERVED" || commission.status === "PAID" || Boolean(!unresolvedRefund && commission.payment?.status === "PAID" && commission.eligibleAt && new Date(commission.eligibleAt).getTime() <= new Date(now).getTime());
  return {
    label: unresolvedRefund ? `${formatCurrencyFromCents(commission.amountCents, locale)} · ${locale === "it" ? "Richiesta di rimborso in sospeso" : "Refund request pending"}` : `${formatCurrencyFromCents(commission.amountCents, locale)} ${settled ? copy[locale].earned : copy[locale].pending}`,
    tone: settled ? styles.earned : styles.pendingEarning,
  };
}

function renewalCommissionDisplay(submission: Submission, locale: Locale) {
  const commissions = submission.partnerCommissions.filter((entry) => entry.sourceKey.startsWith("commission:renewal:") && entry.type === "COMMISSION" && entry.status !== "REVERSED" && entry.status !== "DEBT");
  if (!commissions.length) return "—";
  const total = commissions.reduce((sum, entry) => sum + entry.amountCents, 0);
  const settled = commissions.every((entry) => entry.status === "AVAILABLE" || entry.status === "RESERVED" || entry.status === "PAID");
  return `${formatCurrencyFromCents(total, locale)} ${settled ? copy[locale].earned : copy[locale].pending}`;
}

function SubmissionThumbnail({ locale, submission }: { locale: Locale; submission: Submission }) {
  const photos = getBusinessPhotoUrls(submission.createdBusiness?.images ?? [], submission.photoUrls);
  return <div className={styles.thumbnail}>{photos[0] ? <img src={photos[0]} alt={submission.createdBusiness?.images[0]?.alt || submission.businessName} /> : <IconBuildingStore aria-label={locale === "it" ? "Foto non disponibile" : "Photo unavailable"} size={30} />}</div>;
}

export function PartnerSubmissions({ drafts, locale, now, submissions }: Props) {
  const text = copy[locale];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [openDetails, setOpenDetails] = useState<string | null>(null);
  const statusOptions = useMemo(() => Array.from(new Set(submissions.map((entry) => entry.status))), [submissions]);
  const filtered = useMemo(() => submissions.filter((entry) => {
    const words = `${entry.businessName} ${entry.category.name} ${entry.town.name}`.toLocaleLowerCase();
    return words.includes(query.trim().toLocaleLowerCase()) && (status === "ALL" || entry.status === status);
  }), [query, status, submissions]);

  return <main className={`${styles.page} shell px-4 pb-16 pt-10 sm:px-6 sm:pt-12`}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>{locale === "it" ? "ATTIVITÀ INVIATE" : "SUBMITTED BUSINESSES"}</p>
      <h1>{text.title}</h1>
      <p>{text.headerBody}</p>
    </header>

    {drafts.length ? <section className={styles.drafts} id="drafts">
      <div className={styles.sectionHead}>
        <div><h2>{text.drafts} <span className={styles.count}>{drafts.length}</span></h2><p>{text.draftsBody}</p></div>
      </div>
      <div className={styles.draftList}>{drafts.map((submission) => <DraftCard key={submission.id} locale={locale} submission={submission} />)}</div>
    </section> : null}

    <section className={styles.submitted}>
      <div className={styles.submissionHeading}>
        <div><h2>{text.submittedListings}</h2><p>{text.submittedBody}</p></div>
        <div className={styles.controls}>
          <label className={styles.search}><IconSearch aria-hidden="true" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} type="search" /></label>
          <label className={styles.filter}><span>{locale === "it" ? "Stato" : "Status"}:</span><select aria-label={locale === "it" ? "Filtra per stato" : "Filter by status"} value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">{text.all}</option>{statusOptions.map((entry) => <option key={entry} value={entry}>{getSubmissionStatusLabel(entry, locale)}</option>)}</select><IconChevronDown aria-hidden="true" size={17} /></label>
        </div>
      </div>
      <div className={styles.cards}>{filtered.length ? filtered.map((submission) => <SubmittedCard expanded={openDetails === submission.id} key={submission.id} locale={locale} now={now} onToggleDetails={() => setOpenDetails(openDetails === submission.id ? null : submission.id)} submission={submission} />) : <p className={styles.empty}>{text.empty}</p>}</div>
      <aside className={styles.addCard}><span><IconBulb aria-hidden="true" size={25} /></span><div><h3>{text.addTitle}</h3><p>{text.addBody}</p></div><HardNavigationLink href="/publish" className={styles.addButton}>+ {text.add}</HardNavigationLink></aside>
    </section>
  </main>;
}

function DraftCard({ locale, submission }: { locale: Locale; submission: Submission }) {
  const text = copy[locale]; const progress = draftProgress(submission, locale);
  return <article className={styles.draftCard}>
    <SubmissionThumbnail locale={locale} submission={submission} />
    <div className={styles.draftInfo}><div className={styles.draftTitle}><div><h3>{submission.businessName}</h3><p>{submission.category.name} <span>·</span> {submission.town.name}</p></div><span className={`${styles.badge} ${styles.draftBadge}`}>{text.draft}</span></div><div className={styles.draftMeta}><div><p className={styles.metaLabel}>{text.progress}</p><strong>{locale === "it" ? `Passaggio ${progress.current} di 6` : `Step ${progress.current} of 6`}</strong><div className={styles.progress}><i style={{ width: `${progress.percentage}%` }} /></div></div><div><p className={styles.metaLabel}>{text.lastUpdated}</p><strong>{formatDate(submission.updatedAt, locale)}</strong><small>{progress.label}</small></div></div></div>
    <div className={styles.draftActions}><div className={styles.resume}><span><IconFileDescription aria-hidden="true" size={23} /></span><div><strong>{text.continueTitle}</strong><p>{text.continueBody}</p></div></div><div><HardNavigationLink href={`/publish?submission=${encodeURIComponent(submission.id)}`} className={styles.primary}>{text.continue}<IconArrowRight aria-hidden="true" size={18} /></HardNavigationLink><span className={styles.deleteButton}><DraftDeleteButton businessName={submission.businessName} locale={locale} submissionId={submission.id} /></span></div></div>
  </article>;
}

function SubmittedCard({ expanded, locale, now, onToggleDetails, submission }: { expanded: boolean; locale: Locale; now: string; onToggleDetails: () => void; submission: Submission }) {
  const text = copy[locale]; const payment = paymentDisplay(submission, locale); const earnings = commissionDisplay(submission, locale, now);
  const membership = submission.createdBusiness?.membership;
  const refunded = submission.paymentStatus === "REFUNDED" && Boolean(membership?.entitlementRevokedAt);
  const expired = Boolean(membership && !membership.entitlementRevokedAt && new Date(membership.graceEndsAt).getTime() <= new Date(now).getTime());
  const published = submission.status === "PUBLISHED" && submission.paymentStatus === "PAID" && Boolean(submission.createdBusiness?.slug) && !refunded && !expired;
  const listingStatus = refunded ? (locale === "it" ? "Rimborsata · scheda inattiva" : "Refunded · listing inactive") : expired ? (locale === "it" ? "Scaduta · scheda inattiva" : "Expired · listing inactive") : getSubmissionStatusLabel(submission.status, locale);
  return <article className={styles.submissionCard}>
    <SubmissionThumbnail locale={locale} submission={submission} />
    <div className={styles.listingInfo}><h3>{submission.businessName}</h3><p><IconMapPin aria-hidden="true" size={15} />{submission.category.name} <span>·</span> {submission.town.name}</p></div>
    <div className={styles.infoGroups}><InfoGroup label={text.submitted}>{formatDate(submission.createdAt, locale)}</InfoGroup><InfoGroup label={text.ownerPayment}><span className={payment.paid ? styles.paid : styles.paymentPending}><i />{payment.label}</span></InfoGroup><InfoGroup label={text.earnings}><span className={earnings.tone}>{earnings.label}</span></InfoGroup></div>
    <div className={styles.listingActions}><span className={`${styles.badge} ${refunded || expired ? styles.neutral : statusTone(submission.status)}`}>{listingStatus}</span>{published ? <HardNavigationLink href={`/businesses/${submission.createdBusiness?.slug}`} className={styles.primary}>{text.viewListing}<IconArrowRight aria-hidden="true" size={18} /></HardNavigationLink> : <button type="button" className={styles.primary} onClick={onToggleDetails}>{text.viewDetails}<IconArrowRight aria-hidden="true" size={18} /></button>}<button type="button" aria-expanded={expanded} className={styles.secondary} onClick={onToggleDetails}><IconFileDescription aria-hidden="true" size={17} />{text.details}</button>{published ? <div className={styles.ownerAccess}><PartnerOwnerAccess locale={locale} submissionId={submission.id} /></div> : null}</div>
    {expanded ? <div className={styles.details}><InfoGroup label={text.submitted}>{formatDate(submission.createdAt, locale)}</InfoGroup><InfoGroup label={text.ownerPayment}>{payment.label}</InfoGroup><InfoGroup label={text.initialCommission}>{earnings.label}</InfoGroup><InfoGroup label={text.renewalCommission}>{renewalCommissionDisplay(submission, locale)}</InfoGroup><InfoGroup label={locale === "it" ? "Pubblicazione" : "Publication"}>{getSubmissionStatusLabel(submission.status, locale)}</InfoGroup></div> : null}
  </article>;
}

function InfoGroup({ children, label }: { children: ReactNode; label: string }) { return <div><p className={styles.metaLabel}>{label}</p><strong>{children}</strong></div>; }
