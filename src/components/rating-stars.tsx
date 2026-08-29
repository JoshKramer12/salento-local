type RatingStarsProps = {
  rating: number;
  reviewCount?: number;
  className?: string;
};

export function RatingStars({
  rating,
  reviewCount,
  className,
}: RatingStarsProps) {
  if (!reviewCount || rating <= 0) {
    return (
      <div className={className}>
        <div className="text-sm text-[var(--muted)]">Nessuna recensione verificata</div>
      </div>
    );
  }

  const filled = Math.round(rating);
  const stars = `${"★".repeat(filled)}${"☆".repeat(Math.max(0, 5 - filled))}`;

  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-sm text-[var(--foreground)]">
        <span className="text-[0.95rem] tracking-[0.18em] text-amber-500">
          {stars}
        </span>
        <span className="font-semibold">{rating.toFixed(1)}</span>
        {typeof reviewCount === "number" ? (
          <span className="text-[var(--muted)]">({reviewCount} recensioni)</span>
        ) : null}
      </div>
    </div>
  );
}
