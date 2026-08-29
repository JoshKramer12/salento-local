import Link from "next/link";
import { IconChevronRight, IconMapPin, IconStarFilled } from "@tabler/icons-react";

import { CategoryIconGlyph } from "@/components/category-icon-glyph";
import type { Locale } from "@/lib/i18n";
import { getCategoryLabel, type BusinessCardItem } from "@/lib/site";

type BusinessListRowProps = {
  business: BusinessCardItem;
  locale?: Locale;
};

export function BusinessListRow({ business, locale = "it" }: BusinessListRowProps) {
  const category = getCategoryLabel(business.category.slug, business.category.name, locale);
  const photo = business.images?.[0];
  const location = business.address || (business.locality ? business.locality.name : business.town.name);
  const openNow = locale === "it" ? "Aperto ora" : "Open now";

  return (
    <Link
      href={`/businesses/${business.slug}`}
      className="group flex min-h-[116px] w-full items-stretch overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] text-left shadow-[0_4px_14px_rgba(40,51,48,0.04)] transition-all hover:border-[color:rgba(42,98,87,0.3)] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
    >
      <div className="relative w-28 shrink-0 overflow-hidden bg-[linear-gradient(135deg,#fbf7f0,#f1e8da)] sm:w-40">
        {photo ? (
          <img src={photo.url} alt={photo.alt || business.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[color:rgba(42,98,87,0.24)]" aria-hidden="true">
            <CategoryIconGlyph slug={business.category.slug} size={25} stroke={1.25} />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-3 sm:px-4">
        <p className="truncate text-[11px] font-semibold text-[var(--primary)]">{category}</p>
        <h3 className="mt-0.5 truncate text-sm font-semibold text-[var(--foreground)] transition-colors group-hover:text-[var(--primary)] sm:text-[15px]">{business.name}</h3>
        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{category} · {business.town.name}</p>
        {business.rating > 0 && business.reviewCount > 0 ? (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--muted)]">
            <IconStarFilled size={11} className="text-[#bd7925]" />
            {business.rating.toFixed(1)} ({business.reviewCount})
            {business.isOpenNow ? <span className="font-medium text-[#35725c]">· {openNow}</span> : null}
          </p>
        ) : null}
        <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-[var(--muted)]">
          <IconMapPin size={11} className="shrink-0" />
          <span className="truncate">{location}</span>
        </p>
      </div>
      <span className="flex w-8 shrink-0 items-center justify-center pr-2 text-[var(--muted)]"><IconChevronRight size={17} /></span>
    </Link>
  );
}
