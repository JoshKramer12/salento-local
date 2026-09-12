import Link from "next/link";
import {
  IconCalendarDue,
  IconChevronRight,
  IconClock,
  IconExternalLink,
  IconFileInvoice,
  IconHelpCircle,
  IconMapPin,
  IconMessageCircle,
  IconPencil,
  IconPhone,
  IconPhoto,
  IconPlus,
  IconReceipt,
  IconStarFilled,
  IconWorld,
} from "@tabler/icons-react";

import { BusinessOwnerAccountNav } from "@/components/account/business-owner-account-nav";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { normalizeUrlInput } from "@/lib/business-links";
import { getBusinessPhotoUrls } from "@/lib/business-photos";
import type { Locale } from "@/lib/i18n";
import { LISTING_OFFER } from "@/lib/listing-offer";
import { buildBusinessImage, buildBusinessPhoto, getCategoryLabel } from "@/lib/site";

type OwnerBusiness = {
  address: string;
  category: { name: string; slug: string };
  description: string;
  heroImageSeed: string;
  id: string;
  images: Array<{ alt: string; id: string; url: string }>;
  locality: { name: string } | null;
  name: string;
  payments: Array<{
    createdAt: Date;
    paidAt: Date | null;
    status: string;
    businessSubmission: {
      id: string;
      listingTermMonthsAtAcceptance: number | null;
    };
  }>;
  phone: string | null;
  rating: number;
  reviewCount: number;
  reviews: Array<{
    authorName: string;
    body: string;
    createdAt: Date;
    id: string;
    rating: number;
    title: string;
  }>;
  submissions: Array<{ photoUrls: unknown }>;
  shortDescription: string;
  slug: string;
  tags: Array<{ tag: { name: string } }>;
  town: { name: string };
  website: string | null;
};

type BusinessOwnerDashboardProps = {
  businesses: OwnerBusiness[];
  firstName: string;
  locale: Locale;
};

function formatDate(locale: Locale, value: Date) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "long",
  }).format(value);
}

function formatReviewDate(locale: Locale, value: Date) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
  }).format(value);
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function getListingPeriod(payment: OwnerBusiness["payments"][number] | undefined) {
  if (!payment) return null;

  const start = payment.paidAt ?? payment.createdAt;
  const months = payment.businessSubmission.listingTermMonthsAtAcceptance ?? LISTING_OFFER.termMonths;
  const end = addMonths(start, months);
  const now = new Date();
  const total = Math.max(end.getTime() - start.getTime(), 1);
  const remaining = end.getTime() - now.getTime();

  return {
    daysRemaining: Math.max(0, Math.ceil(remaining / (1000 * 60 * 60 * 24))),
    ended: remaining < 0,
    end,
    progress: Math.min(100, Math.max(0, (remaining / total) * 100)),
  };
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("") || "?";
}

export function BusinessOwnerDashboard({
  businesses,
  firstName,
  locale,
}: BusinessOwnerDashboardProps) {
  const italian = locale === "it";
  const copy = italian
    ? {
        accountArea: "AREA ACCOUNT",
        add: "Aggiungi un'altra attività",
        average: "Valutazione media",
        basedOn: "Basata su",
        contact: "Contatta il supporto",
        currentPeriodEnds: "Il periodo della tua scheda termina il",
        daysLeft: "giorni rimanenti",
        drafts: "Bozze",
        edit: "Modifica informazioni attività",
        editListing: "Modifica scheda",
        empty: "Non hai ancora attività collegate al tuo account.",
        emptyBody: "Aggiungi una nuova attività per iniziare a gestirla qui.",
        emptyReviews: "Ancora nessuna recensione.",
        help: "Hai bisogno di aiuto?",
        helpBody: "Se hai domande o hai bisogno di supporto, siamo qui per aiutarti.",
        listed: "Pubblicata",
        manageHours: "Aggiorna gli orari di apertura",
        managePhotos: "Gestisci foto",
        manageReviews: "Gestisci recensioni",
        membership: "Abbonamento e pagamento",
        membershipActive: "La tua scheda è attiva.",
        membershipUnavailable: "Non è ancora presente un pagamento completato per questa scheda.",
        myBusinesses: "Le mie attività",
        noReceipt: "Nessuna ricevuta disponibile",
        paymentHistory: "Storico pagamenti",
        rating: "Valutazione",
        recentReviews: "Recensioni recenti",
        reviews: "recensioni",
        support: "Supporto",
        totalReviews: "Recensioni totali",
        truthfulReviews: "Da clienti reali",
        viewAllReviews: "Vedi tutte le recensioni",
        viewPublic: "Vedi scheda pubblica",
        viewReceipt: "Vedi ricevuta",
        welcome: "Benvenuto",
        welcomeBody: "Gestisci le tue schede attività e mantieni le informazioni aggiornate.",
      }
    : {
        accountArea: "ACCOUNT AREA",
        add: "Add another business",
        average: "Average rating",
        basedOn: "Based on",
        contact: "Contact support",
        currentPeriodEnds: "Your current listing period ends on",
        daysLeft: "days left",
        drafts: "Drafts",
        edit: "Edit business information",
        editListing: "Edit listing",
        empty: "You do not have any businesses connected to your account yet.",
        emptyBody: "Add a new business to start managing it here.",
        emptyReviews: "No reviews yet.",
        help: "Need help?",
        helpBody: "If you have any questions or need support, we’re here to help.",
        listed: "Published",
        manageHours: "Update opening hours",
        managePhotos: "Manage photos",
        manageReviews: "Manage reviews",
        membership: "Membership & payment",
        membershipActive: "Your listing is active.",
        membershipUnavailable: "There is no completed payment recorded for this listing yet.",
        myBusinesses: "My businesses",
        noReceipt: "No receipt available",
        paymentHistory: "Payment history",
        rating: "Rating",
        recentReviews: "Recent reviews",
        reviews: "reviews",
        support: "Support",
        totalReviews: "Total reviews",
        truthfulReviews: "From real customers",
        viewAllReviews: "View all reviews",
        viewPublic: "View public listing",
        viewReceipt: "View receipt",
        welcome: "Welcome",
        welcomeBody: "Manage your business listings and keep your information up to date.",
      };

  return (
    <main className="shell px-4 py-8 sm:px-6 sm:py-12">
      <section className="mb-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-8">
        <div>
          <p className="section-kicker mb-2">{copy.accountArea}</p>
          <h1 className="font-serif text-[2.35rem] leading-[1.03] text-[var(--foreground)] sm:text-5xl">
            {copy.welcome}, {firstName}
          </h1>
          <p className="mt-3 max-w-2xl text-[0.98rem] leading-7 text-[var(--muted)]">{copy.welcomeBody}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:justify-end">
          <HardNavigationLink href="/publish" className="btn-primary min-h-12 justify-center whitespace-nowrap">
            <IconPlus size={18} /> {copy.add}
          </HardNavigationLink>
        </div>
      </section>

      <BusinessOwnerAccountNav active="businesses" locale={locale} />

      {businesses.length ? (
        <div className="grid gap-7 sm:gap-8">
          {businesses.map((business) => (
            <OwnerBusinessSection business={business} copy={copy} key={business.id} locale={locale} />
          ))}
        </div>
      ) : (
        <section className="card mx-auto max-w-2xl p-6 text-center sm:p-9">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[color:rgba(42,98,87,0.1)] text-[var(--primary)]">
            <IconMapPin size={26} />
          </div>
          <h2 className="mt-5 font-serif text-3xl text-[var(--foreground)]">{copy.empty}</h2>
          <p className="mx-auto mt-3 max-w-lg leading-7 text-[var(--muted)]">{copy.emptyBody}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-1">
            <HardNavigationLink href="/publish" className="btn-primary min-h-12 justify-center"><IconPlus size={18} /> {copy.add}</HardNavigationLink>
          </div>
        </section>
      )}

      <section className="mt-7 rounded-[1.55rem] border border-[var(--border)] bg-[color:rgba(255,253,249,0.82)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.045)] sm:mt-8 sm:p-6">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color:rgba(42,98,87,0.09)] text-[var(--primary)]"><IconHelpCircle size={25} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-2xl text-[var(--foreground)]">{copy.help}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{copy.helpBody}</p>
            <HardNavigationLink href="/terms#contact" className="btn-secondary mt-5 min-h-11 w-full justify-center sm:w-auto">{copy.contact}</HardNavigationLink>
          </div>
        </div>
      </section>
    </main>
  );
}

function OwnerBusinessSection({ business, copy, locale }: { business: OwnerBusiness; copy: Record<string, string>; locale: Locale }) {
  const italian = locale === "it";
  const category = getCategoryLabel(business.category.slug, business.category.name, locale);
  const fallbackImage = buildBusinessImage({ heroImageSeed: business.heroImageSeed, name: business.name }, business.category.slug, 1500);
  const gallery = getBusinessPhotoUrls(business.images, business.submissions[0]?.photoUrls).map((url, index) => {
    const image = business.images.find((entry) => entry.url === url);

    return {
      alt: image?.alt || `${business.name} ${index + 1}`,
      id: image?.id || `submission-photo-${index}`,
      src: buildBusinessPhoto(url, index === 0 ? 1500 : 400, { label: business.name, seed: business.heroImageSeed, type: business.category.slug === "beaches" ? "beach" : "business" }) ?? fallbackImage,
    };
  });
  const visibleImages = gallery.slice(0, 4);
  const hero = gallery[0] ?? { alt: business.name, id: "fallback-image", src: fallbackImage };
  const payment = business.payments[0];
  const period = getListingPeriod(payment);
  const location = business.locality ? `${business.locality.name}, ${business.town.name}` : business.town.name;
  const description = business.shortDescription.trim() || business.description.trim();
  const editListingHref = `/businesses/${business.slug}/edit?step=business`;
  const publicListingHref = `/businesses/${business.slug}`;
  const website = normalizeUrlInput(business.website);

  return (
    <section className="grid gap-5 sm:gap-6">
      <article className="overflow-hidden rounded-[1.6rem] border border-[var(--border)] bg-[var(--card)] p-3 shadow-[0_14px_32px_rgba(66,51,31,0.055)] sm:p-4 lg:grid lg:grid-cols-[minmax(19rem,0.9fr)_minmax(0,1.1fr)] lg:gap-7">
        <div>
          <div className="relative aspect-[1.32/0.83] overflow-hidden rounded-[1.15rem] bg-[linear-gradient(135deg,#fbf7f0,#f1e8da)]">
            <img src={hero.src} alt={hero.alt} className="h-full w-full object-cover" />
            <span className="absolute left-3 top-3 rounded-full bg-[rgba(35,80,71,0.93)] px-3 py-1 text-xs font-semibold text-white shadow-sm">{copy.listed}</span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {visibleImages.slice(1).map((image) => <img key={image.id} src={image.src} alt={image.alt} className="aspect-[1.25/0.8] min-w-0 rounded-xl object-cover" />)}
            {visibleImages.length === 1 ? <div className="col-span-3" /> : null}
            {gallery.length > 4 ? <div className="relative aspect-[1.25/0.8] overflow-hidden rounded-xl bg-[var(--primary)] text-white"><img src={gallery[3]?.src ?? fallbackImage} alt="" className="h-full w-full object-cover opacity-45" /><span className="absolute inset-0 flex items-center justify-center text-sm font-semibold">+{gallery.length - 4}</span></div> : null}
          </div>
        </div>

        <div className="px-1 pb-1 pt-5 sm:px-2 lg:py-3">
          <p className="section-kicker mb-2">{category}</p>
          <h2 className="font-serif text-3xl leading-tight text-[var(--foreground)] sm:text-[2.25rem]">{business.name}</h2>
          {description ? <p className="mt-2 text-sm leading-6 text-[var(--muted)] sm:text-[0.95rem]">{description}</p> : null}
          <div className="mt-4 grid gap-2 text-sm text-[var(--muted-strong)]">
            <span className="flex items-start gap-2"><IconMapPin className="mt-0.5 shrink-0 text-[var(--foreground)]" size={17} /> <span>{business.address}<br />{location}</span></span>
            {business.phone ? <a href={`tel:${business.phone}`} className="flex items-center gap-2 hover:text-[var(--primary)]"><IconPhone className="shrink-0 text-[var(--foreground)]" size={17} /> <span>{business.phone}</span></a> : null}
            {website ? <a href={website} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 hover:text-[var(--primary)]"><IconWorld className="shrink-0 text-[var(--foreground)]" size={17} /> <span className="truncate">{website.replace(/^https?:\/\//, "")}</span></a> : null}
          </div>
          {business.tags.length ? <div className="mt-4 flex flex-wrap gap-2">{business.tags.slice(0, 6).map(({ tag }) => <span key={tag.name} className="rounded-full bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)]">{tag.name}</span>)}</div> : null}
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            {business.reviewCount > 0 && business.rating > 0 ? <span className="inline-flex items-center gap-1.5 font-serif text-2xl text-[var(--foreground)]"><IconStarFilled size={20} className="text-[#e7a13c]" /> {business.rating.toFixed(1)}</span> : <span className="text-sm text-[var(--muted)]">{copy.emptyReviews}</span>}
            <Link href={`/businesses/${business.slug}#reviews`} className="text-sm font-semibold text-[var(--primary)] underline underline-offset-4">{business.reviewCount} {copy.reviews} →</Link>
          </div>
          <div className="mt-5 grid gap-3 sm:flex sm:flex-wrap">
            <HardNavigationLink href={editListingHref} className="btn-secondary min-h-12 w-full justify-center sm:w-auto"><IconPencil size={18} />{copy.editListing}</HardNavigationLink>
            <HardNavigationLink href={publicListingHref} className="btn-primary min-h-12 w-full justify-center sm:w-auto">{copy.viewPublic}<IconExternalLink size={18} /></HardNavigationLink>
          </div>
        </div>
      </article>

      <div className="grid gap-4 md:grid-cols-2">
        <SummaryCard icon={<IconStarFilled size={25} />} label={copy.average} value={business.reviewCount > 0 && business.rating > 0 ? business.rating.toFixed(1) : "—"} detail={business.reviewCount ? `${copy.basedOn} ${business.reviewCount} ${copy.reviews}` : copy.emptyReviews} tone="star" />
        <SummaryCard icon={<IconMessageCircle size={25} />} label={copy.totalReviews} value={business.reviewCount} detail={business.reviewCount ? copy.truthfulReviews : copy.emptyReviews} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-[1.55rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.045)] sm:p-6">
          <div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color:rgba(42,98,87,0.1)] text-[var(--primary)]"><IconReceipt size={24} /></span><div><h3 className="font-serif text-2xl text-[var(--foreground)]">{copy.membership}</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{payment ? copy.membershipActive : copy.membershipUnavailable}</p></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><HardNavigationLink href={payment ? `/receipts/${payment.businessSubmission.id}` : "/dashboard/payment-history"} className="btn-secondary min-h-11 justify-center">{payment ? <IconFileInvoice size={18} /> : null}{payment ? copy.viewReceipt : copy.noReceipt}</HardNavigationLink><HardNavigationLink href={`/dashboard/payment-history?business=${encodeURIComponent(business.slug)}`} className="btn-secondary min-h-11 justify-center"><IconReceipt size={18} /> {copy.paymentHistory}</HardNavigationLink></div>
        </article>
        <article className="rounded-[1.55rem] border border-[color:rgba(42,98,87,0.12)] bg-[linear-gradient(135deg,rgba(237,248,242,0.86),rgba(255,253,249,0.92))] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.04)] sm:p-6">
          <div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color:rgba(42,98,87,0.1)] text-[var(--primary)]"><IconCalendarDue size={24} /></span><div>{period ? <><h3 className="font-serif text-3xl text-[var(--foreground)]">{period.ended ? (italian ? "Periodo terminato" : "Listing period ended") : `${period.daysRemaining} ${copy.daysLeft}`}</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{copy.currentPeriodEnds} {formatDate(locale, period.end)}.</p></> : <><h3 className="font-serif text-2xl text-[var(--foreground)]">{italian ? "Periodo non disponibile" : "Listing period unavailable"}</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{italian ? "La data del pagamento non è ancora disponibile." : "A completed payment date is not available yet."}</p></>}</div></div>{period ? <div className="mt-5 h-3 overflow-hidden rounded-full bg-[color:rgba(42,98,87,0.1)]"><div className="h-full rounded-full bg-[linear-gradient(90deg,#0d5c4f,#28775f)]" style={{ width: `${period.progress}%` }} /></div> : null}
        </article>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-[1.55rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.045)] sm:p-6">
          <div className="flex items-center justify-between gap-3"><h3 className="font-serif text-2xl text-[var(--foreground)]">{copy.recentReviews}</h3><Link href={`/businesses/${business.slug}#reviews`} className="shrink-0 text-sm font-semibold text-[var(--primary)] hover:underline">{copy.viewAllReviews} →</Link></div>
          {business.reviews.length ? <div className="mt-5 divide-y divide-[var(--border)]">{business.reviews.slice(0, 2).map((review) => <article key={review.id} className="flex gap-3 py-4 first:pt-0"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--secondary)] text-xs font-bold text-[var(--primary)]">{getInitials(review.authorName)}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><strong className="text-sm text-[var(--foreground)]">{review.authorName}</strong><span className="inline-flex items-center gap-0.5 text-[#e7a13c]">{Array.from({ length: Math.max(0, Math.min(5, Math.round(review.rating))) }, (_, index) => <IconStarFilled key={index} size={14} />)}</span></div>{review.title ? <p className="mt-1 text-sm font-medium text-[var(--foreground)]">{review.title}</p> : null}{review.body ? <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{review.body}</p> : null}<p className="mt-1 text-xs text-[var(--muted)]">{formatReviewDate(locale, review.createdAt)}</p></div></article>)}</div> : <p className="mt-5 rounded-2xl bg-[color:rgba(247,244,239,0.7)] p-4 text-sm text-[var(--muted)]">{copy.emptyReviews}</p>}
        </article>
        <article className="rounded-[1.55rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.045)] sm:p-6"><h3 className="font-serif text-2xl text-[var(--foreground)]">{italian ? "Azioni rapide" : "Quick actions"}</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{italian ? "Mantieni la tua scheda aggiornata e ottieni il massimo da Salento Local." : "Keep your listing up to date and get the most out of Salento Local."}</p><div className="mt-4 divide-y divide-[var(--border)]"><QuickAction href={`/businesses/${business.slug}/edit?step=business`} icon={<IconPencil size={21} />} label={copy.edit} /><QuickAction href={`/businesses/${business.slug}/edit?step=photos`} icon={<IconPhoto size={21} />} label={copy.managePhotos} /><QuickAction href={`/businesses/${business.slug}/edit?step=hours`} icon={<IconClock size={21} />} label={copy.manageHours} /><QuickAction href={`/businesses/${business.slug}#reviews`} icon={<IconStarFilled size={21} />} label={copy.manageReviews} /></div></article>
      </div>
    </section>
  );
}

function SummaryCard({ detail, icon, label, tone, value }: { detail: string; icon: React.ReactNode; label: string; tone?: "star"; value: number | string }) {
  return <article className="flex items-center gap-4 rounded-[1.55rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.045)] sm:p-6"><span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${tone === "star" ? "bg-[color:rgba(231,161,60,0.1)] text-[#e7a13c]" : "bg-[color:rgba(42,98,87,0.1)] text-[var(--primary)]"}`}>{icon}</span><div><strong className="block font-serif text-3xl text-[var(--foreground)]">{value}</strong><span className="mt-0.5 block text-base text-[var(--foreground)]">{label}</span><p className="mt-1 text-sm text-[var(--muted)]">{detail}</p></div></article>;
}

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return <HardNavigationLink href={href} className="flex min-h-14 items-center gap-3 py-3 text-sm font-medium text-[var(--foreground)] transition hover:text-[var(--primary)]"><span className="text-[var(--foreground)]">{icon}</span><span className="min-w-0 flex-1">{label}</span><IconChevronRight size={20} /></HardNavigationLink>;
}
