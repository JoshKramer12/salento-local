"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  IconCalendarDue,
  IconCreditCard,
  IconCheck,
  IconClock,
  IconExternalLink,
  IconMapPin,
  IconPencil,
  IconPhone,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconStarFilled,
  IconWorld,
} from "@tabler/icons-react";

import { AutoRenewCancelControl } from "@/components/account/auto-renew-cancel-control";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import {
  startMembershipBankTransferAction,
  startMembershipRenewalAction,
  turnOnMembershipAutoRenewAction,
} from "@/app/(account)/membership-actions";
import type { Locale } from "@/lib/i18n";

export type DashboardBusiness = {
  address: string;
  category: { name: string; slug: string };
  description: string;
  id: string;
  refundState: "AVAILABLE" | "PROCESSING" | "ACTION_REQUIRED" | "SUPPORT_REQUIRED" | "SUPPORT_CLOSED" | "REFUNDED" | "FAILED" | "UNAVAILABLE";
  refundDeadline: Date | null;
  refundAmountCents: number | null;
  refundCurrency: string | null;
  refundMethod?: "BANK_TRANSFER" | "STRIPE_CHECKOUT" | null;
  images: Array<{ alt: string; id: string; url: string }>;
  locality: { name: string } | null;
  membership: {
    annualPriceCents: number;
    automaticRenewal: boolean;
    automaticRenewalHealthy: boolean;
    currentPeriodEnd: Date;
    entitlementRevokedAt: Date | null;
    graceEndsAt: Date;
    recurringPaymentReady: boolean;
    stripeCancelAtPeriodEnd: boolean;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    stripeSubscriptionStatus: string | null;
  } | null;
  name: string;
  phone: string | null;
  rating: number;
  reviewCount: number;
  reviews: Array<{ authorName: string; body: string; createdAt: Date; id: string; rating: number; title: string }>;
  shortDescription: string;
  slug: string;
  tags: Array<{ tag: { name: string } }>;
  town: { name: string };
  website: string | null;
  websiteLabel: string | null;
};

type Props = { accountNavigation?: ReactNode; businesses: DashboardBusiness[]; firstName: string; locale: Locale };
type State = "ACTIVE" | "GRACE" | "EXPIRED" | "REFUNDED" | "LEGACY";

function date(locale: Locale, value: Date) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", { dateStyle: "long" }).format(new Date(value));
}

function refundDeadlineDate(locale: Locale, value: Date) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome", timeZoneName: "short" }).format(new Date(value));
}

function daysUntil(value: Date) {
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

function stateFor(business: DashboardBusiness): State {
  const membership = business.membership;
  if (!membership) return "LEGACY";
  if (membership.entitlementRevokedAt && business.refundState === "REFUNDED") return "REFUNDED";
  if (membership.entitlementRevokedAt || Date.now() >= new Date(membership.graceEndsAt).getTime()) return "EXPIRED";
  if (Date.now() >= new Date(membership.currentPeriodEnd).getTime()) return "GRACE";
  return "ACTIVE";
}

function copyFor(locale: Locale) {
  const it = locale === "it";
  return it ? {
    account: "AREA ACCOUNT", active: "ATTIVA", allSet: "Tutto a posto — non serve alcuna azione", auto: "Rinnovo automatico", bank: "Preferisci il bonifico?", bankAction: "Rinnova con bonifico", card: "Metodo di pagamento", days: "giorni rimanenti", documents: "Pagamenti e documenti", documentsBody: "Consulta le ricevute di pagamento e l'accordo di adesione firmato della tua attività.", edit: "Modifica scheda", expired: "SCADUTA", refunded: "Scheda inattiva", refundedBody: "La tua membership è stata rimborsata. La tua Pagina Attività non è più visibile su Salento Local.", refundedSaved: "Le informazioni della tua attività sono ancora salvate. Riattiva la scheda per pubblicarla di nuovo.", refundTitle: "Rimborso entro 14 giorni", refundBody: (amount: string, deadline: string) => `Hai cambiato idea? Puoi richiedere il rimborso completo del pagamento di ${amount} fino al ${deadline}.`, requestRefund: "Annulla membership e richiedi rimborso", refundProcessing: "Rimborso in elaborazione", grace: "GRAZIA", graceEnd: "Il periodo di grazia termina il", legacy: "Scheda pubblica", manual: "Rinnovo manuale", membership: "Membership e pagamento", noMembership: "Questa scheda pubblica non ha una membership associata.", noReviews: "Ancora nessuna recensione", payment: "Gestito in modo sicuro con Stripe", reactivate: "Riattiva per €100", reactivateHeading: "Riattiva la tua Pagina Attività", renew: "Rinnova per €100", renewalNeeded: "Rinnovo necessario", renews: "Rinnova", review: "recensione", reviewsCount: "recensioni", saved: "Le informazioni della tua attività e la Pagina Attività restano salvate. Non devi creare una nuova scheda.", select: "Seleziona un'attività per visualizzare e gestire la sua membership.", switchAuto: "Attiva rinnovo automatico", until: "Attiva fino al", update: "Aggiornamento", view: "Vedi scheda pubblica", welcome: "Benvenuto", welcomeBody: "Gestisci le tue schede attività e mantieni le informazioni aggiornate.", live: "La tua Pagina Attività è online su Salento Local.", graceLive: "La tua Pagina Attività è ancora online durante il periodo di grazia di 14 giorni.", hidden: "La tua Pagina Attività non è attualmente visibile su Salento Local.", currentEnded: "Membership terminata", statusAuto: "Auto", statusManual: "Manuale", actionRequired: "Azione necessaria", paymentAvailable: "Disponibile per il rinnovo automatico", paymentSaved: "Salvato in modo sicuro con Stripe", paymentUnavailable: "Nessun metodo di pagamento salvato", nextRenewal: "Il rinnovo automatico di €100/anno avverrà il", manualCopy: "La membership non si rinnoverà automaticamente. Rinnova entro questa data per mantenere online la Pagina Attività.", graceCopy: "La membership pagata è terminata, ma la tua Pagina Attività resterà online fino al", expiredCopy: "Riattiva la tua Pagina Attività esistente per €100/anno. Dopo il pagamento riuscito tornerà visibile al pubblico.", unhealthy: "Il rinnovo automatico richiede attenzione. Completa il rinnovo per mantenere online la tua Pagina Attività.", reviews: "Recensioni recenti", quick: "Azioni rapide", photos: "Gestisci foto", hours: "Aggiorna orari", add: "Aggiungi un'altra attività",
  } : {
    account: "ACCOUNT AREA", active: "ACTIVE", allSet: "All set — no action needed", auto: "Automatic renewal", bank: "Prefer bank transfer?", bankAction: "Renew by bank transfer", card: "Payment method", days: "days left", documents: "Payments & documents", documentsBody: "Find payment receipts and your business's signed membership agreement in one place.", edit: "Edit listing", expired: "EXPIRED", refunded: "Listing inactive", refundedBody: "Your membership was refunded. Your Business Page is no longer visible on Salento Local.", refundedSaved: "Your business information is still saved. Reactivate your listing to publish it again.", refundTitle: "14-day refund", refundBody: (amount: string, deadline: string) => `Changed your mind? You can request a full refund of your ${amount} payment until ${deadline}.`, requestRefund: "Cancel membership & request refund", refundProcessing: "Refund processing", grace: "GRACE", graceEnd: "Grace period ends", legacy: "Public listing", manual: "Manual renewal", membership: "Membership & payment", noMembership: "This public listing does not have a membership yet.", noReviews: "No reviews yet", payment: "Managed securely with Stripe", reactivate: "Reactivate for €100", reactivateHeading: "Reactivate your Business Page", renew: "Renew for €100", renewalNeeded: "Renewal needed", renews: "Renews", review: "review", reviewsCount: "reviews", saved: "All of your business information and existing Business Page remain saved. You do not need to create a new listing.", select: "Select a business to view and manage its membership.", switchAuto: "Turn on automatic renewal", until: "Active until", update: "Update", view: "View public listing", welcome: "Welcome", welcomeBody: "Manage your business listings and keep your information up to date.", live: "Your Business Page is live on Salento Local.", graceLive: "Your Business Page is still live during your 14-day grace period.", hidden: "Your Business Page is currently not visible on Salento Local.", currentEnded: "Membership ended", statusAuto: "Auto", statusManual: "Manual", actionRequired: "Action required", paymentAvailable: "Available for automatic renewal", paymentSaved: "Saved securely with Stripe", paymentUnavailable: "No saved payment method", nextRenewal: "Your membership will automatically renew for €100/year on", manualCopy: "Your membership will not renew automatically. Renew before this date to keep your Business Page online.", graceCopy: "Your paid membership has ended, but your Business Page will remain live until", expiredCopy: "Reactivate your existing Business Page for €100/year. Once payment is successful, it will become publicly visible again.", unhealthy: "Automatic renewal needs attention. Complete renewal to keep your Business Page online.", reviews: "Recent reviews", quick: "Quick actions", photos: "Manage photos", hours: "Update hours", add: "Add another business",
  };
}

function stateLabel(state: State, c: ReturnType<typeof copyFor>) {
  return state === "ACTIVE" ? c.active : state === "GRACE" ? c.grace : state === "EXPIRED" ? c.expired : state === "REFUNDED" ? c.refunded : c.legacy;
}

function membershipLine(business: DashboardBusiness, state: State, c: ReturnType<typeof copyFor>, locale: Locale) {
  const membership = business.membership;
  if (!membership) return c.noMembership;
  if (state === "REFUNDED") return `${c.refundedBody} ${c.refundedSaved}`;
  if (state === "EXPIRED") return `${c.hidden} · ${c.reactivate}`;
  if (state === "GRACE") return `${c.graceEnd} ${date(locale, membership.graceEndsAt)} · ${c.actionRequired}`;
  return membership.automaticRenewal && membership.automaticRenewalHealthy
    ? `${c.nextRenewal} ${date(locale, membership.currentPeriodEnd)} · ${c.statusAuto}`
    : `${c.until} ${date(locale, membership.currentPeriodEnd)} · ${c.statusManual}`;
}

export function BusinessOwnerDashboardClient({ accountNavigation, businesses, firstName, locale }: Props) {
  const c = copyFor(locale);
  const defaultBusiness = businesses.find((business) => ["REFUNDED", "EXPIRED", "GRACE"].includes(stateFor(business))) ?? businesses[0];
  const [selectedId, setSelectedId] = useState(defaultBusiness?.id ?? "");
  const selected = businesses.find((business) => business.id === selectedId) ?? defaultBusiness;
  const cardGridColumns = businesses.length === 1
    ? "grid-cols-1"
    : businesses.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  return <main className="shell px-4 py-8 sm:px-6 sm:py-12">
    {accountNavigation}
    <section className="mb-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div><p className="section-kicker mb-2">{c.account}</p><h1 className="font-serif text-[2.35rem] leading-[1.03] text-[var(--foreground)] sm:text-5xl">{c.welcome}, {firstName}</h1><p className="mt-3 text-base leading-7 text-[var(--muted)]">{c.welcomeBody}</p></div>
      <HardNavigationLink href="/publish" className="btn-primary min-h-12 justify-center"><IconPlus size={18} /> {c.add}</HardNavigationLink>
    </section>

    {businesses.length ? <>
      <section aria-label={locale === "it" ? "Le mie attività" : "My businesses"} className={`business-card-grid grid gap-4 ${cardGridColumns}`}>
        {businesses.length === 1
          ? <SingleBusinessShowcase business={businesses[0]} c={c} locale={locale} />
          : businesses.map((business) => <BusinessCard business={business} c={c} key={business.id} locale={locale} />)}
      </section>
      {selected ? <section className="mt-8" id="membership"><div className="mb-4"><h2 className="font-serif text-3xl text-[var(--foreground)]">{c.membership}</h2>{businesses.length > 1 ? <p className="mt-1 text-base text-[var(--muted)]">{c.select}</p> : null}</div>
        {businesses.length > 1 ? <div className="membership-business-selector flex gap-3 overflow-x-auto pb-2" role="tablist" aria-label={c.membership}>{businesses.map((business) => <button aria-selected={business.id === selected.id} className={`min-w-[13.5rem] rounded-2xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${business.id === selected.id ? "border-[var(--primary)] bg-[rgba(237,248,242,0.9)]" : "border-[var(--border)] bg-[var(--card)]"}`} key={business.id} onClick={() => setSelectedId(business.id)} role="tab" type="button"><div className="flex gap-3"><BusinessThumb business={business} /><span className="min-w-0"><b className="block truncate text-sm text-[var(--foreground)]">{business.name}</b><span className="mt-1 block text-xs font-semibold text-[var(--primary)]">{stateLabel(stateFor(business), c)}{business.membership ? ` · ${business.membership.automaticRenewal && business.membership.automaticRenewalHealthy ? c.statusAuto : c.statusManual}` : ""}</span></span></div></button>)}</div> : null}
        <MembershipPanel business={selected} c={c} locale={locale} />
      </section> : null}
      {selected ? <SelectedBusinessExtras business={selected} c={c} locale={locale} /> : null}
    </> : <section className="card p-8 text-center text-[var(--muted)]">{locale === "it" ? "Non hai ancora attività collegate al tuo account." : "You do not have any businesses connected to your account yet."}</section>}
  </main>;
}

function BusinessThumb({ business }: { business: DashboardBusiness }) { const image = business.images[0]; return image ? <img alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" src={image.url} /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary)] text-[var(--primary)]"><IconPhoto size={19} /></span>; }

function SingleBusinessShowcase({ business, c, locale }: { business: DashboardBusiness; c: ReturnType<typeof copyFor>; locale: Locale }) {
  const state = stateFor(business);
  const membership = business.membership;
  const [mainImage, ...remainingImages] = business.images;
  const thumbnails = remainingImages.length > 3 ? remainingImages.slice(0, 2) : remainingImages.slice(0, 3);
  const overflowImage = remainingImages.length > 3 ? remainingImages[2] : null;
  const additionalImages = Math.max(0, remainingImages.length - 3);
  const reviewSummary = <><IconStarFilled className="text-[#e7a13c]" size={18} />{business.rating.toFixed(1)} <span className="text-[var(--muted)]">{business.reviewCount} {business.reviewCount === 1 ? c.review : c.reviewsCount}</span></>;
  const description = business.shortDescription.trim() || business.description.trim();
  const membershipSummary = !membership
    ? c.noMembership
    : state === "REFUNDED"
      ? `${c.refundedBody} ${c.refundedSaved}`
      : state === "EXPIRED"
      ? c.hidden
      : state === "GRACE"
        ? `${c.graceEnd} ${date(locale, membership.graceEndsAt)}`
        : membership.automaticRenewal && membership.automaticRenewalHealthy
          ? `${c.renews} ${date(locale, membership.currentPeriodEnd)} · ${c.statusAuto}`
          : `${c.until} ${date(locale, membership.currentPeriodEnd)} · ${c.statusManual}`;

  return <article className="single-business-showcase min-w-0 overflow-hidden rounded-[1.7rem] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[0_12px_30px_rgba(66,51,31,0.055)] sm:p-5 lg:grid lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:gap-7">
    <div className="min-w-0 lg:border-r lg:border-[var(--border)] lg:pr-7">
      <div className="relative aspect-[1.35/0.9] overflow-hidden rounded-[1.25rem] bg-[var(--secondary)]">
        {mainImage ? <img alt={mainImage.alt || business.name} className="h-full w-full object-cover" src={mainImage.url} /> : <div className="h-full w-full bg-[linear-gradient(135deg,#d5ebe3,#f7f0e3)]" />}
        <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-bold ${state === "GRACE" ? "bg-[#fff0cc] text-[#805100]" : (state === "EXPIRED" || state === "REFUNDED") ? "bg-[#f7e3df] text-[#973f36]" : "bg-[#dff3e4] text-[#17644f]"}`}>{stateLabel(state, c)}</span>
      </div>
      {remainingImages.length ? <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label={`${business.name} gallery`}>
        {thumbnails.map((image) => <img alt={image.alt || business.name} className="h-20 w-28 shrink-0 rounded-xl object-cover" key={image.id} src={image.url} />)}
        {overflowImage ? <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl"><img alt={overflowImage.alt || business.name} className="h-full w-full object-cover" src={overflowImage.url} /><span className="absolute inset-0 flex items-center justify-center bg-[rgba(17,37,49,0.62)] text-lg font-bold text-white">+{additionalImages}</span></div> : null}
      </div> : null}
    </div>

    <div className="min-w-0 pt-5 lg:pt-1">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{business.category.name}</p>
      <h3 className="mt-2 break-words font-serif text-3xl leading-tight text-[var(--foreground)] sm:text-4xl">{business.name}</h3>
      {description ? <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted-strong)]">{description}</p> : null}
      <div className="mt-5 grid gap-3 text-sm leading-6 text-[var(--muted-strong)]">
        <p className="flex items-start gap-2"><IconMapPin className="mt-1 shrink-0 text-[var(--primary)]" size={17} /><span>{business.address}{business.locality ? `, ${business.locality.name}` : ""}</span></p>
        {business.phone ? <a className="flex min-w-0 items-center gap-2 hover:text-[var(--primary)] hover:underline" href={`tel:${business.phone}`}><IconPhone className="shrink-0 text-[var(--primary)]" size={17} /><span className="truncate">{business.phone}</span></a> : null}
        {business.website ? <a className="flex min-w-0 items-center gap-2 hover:text-[var(--primary)] hover:underline" href={business.website} rel="noreferrer" target="_blank"><IconWorld className="shrink-0 text-[var(--primary)]" size={17} /><span className="truncate">{business.websiteLabel || business.website}</span><IconExternalLink className="shrink-0" size={15} /></a> : null}
      </div>
      {business.tags.length ? <div className="mt-5 flex flex-wrap gap-2">{business.tags.map(({ tag }) => <span className="rounded-full bg-[var(--secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)]" key={tag.name}>{tag.name}</span>)}</div> : null}
      <div className="mt-6 border-t border-[var(--border)] pt-4">
        <p className={`text-xs font-bold tracking-[0.11em] ${state === "GRACE" ? "text-[#805100]" : (state === "EXPIRED" || state === "REFUNDED") ? "text-[#973f36]" : "text-[var(--primary)]"}`}>{stateLabel(state, c)}</p>
        <p className="mt-1 text-sm leading-5 text-[var(--muted-strong)]">{membershipSummary}</p>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        {business.reviewCount && state !== "REFUNDED" && state !== "EXPIRED" ? <Link className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)] underline-offset-4 hover:text-[var(--primary)] hover:underline" href={`/businesses/${business.slug}#reviews`}>{reviewSummary}</Link> : <span className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">{business.reviewCount ? reviewSummary : c.noReviews}</span>}
        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2"><HardNavigationLink className="btn-secondary min-h-11 justify-center" href={`/businesses/${business.slug}/edit?step=business`}><IconPencil size={17} />{c.edit}</HardNavigationLink>{state === "REFUNDED" || state === "EXPIRED" ? <form action={startMembershipRenewalAction}><input name="businessId" type="hidden" value={business.id} /><button className="btn-primary min-h-11 w-full justify-center" type="submit">{c.reactivate}</button></form> : <HardNavigationLink className="btn-primary min-h-11 justify-center" href={`/businesses/${business.slug}`}><IconExternalLink size={17} />{c.view}</HardNavigationLink>}</div>
      </div>
    </div>
  </article>;
}

function BusinessCard({ business, c, locale }: { business: DashboardBusiness; c: ReturnType<typeof copyFor>; locale: Locale }) {
  const state = stateFor(business); const image = business.images[0]; const membership = business.membership;
  return <article className="flex min-w-0 flex-col overflow-hidden rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-3 shadow-[0_10px_26px_rgba(66,51,31,0.045)]"><div className="relative aspect-[1.55/0.8] overflow-hidden rounded-[1rem] bg-[var(--secondary)]">{image ? <img alt={image.alt || business.name} className="h-full w-full object-cover" src={image.url} /> : <div className="h-full w-full bg-[linear-gradient(135deg,#d5ebe3,#f7f0e3)]" />}<span className={`absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-bold ${state === "GRACE" ? "bg-[#fff0cc] text-[#805100]" : (state === "EXPIRED" || state === "REFUNDED") ? "bg-[#f7e3df] text-[#973f36]" : "bg-[#dff3e4] text-[#17644f]"}`}>{stateLabel(state, c)}</span></div><div className="flex flex-1 flex-col px-1 pb-1 pt-4"><h3 className="font-serif text-2xl text-[var(--foreground)]">{business.name}</h3><p className="mt-1 text-sm text-[var(--muted)]">{business.category.name} · {business.locality?.name ?? business.town.name}</p><p className="mt-2 flex items-start gap-1.5 text-sm leading-5 text-[var(--muted)]"><IconMapPin className="mt-0.5 shrink-0" size={15} />{business.address}</p>{membership ? <div className="mt-4 rounded-xl bg-[rgba(237,248,242,0.7)] p-3"><p className="text-xs font-bold tracking-[0.11em] text-[var(--primary)]">{stateLabel(state, c)}</p><p className="mt-1 text-sm leading-5 text-[var(--foreground)]">{membershipLine(business, state, c, locale)}</p></div> : <div className="mt-4 rounded-xl bg-[var(--secondary)] p-3 text-sm text-[var(--muted)]">{c.noMembership}</div>}<div className="mt-auto grid gap-2 pt-4 sm:grid-cols-2"><HardNavigationLink className="btn-secondary min-h-11 justify-center" href={`/businesses/${business.slug}/edit?step=business`}><IconPencil size={17} />{c.edit}</HardNavigationLink>{state === "REFUNDED" || state === "EXPIRED" ? <form action={startMembershipRenewalAction}><input name="businessId" type="hidden" value={business.id} /><button className="btn-primary min-h-11 w-full justify-center" type="submit">{c.reactivate}</button></form> : <HardNavigationLink className="btn-primary min-h-11 justify-center" href={`/businesses/${business.slug}`}><IconExternalLink size={17} />{c.view}</HardNavigationLink>}</div></div></article>;
}

function MembershipPanel({ business, c, locale }: { business: DashboardBusiness; c: ReturnType<typeof copyFor>; locale: Locale }) {
  const membership = business.membership;
  const state = stateFor(business);
  if (!membership) return <article className="rounded-[1.6rem] border border-[var(--border)] bg-[rgba(237,248,242,0.55)] p-6"><p className="section-kicker">{c.legacy}</p><h3 className="mt-2 font-serif text-3xl text-[var(--foreground)]">{c.membership}</h3><p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">{c.noMembership}</p></article>;
  const healthyAuto = membership.automaticRenewal && membership.automaticRenewalHealthy;
  const isExpired = state === "EXPIRED" || state === "REFUNDED"; const isGrace = state === "GRACE";
  const description = state === "REFUNDED" ? c.refundedBody : isExpired ? c.hidden : isGrace ? c.graceLive : c.live;
  const refundAmount = business.refundAmountCents !== null && business.refundCurrency
    ? new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-US", { style: "currency", currency: business.refundCurrency.toUpperCase() }).format(business.refundAmountCents / 100)
    : null;
  const endingDate = isExpired || isGrace ? membership.currentPeriodEnd : membership.currentPeriodEnd;
  return <article className="mt-4 overflow-hidden rounded-[1.7rem] border border-[rgba(42,98,87,0.22)] bg-[linear-gradient(135deg,rgba(237,248,242,0.98),rgba(250,253,250,0.9))] p-5 shadow-[0_14px_32px_rgba(42,98,87,0.06)] sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className={`text-xs font-bold tracking-[0.14em] ${isExpired ? "text-[#8e4a41]" : isGrace ? "text-[#9a620c]" : "text-[var(--primary)]"}`}>{stateLabel(state, c)}</p><h3 className="mt-2 font-serif text-3xl text-[var(--foreground)] sm:text-4xl">{c.membership}</h3><p className="mt-2 text-base leading-7 text-[var(--muted-strong)]">{description}</p></div><span className="rounded-full bg-white/85 px-4 py-2 font-bold text-[var(--foreground)]">{new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-US", { style: "currency", currency: "EUR" }).format(membership.annualPriceCents / 100)}{locale === "it" ? "/anno" : "/year"}</span></div><div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(20rem,0.9fr)]"><div><div className="grid gap-5 md:grid-cols-3"><Info icon={<IconCalendarDue size={23} />} label={state === "REFUNDED" ? locale === "it" ? "Scadenza originaria" : "Original term end" : isGrace || isExpired ? c.currentEnded : c.until} value={date(locale, endingDate)} detail={state === "REFUNDED" ? c.hidden : isGrace ? `${c.graceEnd}: ${date(locale, membership.graceEndsAt)} · ${daysUntil(membership.graceEndsAt)} ${c.days}` : isExpired ? `${c.graceEnd}: ${date(locale, membership.graceEndsAt)}` : `(${daysUntil(membership.currentPeriodEnd)} ${c.days})`} /><Info icon={<IconRefresh size={23} />} label={c.auto} value={healthyAuto ? "ON" : "OFF"} detail={state === "REFUNDED" ? locale === "it" ? "Nessun rinnovo futuro per questa membership rimborsata." : "No future renewal for this refunded membership." : healthyAuto ? `${c.nextRenewal} ${date(locale, membership.currentPeriodEnd)}.` : c.manualCopy} /><Info icon={<IconCreditCard size={23} />} label={c.card} value={membership.stripeCustomerId ? c.paymentSaved : c.paymentUnavailable} detail={c.payment} /></div><section className="mt-7 rounded-[1.3rem] border border-[rgba(42,98,87,0.15)] bg-white/70 p-4"><p className="section-kicker">{c.documents}</p><h4 className="mt-1 font-serif text-2xl text-[var(--foreground)]">{c.documents}</h4><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{c.documentsBody}</p><HardNavigationLink className="btn-secondary mt-4 min-h-12 w-full justify-center sm:w-auto" href={`/dashboard/payment-history?business=${encodeURIComponent(business.slug)}`}>{locale === "it" ? "Visualizza pagamenti e documenti" : "View payments & documents"}</HardNavigationLink></section>{business.refundState === "AVAILABLE" && business.refundDeadline && refundAmount ? <div className="mt-5 border-t border-[var(--border)] pt-4"><h4 className="font-semibold text-[var(--foreground)]">{c.refundTitle}</h4><p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{c.refundBody(refundAmount, refundDeadlineDate(locale, business.refundDeadline))}</p>{business.refundMethod === "BANK_TRANSFER" ? <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{locale === "it" ? "Hai pagato con bonifico. Puoi richiedere il rimborso qui; l’assistenza Salento Local ti aiuterà a completarlo." : "You paid by bank transfer. Request your refund here; Salento Local support will help complete the return."}</p> : null}<HardNavigationLink className="btn-secondary mt-3 min-h-11 justify-center px-5" href={`/dashboard/refund/${encodeURIComponent(business.id)}`}>{c.requestRefund}</HardNavigationLink></div> : (business.refundState === "PROCESSING" || business.refundState === "ACTION_REQUIRED" || business.refundState === "SUPPORT_REQUIRED") ? <HardNavigationLink className="btn-secondary mt-4 min-h-11 justify-center px-5" href={`/dashboard/refund/${encodeURIComponent(business.id)}`}>{business.refundState === "SUPPORT_REQUIRED" ? locale === "it" ? "Richiesta di rimborso ricevuta" : "Refund request received" : c.refundProcessing}</HardNavigationLink> : null}</div><StatusAction business={business} c={c} healthyAuto={healthyAuto} locale={locale} state={state} /></div></article>;
}

function Info({ detail, icon, label, value }: { detail: string; icon: ReactNode; label: string; value: string }) { return <div className="border-b border-[rgba(42,98,87,0.12)] pb-4 last:border-0 md:border-b-0 md:border-r md:pr-4"><div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgba(42,98,87,0.09)] text-[var(--primary)]">{icon}</span><div><p className="text-sm text-[var(--muted-strong)]">{label}</p><p className="mt-1 font-serif text-xl text-[var(--foreground)]">{value}</p><p className="mt-2 text-sm leading-5 text-[var(--muted)]">{detail}</p></div></div></div>; }

function StatusAction({ business, c, healthyAuto, locale, state }: { business: DashboardBusiness; c: ReturnType<typeof copyFor>; healthyAuto: boolean; locale: Locale; state: State }) {
  if (business.refundState === "FAILED") return <aside className="rounded-[1.4rem] bg-white/80 p-5"><h4 className="font-serif text-2xl text-[var(--foreground)]">{locale === "it" ? "Rimborso non riuscito" : "Refund could not be completed"}</h4><p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{locale === "it" ? "La richiesta richiede una verifica dell’assistenza. La scheda mantiene lo stato attuale." : "Your request needs support review. Your listing keeps its current status."}</p><HardNavigationLink className="btn-secondary mt-5 min-h-11 justify-center px-5" href={`/dashboard/refund/${encodeURIComponent(business.id)}`}>{locale === "it" ? "Visualizza dettagli" : "View details"}</HardNavigationLink></aside>;
  if ((business.refundState === "PROCESSING" || business.refundState === "ACTION_REQUIRED" || business.refundState === "SUPPORT_REQUIRED")) return <aside className="rounded-[1.4rem] bg-white/80 p-5"><h4 className="font-serif text-2xl text-[var(--foreground)]">{business.refundState === "SUPPORT_REQUIRED" ? locale === "it" ? "Rimborso in attesa dell’assistenza" : "Refund pending support" : c.refundProcessing}</h4><p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{business.refundState === "SUPPORT_REQUIRED" ? locale === "it" ? "La richiesta è registrata e l’idoneità è preservata. La scheda resta attiva fino al completamento del rimborso." : "Your request is recorded and eligibility preserved. Your listing remains active until the refund is completed." : locale === "it" ? "Stiamo verificando il rimborso. Attendi l'esito prima di acquistare una nuova membership." : "We are checking your refund. Please wait for the result before buying a new membership."}</p><HardNavigationLink className="btn-secondary mt-5 min-h-11 justify-center px-5" href={`/dashboard/refund/${encodeURIComponent(business.id)}`}>{locale === "it" ? "Controlla lo stato" : "Check refund status"}</HardNavigationLink></aside>;
  const membership = business.membership!; const manual = state === "ACTIVE" && !healthyAuto; const danger = state === "GRACE" || state === "EXPIRED" || state === "REFUNDED" || (membership.automaticRenewal && !healthyAuto); const title = healthyAuto ? c.allSet : (state === "EXPIRED" || state === "REFUNDED") ? c.reactivateHeading : state === "GRACE" ? c.renewalNeeded : manual ? c.manual : c.renewalNeeded; const detail = healthyAuto ? `${c.nextRenewal} ${date(locale, membership.currentPeriodEnd)}. ${c.live}` : state === "REFUNDED" ? c.refundedSaved : state === "EXPIRED" ? `${c.saved} ${c.expiredCopy}` : state === "GRACE" ? `${c.graceCopy} ${date(locale, membership.graceEndsAt)}.` : membership.automaticRenewal ? c.unhealthy : c.manualCopy;
  return <aside className={`rounded-[1.4rem] p-5 ${healthyAuto ? "bg-white/80" : danger ? "bg-[rgba(255,246,224,0.92)]" : "bg-[rgba(255,246,224,0.92)]"}`}><div className="flex items-start gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${healthyAuto ? "bg-[var(--primary)] text-white" : "bg-[#ffe6aa] text-[#805100]"}`}>{healthyAuto ? <IconCheck size={22} /> : <IconClock size={22} />}</span><div><h4 className="font-serif text-2xl text-[var(--foreground)]">{title}</h4><p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{detail}</p></div></div><div className="mt-5 grid gap-3">{healthyAuto ? <AutoRenewCancelControl businessId={business.id} endDate={date(locale, membership.currentPeriodEnd)} locale={locale} /> : <><form action={startMembershipRenewalAction}><input name="businessId" type="hidden" value={business.id} /><button className="btn-primary min-h-12 w-full justify-center" type="submit">{(state === "EXPIRED" || state === "REFUNDED") ? c.reactivate : c.renew}</button></form><form action={turnOnMembershipAutoRenewAction}><input name="businessId" type="hidden" value={business.id} /><button className="btn-secondary min-h-11 w-full justify-center" type="submit">{c.switchAuto}</button></form><div className="border-t border-[rgba(128,81,0,0.14)] pt-4"><p className="text-sm text-[var(--muted)]">{c.bank}</p><form action={startMembershipBankTransferAction} className="mt-2"><input name="businessId" type="hidden" value={business.id} /><button className="text-sm font-semibold text-[var(--primary)] underline underline-offset-4" type="submit">{c.bankAction} →</button></form></div></>}</div></aside>;
}

function SelectedBusinessExtras({ business, c, locale }: { business: DashboardBusiness; c: ReturnType<typeof copyFor>; locale: Locale }) { const state = stateFor(business); return <section className="mt-7 grid gap-4 lg:grid-cols-2"><article className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-serif text-2xl text-[var(--foreground)]">{c.reviews}</h2>{state !== "REFUNDED" && state !== "EXPIRED" ? <Link className="text-sm font-semibold text-[var(--primary)] underline-offset-4 hover:underline" href={`/businesses/${business.slug}#reviews`}>{locale === "it" ? "Vedi tutte" : "View all"}</Link> : null}</div>{business.reviews.length ? <div className="mt-4 divide-y divide-[var(--border)]">{business.reviews.slice(0, 2).map((review) => <article className="py-3 first:pt-0" key={review.id}><b className="text-sm text-[var(--foreground)]">{review.authorName}</b><span className="ml-2 inline-flex text-[#e7a13c]">{Array.from({ length: Math.min(5, Math.round(review.rating)) }, (_, i) => <IconStarFilled key={i} size={13} />)}</span><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{review.body}</p></article>)}</div> : <p className="mt-4 text-sm text-[var(--muted)]">{locale === "it" ? "Ancora nessuna recensione." : "No reviews yet."}</p>}</article><article className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-5"><h2 className="font-serif text-2xl text-[var(--foreground)]">{c.quick}</h2><div className="mt-3 grid gap-2"><HardNavigationLink className="btn-secondary min-h-11" href={`/businesses/${business.slug}/edit?step=business`}><IconPencil size={17} />{c.edit}</HardNavigationLink><HardNavigationLink className="btn-secondary min-h-11" href={`/businesses/${business.slug}/edit?step=photos`}><IconPhoto size={17} />{c.photos}</HardNavigationLink><HardNavigationLink className="btn-secondary min-h-11" href={`/businesses/${business.slug}/edit?step=hours`}><IconClock size={17} />{c.hours}</HardNavigationLink></div></article></section>; }
