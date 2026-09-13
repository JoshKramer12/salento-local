import Link from "next/link";
import { IconMapPin, IconPointFilled, IconStarFilled } from "@tabler/icons-react";

import { CategoryIconGlyph } from "@/components/category-icon-glyph";
import type { Locale } from "@/lib/i18n";
import { getCategoryLabel, type BusinessCardItem } from "@/lib/site";

type BusinessCardProps = { business: BusinessCardItem; locale?: Locale };

export function BusinessCard({ business, locale = "it" }: BusinessCardProps) {
  const category = getCategoryLabel(business.category.slug, business.category.name, locale);
  const photo = business.images?.[0];
  const location = business.address || (business.locality ? business.locality.name : business.town.name);
  const copy = locale === "it" ? { openNow: "Aperto ora", viewPlace: "Vedi luogo" } : { openNow: "Open now", viewPlace: "View place" };

  return <Link href={`/businesses/${business.slug}`} className="explore-place-card group block overflow-hidden rounded-2xl border border-[var(--border)] bg-[rgba(255,255,255,0.88)] shadow-[0_5px_16px_rgba(40,51,48,0.045)] transition-all hover:-translate-y-0.5 hover:border-[color:rgba(42,98,87,0.35)] hover:shadow-[0_16px_30px_rgba(40,51,48,0.1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]" aria-label={`${copy.viewPlace}: ${business.name}`}>
    <div className="relative aspect-[1.27/0.82] overflow-hidden bg-[linear-gradient(135deg,#fffaf1,#ede1ce)]">
      {photo ? <img src={photo.url} alt={photo.alt || business.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.045]" loading="lazy" decoding="async" /> : <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[color:rgba(42,98,87,0.45)]" aria-hidden="true"><span className="flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(42,98,87,0.18)] bg-white/50"><CategoryIconGlyph slug={business.category.slug} size={25} stroke={1.35} /></span></span>}
      <span className="absolute bottom-2.5 left-2.5 inline-flex max-w-[calc(100%-1.25rem)] items-center gap-1.5 truncate rounded-full bg-[rgba(255,255,255,0.94)] px-2.5 py-1 text-[10px] font-semibold text-[var(--primary)] shadow-sm"><CategoryIconGlyph slug={business.category.slug} size={11} stroke={2} />{category}</span>
    </div>
    <div className="min-w-0 p-3.5 sm:p-4">
      <h3 className="truncate text-[15px] font-semibold leading-5 text-[var(--foreground)] transition-colors group-hover:text-[var(--primary)]">{business.name}</h3>
      <p className="mt-1 truncate text-xs text-[var(--muted)]">{business.town.name}</p>
      <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]"><IconMapPin size={13} className="shrink-0" /><span className="truncate">{location}</span></p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
        {business.isOpenNow ? <span className="inline-flex items-center gap-1 font-medium text-[#35725c]"><IconPointFilled size={14} />{copy.openNow}</span> : null}
        {business.rating > 0 && business.reviewCount > 0 ? <span className="inline-flex items-center gap-1"><IconStarFilled size={13} className="text-[#c47c18]" />{business.rating.toFixed(1)} ({business.reviewCount})</span> : null}
      </div>
    </div>
  </Link>;
}
