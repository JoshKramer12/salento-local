import Link from "next/link";
import { IconExternalLink, IconMapPin, IconPhone, IconRoute } from "@tabler/icons-react";

import { BusinessImageGallery } from "@/components/business/business-image-gallery";
import type { Locale } from "@/lib/i18n";

type BusinessHeroImage = { alt: string; id: string; src: string };

type BusinessHeroProps = {
  address: string;
  addressHref: string;
  businessName: string;
  callHref?: string | null;
  claimHref?: string | null;
  categoryLabel: string;
  description?: string | null;
  directionsHref?: string | null;
  imageAlt: string;
  images: BusinessHeroImage[];
  highlights?: readonly string[];
  locale?: Locale;
  localityLabel: string;
  openDetail?: string | null;
  openLabel?: string | null;
  openTone?: "closed" | "open" | null;
  phone?: string | null;
  townHref: string;
  websiteHref?: string | null;
  websiteLabel?: string | null;
};

export function BusinessHero({
  address,
  addressHref,
  businessName,
  callHref,
  claimHref,
  categoryLabel,
  description,
  directionsHref,
  imageAlt,
  images,
  highlights = [],
  locale = "it",
  localityLabel,
  openDetail,
  openLabel,
  openTone = null,
  phone,
  townHref,
  websiteHref,
  websiteLabel,
}: BusinessHeroProps) {
  const gallery = images.length ? images : [{ alt: imageAlt, id: "fallback", src: "" }];
  const copy = locale === "it"
    ? { call: "Chiama", claim: "Rivendica attività", directions: "Indicazioni", website: "Sito web" }
    : { call: "Call", claim: "Claim listing", directions: "Directions", website: "Website" };

  return (
    <section className="overflow-hidden rounded-[1.7rem] border border-[var(--border)] bg-[color:rgba(255,255,255,0.9)] shadow-[0_12px_32px_rgba(66,51,31,0.07)] sm:rounded-[2rem] lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
      <div className="lg:order-2"><BusinessImageGallery images={gallery} /></div>
      <div className="min-w-0 p-5 sm:p-7 lg:order-1 lg:flex lg:flex-col lg:justify-center lg:p-9">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="section-kicker !bg-[rgba(30,111,140,0.08)] !text-[var(--color-blue-deep)]">{categoryLabel}</span>
          {openLabel ? <span className={openTone === "open" ? "pill-success" : "pill-warning"}><span aria-hidden="true">●</span>{openLabel}</span> : null}
        </div>
        <h1 className="mt-4 font-serif text-[2.65rem] leading-[0.95] tracking-[-0.035em] text-[var(--foreground)] sm:text-5xl">{businessName}</h1>
        <div className="mt-4 flex items-start gap-2 text-sm leading-6 text-[var(--muted-strong)]">
          <IconMapPin size={17} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <p>
            <a
              href={addressHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--primary)] hover:underline"
            >
              {address}
            </a>
            {localityLabel ? <>{" "}<a href={townHref} className="font-medium text-[var(--primary)] hover:underline">{localityLabel}</a></> : null}
          </p>
        </div>
        {openDetail ? <p className="mt-2 text-sm font-medium text-[var(--primary)]">{openDetail}</p> : null}
        {highlights.length ? <div className="mt-5 flex flex-wrap gap-2">{highlights.map((highlight) => <span key={highlight} className="rounded-full bg-[rgba(111,143,78,0.12)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)]">{highlight}</span>)}</div> : null}
        {description ? <p className="mt-5 text-[0.98rem] leading-7 text-[var(--muted-strong)]">{description}</p> : null}
        <div className="mt-6 grid gap-2.5 min-[360px]:grid-cols-2">
          {phone && callHref ? <a href={callHref} className="btn-primary min-h-12 px-5"><IconPhone size={17} />{copy.call}</a> : null}
          {directionsHref ? <a href={directionsHref} target="_blank" rel="noreferrer" className="btn-secondary min-h-12 border-[var(--primary)] px-5 !text-[var(--primary)]"><IconRoute size={17} />{copy.directions}</a> : null}
        </div>
        {claimHref ? <Link href={claimHref} className="mt-5 inline-flex w-fit max-w-full items-center text-sm font-medium text-[var(--muted-strong)] underline decoration-[var(--border)] underline-offset-4 transition hover:text-[var(--primary)] hover:decoration-[var(--primary)]">{copy.claim}</Link> : null}
        {websiteHref && websiteLabel ? <a href={websiteHref} target="_blank" rel="noreferrer" className="mt-5 inline-flex max-w-full items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"><span className="font-medium">{copy.website}</span><span className="truncate">{websiteLabel}</span><IconExternalLink size={13} className="shrink-0" /></a> : null}
      </div>
    </section>
  );
}
