import Link from "next/link";
import { IconArrowRight } from "@tabler/icons-react";

import { CategoryIconGlyph } from "@/components/category-icon-glyph";
import type { Locale } from "@/lib/i18n";
import { getCategoryHelperText, getCategoryLabel } from "@/lib/site";

type TownCategoryCardProps = {
  category: {
    name: string;
    slug: string;
  };
  count: number;
  locale?: Locale;
  townSlug: string;
};

export function TownCategoryCard({
  category,
  count,
  locale = "it",
  townSlug,
}: TownCategoryCardProps) {
  const placesLabel = locale === "it" ? "luoghi" : "places";

  return (
    <Link
      href={`/towns/${townSlug}?category=${category.slug}#explore`}
      className="group rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.68)] p-5 transition-all hover:border-[color:rgba(42,98,87,0.24)] hover:shadow-[var(--shadow-card)]"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--card)] text-[var(--primary)] shadow-sm">
          <CategoryIconGlyph slug={category.slug} size={22} />
        </span>
        <span className="pill-muted shrink-0">
          {count} {placesLabel}
        </span>
      </div>

      <div className="mt-5">
        <h3 className="font-medium text-[var(--foreground)]">
          {getCategoryLabel(category.slug, category.name, locale)}
        </h3>
        <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
          {getCategoryHelperText(category.slug, locale)}
        </p>
      </div>

      <div className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-all group-hover:gap-1.5">
        {locale === "it" ? "Apri categoria" : "Open category"}
        <IconArrowRight size={12} />
      </div>
    </Link>
  );
}
