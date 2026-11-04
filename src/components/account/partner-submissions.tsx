"use client";

import { type ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PaymentMethod } from "@prisma/client";
import {
  IconArrowRight,
  IconBuildingStore,
  IconBulb,
  IconChevronDown,
  IconFileDescription,
  IconMapPin,
  IconBrandWhatsapp,
  IconCircleCheck,
  IconClock,
  IconMail,
  IconSearch,
} from "@tabler/icons-react";

import { DraftDeleteButton } from "@/components/account/draft-delete-button";
import { PartnerOwnerAccess } from "@/components/account/partner-owner-access";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { formatCurrencyFromCents, getPaymentStatusLabel, getSubmissionStatusLabel } from "@/lib/account";
import { getBusinessPhotoUrls } from "@/lib/business-photos";
import type { Locale } from "@/lib/i18n";
import { isAwaitingPartnerPayment } from "@/lib/partner-submission-groups";

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
  paymentMethod: PaymentMethod | null;
  payLaterInvitation: {
    id: string; recipientEmail: string; ownerPhone: string | null;
    tokenGeneration: number; emailAcceptedGeneration: number | null;
    emailAcceptedAt: Date | null; emailAttemptedAt: Date | null;
    emailFailureMessage: string | null; verifiedAt: Date | null;
    completedAt: Date | null; declinedAt: Date | null; revokedAt: Date | null;
    remindersStoppedAt: Date | null; tokenExpiresAt: Date; whatsappPreparedAt: Date | null;
    reminders: { acceptedAt: Date | null }[];
  } | null;
  paymentStatus: "NOT_REQUIRED" | "PENDING_PAYMENT" | "AWAITING_BANK_TRANSFER" | "PAID" | "FAILED" | "REFUNDED";
  phone: string;
  photoUrls: unknown;
  status: Parameters<typeof getSubmissionStatusLabel>[0];
  town: { name: string };
  updatedAt: Date;
  partnerCommissions: Commission[];
};

type Props = { drafts: Submission[]; locale: Locale; now: string; payLaterEnabled?: boolean; submissions: Submission[] };

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
    awaiting: "Awaiting payment",
    awaitingBody: "Listings ready, waiting for the owner's payment.",
    awaitingShort: "Awaiting payment",
    ownerAction: "Owner action needed",
    unfinished: "Unfinished drafts",
    unfinishedBody: "Listings you're still working on.",
    unfinishedHint: "Continue editing your listings",
    published: "Published listings",
    publishedHint: "Live on Salento Local",
    noAwaiting: "No listings are awaiting owner payment.",
    noDrafts: "No unfinished drafts yet.",
    potentialCommission: "Potential commission: €50 · not earned",
    lastInvitation: "Last invitation/reminder",
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
    awaiting: "In attesa di pagamento",
    awaitingBody: "Schede pronte, in attesa del pagamento del titolare.",
    awaitingShort: "In attesa di pagamento",
    ownerAction: "Azione del titolare necessaria",
    unfinished: "Bozze incomplete",
    unfinishedBody: "Schede su cui stai ancora lavorando.",
    unfinishedHint: "Continua a modificare le tue schede",
    published: "Schede pubblicate",
    publishedHint: "Visibili su Salento Local",
    noAwaiting: "Nessuna scheda in attesa del pagamento del titolare.",
    noDrafts: "Non ci sono bozze incomplete.",
    potentialCommission: "Commissione potenziale: €50 · non maturata",
    lastInvitation: "Ultimo invio/promemoria",
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
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", { dateStyle: "medium", timeZone: "Europe/Rome" }).format(value);
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
  if (!commission) return { label: initial.some((entry) => entry.status === "REVERSED") ? `${formatCurrencyFromCents(5000, locale)} ${locale === "it" ? "annullata" : "canceled"}` : submission.payLaterInvitation && !submission.payLaterInvitation.revokedAt && !submission.payLaterInvitation.declinedAt && !submission.payLaterInvitation.completedAt ? `${formatCurrencyFromCents(5000, locale)} ${locale === "it" ? "potenziale" : "potential"}` : "—", tone: styles.mutedEarning };
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

function payLaterStatus(submission: Submission, locale: Locale, now = new Date()) {
  const invitation = submission.payLaterInvitation;
  if (!invitation) return "";
  const it = locale === "it";
  if (invitation.completedAt || submission.paymentStatus === "PAID") return it ? "Completato · pagamento confermato" : "Completed · payment confirmed";
  if (invitation.declinedAt) return it ? "Invito rifiutato" : "Invitation declined";
  if (invitation.revokedAt) return it ? "Invito revocato" : "Invitation revoked";
  if (submission.paymentMethod === "BANK_TRANSFER") return it ? "In attesa del bonifico" : "Awaiting bank transfer";
  if (submission.paymentMethod === "ONLINE") return it ? "In attesa di pagamento" : "Awaiting payment";
  if (invitation.tokenExpiresAt <= now) return it ? "Invito scaduto" : "Invitation expired";
  if (invitation.emailAcceptedGeneration !== invitation.tokenGeneration) return invitation.emailAttemptedAt
    ? it ? "Invio email in attesa di nuovo tentativo" : "Email awaiting retry"
    : it ? "Invito preparato" : "Invitation prepared";
  if (invitation.verifiedAt) return it ? "Titolare in corso · in attesa di pagamento" : "Owner in progress · awaiting payment";
  return it ? "Email accettata · in attesa della verifica" : "Email accepted · awaiting verification";
}

function PayLaterDashboardActions({ enabled, locale, submission }: { enabled: boolean; locale: Locale; submission: Submission }) {
  const router = useRouter();
  const invitation = submission.payLaterInvitation;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!invitation) return null;
  const it = locale === "it";
  const active = !invitation.revokedAt && !invitation.declinedAt && !invitation.completedAt;
  const editable = enabled && active && !submission.paymentMethod && submission.status === "DRAFT";
  const canShare = enabled && active && Boolean(invitation.ownerPhone) &&
    invitation.emailAcceptedGeneration === invitation.tokenGeneration &&
    invitation.tokenExpiresAt > new Date();
  const lastInvitationAt = invitation.reminders[0]?.acceptedAt ?? invitation.emailAcceptedAt ?? invitation.emailAttemptedAt;
  async function act(mode: "email" | "share" | "revoke") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/pay-later/invitations", { method: "POST",
        headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ submissionId: submission.id, mode, locale }) });
      const result = await response.json() as { email?: string; whatsappUrl?: string; error?: string };
      if (!response.ok && response.status !== 202) throw new Error(result.error || "unavailable");
      if (mode === "share" && result.whatsappUrl) window.open(result.whatsappUrl, "_blank", "noopener,noreferrer");
      else if (mode === "revoke") router.push(`/publish?submission=${encodeURIComponent(submission.id)}`);
      else window.location.reload();
    } catch (caught) { setError(caught instanceof Error && caught.message === "cooldown"
      ? it ? "Attendi prima di riprovare." : "Wait before trying again."
      : it ? "Operazione non riuscita. Riprova più tardi." : "Action failed. Try again later."); }
    finally { setBusy(false); }
  }
  return <div className={styles.invitationActions}>
    {editable ? <button type="button" disabled={busy} onClick={() => act("email")} className={styles.secondary}><IconMail aria-hidden="true" size={17} />{it ? "Reinvia invito" : "Resend invitation"}</button> : null}
    {canShare ? <button type="button" disabled={busy} onClick={() => act("share")} className={styles.secondary}><IconBrandWhatsapp aria-hidden="true" size={17} />{it ? "Condividi su WhatsApp" : "Share on WhatsApp"}</button> : null}
    <details className={styles.invitationDetails}><summary className={styles.primary}>{it ? "Vedi dettagli" : "View details"}<IconArrowRight aria-hidden="true" size={18} /></summary>
      <div className={styles.invitationDetailBody}>
        <p className={styles.invitationStatus}>{payLaterStatus(submission, locale)}</p>
        <p className={styles.breakText}>Email: {invitation.recipientEmail}</p>
        <p>{lastInvitationAt ? copy[locale].lastInvitation : copy[locale].lastUpdated}: {formatDate(lastInvitationAt ?? submission.updatedAt, locale)}</p>
        {active ? <p>{copy[locale].potentialCommission}</p> : null}
        <p className={styles.breakText}>{submission.businessName} · {submission.town.name}<br />{submission.ownerName}<br />{submission.longDescription}</p>
        {editable ? <button type="button" disabled={busy} onClick={() => act("revoke")} className={styles.secondary}>{it ? "Correggi scheda e reinvia" : "Correct listing and resend"}</button> : null}
      </div>
    </details>
    {error ? <p role="alert" className={styles.actionError}>{error}</p> : null}
  </div>;
}

function isPublishedListing(submission: Submission, now: string) {
  const membership = submission.createdBusiness?.membership;
  const refunded = submission.paymentStatus === "REFUNDED" && Boolean(membership?.entitlementRevokedAt);
  const expired = Boolean(membership && !membership.entitlementRevokedAt && new Date(membership.graceEndsAt).getTime() <= new Date(now).getTime());
  return submission.status === "PUBLISHED" && submission.paymentStatus === "PAID" && Boolean(submission.createdBusiness?.slug) && !refunded && !expired;
}

export function PartnerSubmissions({ drafts, locale, now, payLaterEnabled = false, submissions }: Props) {
  const text = copy[locale];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [openDetails, setOpenDetails] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"awaiting" | "drafts">(() => drafts.some(isAwaitingPartnerPayment) ? "awaiting" : "drafts");
  const awaiting = useMemo(() => drafts.filter(isAwaitingPartnerPayment), [drafts]);
  const unfinished = useMemo(() => drafts.filter((entry) => !isAwaitingPartnerPayment(entry)), [drafts]);
  const publishedCount = useMemo(() => submissions.filter((entry) => isPublishedListing(entry, now)).length, [submissions, now]);
  const statusOptions = useMemo(() => Array.from(new Set(submissions.map((entry) => entry.status))), [submissions]);
  const filtered = useMemo(() => submissions.filter((entry) => {
    const words = `${entry.businessName} ${entry.category.name} ${entry.town.name}`.toLocaleLowerCase();
    return words.includes(query.trim().toLocaleLowerCase()) && (status === "ALL" || entry.status === status);
  }), [query, status, submissions]);
  const tabs = [{ id: "awaiting" as const, label: text.awaitingShort, count: awaiting.length }, { id: "drafts" as const, label: text.drafts, count: unfinished.length }];

  return <main className={`${styles.page} shell px-4 pb-16 pt-10 sm:px-6 sm:pt-12`}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>{locale === "it" ? "ATTIVITÀ INVIATE" : "SUBMITTED BUSINESSES"}</p>
      <h1>{text.title}</h1>
      <p>{text.headerBody}</p>
    </header>

    <div className={styles.summary} aria-label={locale === "it" ? "Riepilogo delle schede" : "Listing summary"}>
      <SummaryCard icon={<IconClock aria-hidden="true" size={30} />} count={awaiting.length} label={text.awaiting} hint={text.ownerAction} tone="payment" />
      <SummaryCard icon={<IconFileDescription aria-hidden="true" size={30} />} count={unfinished.length} label={text.unfinished} mobileLabel={text.drafts} hint={text.unfinishedHint} tone="draft" />
      <SummaryCard icon={<IconCircleCheck aria-hidden="true" size={30} />} count={publishedCount} label={text.published} mobileLabel={locale === "it" ? "Pubblicate" : "Published"} hint={text.publishedHint} tone="published" />
    </div>

    <div className={styles.mobileTabs} role="tablist" aria-label={locale === "it" ? "Tipi di bozze" : "Draft categories"}>
      {tabs.map((tab, index) => <button key={tab.id} id={`partner-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`partner-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} className={activeTab === tab.id ? styles.selectedTab : ""} onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].id;
        setActiveTab(next);
        document.getElementById(`partner-tab-${next}`)?.focus();
      }}>{tab.label} ({tab.count})</button>)}
    </div>

    <div className={styles.workspace}>
      <section id="partner-panel-awaiting" role="tabpanel" aria-labelledby="partner-tab-awaiting" className={`${styles.workspacePanel} ${activeTab !== "awaiting" ? styles.mobileInactive : ""}`}>
        <div className={styles.workspaceHead}><span className={`${styles.headIcon} ${styles.paymentIcon}`}><IconClock aria-hidden="true" size={28} /></span><div><h2>{text.awaiting} ({awaiting.length})</h2><p>{text.awaitingBody}</p></div></div>
        <div className={styles.workspaceList}>{awaiting.length ? awaiting.map((submission) => <DraftCard key={submission.id} kind="awaiting" locale={locale} payLaterEnabled={payLaterEnabled} submission={submission} />) : <p className={styles.empty}>{text.noAwaiting}</p>}</div>
      </section>
      <section id="partner-panel-drafts" role="tabpanel" aria-labelledby="partner-tab-drafts" className={`${styles.workspacePanel} ${activeTab !== "drafts" ? styles.mobileInactive : ""}`}>
        <div className={styles.workspaceHead}><span className={`${styles.headIcon} ${styles.draftIcon}`}><IconFileDescription aria-hidden="true" size={28} /></span><div><h2>{text.unfinished} ({unfinished.length})</h2><p>{text.unfinishedBody}</p></div></div>
        <div className={styles.workspaceList}>{unfinished.length ? unfinished.map((submission) => <DraftCard key={submission.id} kind="draft" locale={locale} payLaterEnabled={payLaterEnabled} submission={submission} />) : <p className={styles.empty}>{text.noDrafts}</p>}</div>
      </section>
    </div>

    <section className={styles.submitted}>
      <div className={styles.submissionHeading}>
        <div><h2>{text.submittedListings}</h2><p>{text.submittedBody}</p></div>
        <div className={styles.controls}>
          <label className={styles.search}><IconSearch aria-hidden="true" size={18} /><input aria-label={text.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} type="search" /></label>
          <label className={styles.filter}><span>{locale === "it" ? "Stato" : "Status"}:</span><select aria-label={locale === "it" ? "Filtra per stato" : "Filter by status"} value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">{text.all}</option>{statusOptions.map((entry) => <option key={entry} value={entry}>{getSubmissionStatusLabel(entry, locale)}</option>)}</select><IconChevronDown aria-hidden="true" size={17} /></label>
        </div>
      </div>
      <div className={styles.cards}>{filtered.length ? filtered.map((submission) => <SubmittedCard expanded={openDetails === submission.id} key={submission.id} locale={locale} now={now} onToggleDetails={() => setOpenDetails(openDetails === submission.id ? null : submission.id)} submission={submission} />) : <p className={styles.empty}>{text.empty}</p>}</div>
      <aside className={styles.addCard}><span><IconBulb aria-hidden="true" size={25} /></span><div><h3>{text.addTitle}</h3><p>{text.addBody}</p></div><HardNavigationLink href="/publish" className={styles.addButton}>+ {text.add}</HardNavigationLink></aside>
    </section>
  </main>;
}

function SummaryCard({ icon, count, label, mobileLabel, hint, tone }: { icon: ReactNode; count: number; label: string; mobileLabel?: string; hint: string; tone: "payment" | "draft" | "published" }) {
  return <div className={`${styles.summaryCard} ${styles[tone]}`}><span className={styles.summaryIcon}>{icon}</span><div><strong>{count}</strong><p><span className={styles.fullLabel}>{label}</span><span className={styles.shortLabel}>{mobileLabel ?? label}</span></p><small>{hint}</small></div></div>;
}

function DraftCard({ kind, locale, payLaterEnabled, submission }: { kind: "awaiting" | "draft"; locale: Locale; payLaterEnabled: boolean; submission: Submission }) {
  const text = copy[locale];
  const progress = draftProgress(submission, locale);
  const invitation = submission.payLaterInvitation;
  const activeInvitation = Boolean(invitation && !invitation.revokedAt && !invitation.declinedAt && !invitation.completedAt);
  const sentAt = invitation?.reminders[0]?.acceptedAt ?? invitation?.emailAcceptedAt ?? invitation?.emailAttemptedAt;
  const invitationDate = sentAt ?? submission.updatedAt;
  const badge = kind === "awaiting" ? (invitation ? payLaterStatus(submission, locale) : getPaymentStatusLabel(submission.paymentStatus, locale)) : text.draft;
  return <article className={styles.draftCard}>
    <SubmissionThumbnail locale={locale} submission={submission} />
    <div className={styles.draftInfo}>
      <div className={styles.draftTitle}><div><h3>{submission.businessName}</h3><p>{submission.category.name} <span>·</span> {submission.town.name}</p></div><span className={`${styles.badge} ${styles.draftBadge}`}>{badge}</span></div>
      {kind === "awaiting" ? <div className={styles.awaitingMeta}>
        {activeInvitation ? <strong>{text.potentialCommission}</strong> : null}
        <p>{sentAt ? text.lastInvitation : text.lastUpdated}: {formatDate(invitationDate, locale)}</p>
      </div> : <div className={styles.draftMeta}><div><strong>{locale === "it" ? `Passaggio ${progress.current} di 6` : `Step ${progress.current} of 6`}</strong><div className={styles.progress}><i style={{ width: `${progress.percentage}%` }} /></div></div><p>{text.lastUpdated}: {formatDate(submission.updatedAt, locale)}</p></div>}
      {invitation ? <PayLaterDashboardActions enabled={payLaterEnabled} locale={locale} submission={submission} /> : null}
      {kind === "awaiting" && !invitation ? <details className={styles.invitationDetails}><summary className={styles.primary}>{text.viewDetails}<IconArrowRight aria-hidden="true" size={18} /></summary><div className={styles.invitationDetailBody}><p>{badge}</p><p>{submission.ownerName} · {submission.town.name}</p><p className={styles.breakText}>{submission.longDescription}</p></div></details> : null}
      {!activeInvitation ? <div className={styles.draftActions}><HardNavigationLink href={`/publish?submission=${encodeURIComponent(submission.id)}`} className={styles.primary}>{text.continue}<IconArrowRight aria-hidden="true" size={18} /></HardNavigationLink><span className={styles.deleteButton}><DraftDeleteButton businessName={submission.businessName} locale={locale} submissionId={submission.id} /></span></div> : null}
    </div>
  </article>;
}

function SubmittedCard({ expanded, locale, now, onToggleDetails, submission }: { expanded: boolean; locale: Locale; now: string; onToggleDetails: () => void; submission: Submission }) {
  const text = copy[locale]; const payment = paymentDisplay(submission, locale); const earnings = commissionDisplay(submission, locale, now);
  const membership = submission.createdBusiness?.membership;
  const refunded = submission.paymentStatus === "REFUNDED" && Boolean(membership?.entitlementRevokedAt);
  const expired = Boolean(membership && !membership.entitlementRevokedAt && new Date(membership.graceEndsAt).getTime() <= new Date(now).getTime());
  const published = isPublishedListing(submission, now);
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
