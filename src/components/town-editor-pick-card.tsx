import Link from "next/link";
import { IconArrowUpRight, IconMapPin } from "@tabler/icons-react";

import { BusinessSignalPills } from "@/components/business-signal-pills";
import type { Locale } from "@/lib/i18n";
import {
  buildBusinessImage,
  getCategoryHelperText,
  getCategoryLabel,
  type BusinessCardItem,
} from "@/lib/site";

type TownEditorPickCardProps = {
  business: BusinessCardItem & {
    heroImageSeed: string;
    locality?: (BusinessCardItem["locality"] & {
      heroImageSeed: string;
      imageUrl: string | null;
    }) | null;
    town: BusinessCardItem["town"] & {
      heroImageSeed: string;
      imageUrl: string | null;
    };
  };
  locale?: Locale;
};

export function TownEditorPickCard({
  business,
  locale = "it",
}: TownEditorPickCardProps) {
  const location = business.locality
    ? `${business.locality.name}, ${business.town.name}`
    : business.town.name;

  return (
    <Link
      href={`/businesses/${business.slug}`}
      className="group overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--card)] transition-all hover:border-[color:rgba(42,98,87,0.28)] hover:shadow-[0_18px_42px_rgba(26,23,20,0.1)]"
    >
      <div className="relative h-56 overflow-hidden bg-[var(--secondary)]">
        <img
          src={buildBusinessImage(business, business.category.slug, 1400)}
          alt={business.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,23,20,0.6)] via-transparent to-transparent" />
        <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
          <span className="pill bg-[rgba(255,255,255,0.88)] !text-[var(--foreground)]">
            {getCategoryLabel(business.category.slug, business.category.name, locale)}
          </span>
          {business.rating > 0 && business.reviewCount > 0 ? (
            <span className="rounded-full bg-[rgba(255,255,255,0.88)] px-3 py-1 text-xs font-medium text-[var(--foreground)]">
              {business.rating.toFixed(1)} ★
            </span>
          ) : null}
        </div>
      </div>

      <div className="p-6">
        <BusinessSignalPills locale={locale} maxVisible={4} signals={business.signals} />
        <h3 className="mt-4 font-serif text-2xl text-[var(--foreground)] transition-colors group-hover:text-[var(--primary)]">
          {business.name}
        </h3>
        <p className="mt-3 line-clamp-3 text-sm leading-7 text-[var(--muted)]">
          {business.shortDescription || getCategoryHelperText(business.category.slug, locale)}
        </p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]">
            <IconMapPin size={12} />
            <span className="line-clamp-1">{location}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)]">
            {locale === "it" ? "Vedi dettagli" : "View details"}
            <IconArrowUpRight size={12} />
          </span>
        </div>
      </div>
    </Link>
  );
}
