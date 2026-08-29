"use client";

import { IconChevronDown, IconStarFilled } from "@tabler/icons-react";
import { useState } from "react";

import type { Locale } from "@/lib/i18n";

type Review = {
  authorName: string;
  body: string;
  createdAt: string;
  id: string;
  rating: number;
  title: string;
};

type BusinessReviewsProps = {
  locale: Locale;
  rating: number;
  reviewCount: number;
  reviews: Review[];
};

export function BusinessReviews({ locale, rating, reviewCount, reviews }: BusinessReviewsProps) {
  const [showAll, setShowAll] = useState(false);
  const copy = locale === "it"
    ? { empty: "Ancora nessuna recensione", emptyBody: "Condividi per primo la tua esperienza.", reviews: "recensioni", seeAll: "Vedi tutte", title: "Recensioni" }
    : { empty: "No reviews yet", emptyBody: "Be the first to share your experience.", reviews: "reviews", seeAll: "See all", title: "Reviews" };
  const visibleReviews = showAll ? reviews : reviews.slice(0, 3);

  return (
    <section className="rounded-[1.7rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.05)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.title}</h2>
          {reviewCount > 0 && rating > 0 ? (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 text-amber-500"><IconStarFilled size={17} /> <strong className="text-[var(--foreground)]">{rating.toFixed(1)}</strong></span>
              <span className="text-[var(--muted)]">({reviewCount} {copy.reviews})</span>
            </div>
          ) : null}
        </div>
        {reviews.length > 3 ? <button type="button" onClick={() => setShowAll((value) => !value)} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline">{showAll ? locale === "it" ? "Mostra meno" : "Show less" : copy.seeAll}<IconChevronDown className={showAll ? "rotate-180 transition-transform" : "transition-transform"} size={15} /></button> : null}
      </div>

      {reviews.length ? (
        <div className="mt-5 space-y-3">
          {visibleReviews.map((review) => (
            <article key={review.id} className="rounded-[1.3rem] border border-[rgba(232,222,208,0.76)] bg-[color:rgba(247,244,239,0.62)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-medium text-[var(--foreground)]">{review.authorName}</p>{review.title ? <h3 className="mt-1 text-sm font-semibold text-[var(--foreground)]">{review.title}</h3> : null}</div>
                <div className="text-right text-xs text-[var(--muted)]"><span className="block text-amber-500">{"★".repeat(Math.round(review.rating))}</span>{review.createdAt}</div>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{review.body}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-[1.25rem] border border-dashed border-[var(--border)] bg-[color:rgba(247,244,239,0.58)] px-4 py-4"><p className="font-medium text-[var(--foreground)]">{copy.empty}</p><p className="mt-1 text-sm text-[var(--muted)]">{copy.emptyBody}</p></div>
      )}
    </section>
  );
}
