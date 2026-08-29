import type { Town } from "@prisma/client";
import { IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";

import type { Locale } from "@/lib/i18n";
import { buildTownImage } from "@/lib/site";

export type TownCardTown = Pick<
  Town,
  | "featured"
  | "heroImageSeed"
  | "imageUrl"
  | "name"
  | "province"
  | "shortDescription"
  | "slug"
>;

type TownCardProps = {
  town: TownCardTown;
  businessCount: number;
  thingsToDoCount: number;
  locale?: Locale;
};

export function TownCard({
  town,
  businessCount,
  thingsToDoCount,
  locale = "it",
}: TownCardProps) {
  return (
    <Link
      href={`/towns/${town.slug}`}
      className="group block overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] transition-all hover:border-[color:rgba(42,98,87,0.28)] hover:shadow-lg"
    >
      <div className="relative h-48 overflow-hidden bg-[var(--secondary)]">
        <img
          src={buildTownImage(town, 1200)}
          alt={town.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,23,20,0.55)] to-transparent" />
        <div className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-white/70">{town.province}, Puglia</p>
            <h3 className="font-serif text-xl text-white">{town.name}</h3>
          </div>
          {town.featured ? (
            <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs font-medium text-[var(--accent-foreground)]">
              {locale === "it" ? "In evidenza" : "Featured"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="p-4">
        <p className="line-clamp-2 text-sm leading-relaxed text-[var(--muted)]">
          {town.shortDescription}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">
            {businessCount} {locale === "it" ? "luoghi" : "places"} · {thingsToDoCount}{" "}
            {locale === "it" ? "da scoprire" : "to explore"}
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-all group-hover:gap-1.5">
            {locale === "it" ? "Scopri" : "Discover"}
            <IconChevronRight size={12} />
          </span>
        </div>
      </div>
    </Link>
  );
}
