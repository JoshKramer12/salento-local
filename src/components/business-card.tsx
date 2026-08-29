import Link from "next/link";
import { IconArrowUpRight, IconMapPin, IconStarFilled } from "@tabler/icons-react";

import { CategoryIconGlyph } from "@/components/category-icon-glyph";
import type { Locale } from "@/lib/i18n";
import { getCategoryLabel, type BusinessCardItem } from "@/lib/site";

type BusinessCardProps = {
  business: BusinessCardItem;
  locale?: Locale;
};

export function BusinessCard({ business, locale = "it" }: BusinessCardProps) {
  const category = getCategoryLabel(business.category.slug, business.category.name, locale);
  const photo = business.images?.[0];
  const location = business.address || (business.locality ? business.locality.name : business.town.name);
  const copy = locale === "it"
    ? { openNow: "Aperto ora", viewPlace: "Vedi luogo" }
    : { openNow: "Open now", viewPlace: "View place" };

  return (
    <Link
      href={`/businesses/${business.slug}`}
      className="explore-place-card group block overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_5px_16px_rgba(40,51,48,0.045)] transition-all hover:-translate-y-0.5 hover:border-[color:rgba(42,98,87,0.35)] hover:shadow-[0_16px_30px_rgba(40,51,48,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      aria-label={`${copy.viewPlace}: ${business.name}`}
    >
      <div className="relative aspect-[1.23/0.78] overflow-hidden bg-[linear-gradient(135deg,#fbf7f0,#f1e8da)]">
        {photo ? (
          <img
            src={photo.url}
            alt={photo.alt || business.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.045]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[color:rgba(42,98,87,0.24)]" aria-hidden="true">
            <CategoryIconGlyph slug={business.category.slug} size={30} stroke={1.25} />
          </span>
        )}
        <span className="absolute left-3 top-3 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 truncate rounded-full bg-[rgba(35,80,71,0.92)] px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm">
          <CategoryIconGlyph slug={business.category.slug} size={12} stroke={2} />
          {category}
        </span>
      </div>

      <div className="p-4">
        <h3 className="truncate text-[15px] font-semibold leading-5 text-[var(--foreground)] transition-colors group-hover:text-[var(--primary)]">
          {business.name}
        </h3>
        <p className="mt-1 truncate text-xs text-[var(--muted)]">
          {category} · {business.town.name}
        </p>
        {business.rating > 0 && business.reviewCount > 0 ? (
          <p className="mt-2 flex items-center gap-1 text-xs text-[var(--muted)]">
            <IconStarFilled size={12} className="text-[#bd7925]" />
            <span>{business.rating.toFixed(1)} ({business.reviewCount})</span>
            {business.isOpenNow ? <span className="ml-1 font-medium text-[#35725c]">· {copy.openNow}</span> : null}
          </p>
        ) : business.isOpenNow ? (
          <p className="mt-2 text-xs font-medium text-[#35725c]">{copy.openNow}</p>
        ) : null}
        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]">
          <IconMapPin size={12} className="shrink-0" />
          <span className="truncate">{location}</span>
        </p>
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)]">
          {copy.viewPlace}
          <IconArrowUpRight size={13} />
        </span>
      </div>
    </Link>
  );
}
