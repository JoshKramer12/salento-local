import Link from "next/link";

import type { Locale } from "@/lib/i18n";
import { categoryIcons, fallbackCategoryIcon, getCategoryLabel } from "@/lib/site";

type CategoryTileProps = {
  slug: string;
  name: string;
  count: number;
  locale?: Locale;
};

export function CategoryTile({
  slug,
  name,
  count,
  locale = "it",
}: CategoryTileProps) {
  const IconComponent = categoryIcons[slug] ?? fallbackCategoryIcon;

  return (
    <Link
      href={`/directory?category=${slug}`}
      className="group flex flex-col items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 transition-all hover:border-[color:rgba(42,98,87,0.28)] hover:shadow-md sm:p-4"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--secondary)] text-[var(--primary)] sm:h-12 sm:w-12">
          <IconComponent size={24} stroke={1.75} />
      </span>
      <span className="text-center text-xs font-medium leading-tight text-[var(--foreground)] sm:text-sm">
        {getCategoryLabel(slug, name, locale)}
      </span>
      <span className="hidden text-[11px] text-[var(--muted)] sm:block">
        {count} {locale === "it" ? "risultati" : "results"}
      </span>
    </Link>
  );
}
