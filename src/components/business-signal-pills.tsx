import type { Locale } from "@/lib/i18n";
import { getBusinessSignalMeta, type BusinessSignal } from "@/lib/site";

type BusinessSignalPillsProps = {
  locale?: Locale;
  maxVisible?: number;
  signals?: BusinessSignal[];
};

function getToneClass(tone: ReturnType<typeof getBusinessSignalMeta>["tone"]) {
  switch (tone) {
    case "accent":
      return "pill-accent";
    case "success":
      return "pill-success";
    case "primary":
      return "pill";
    default:
      return "pill-muted";
  }
}

export function BusinessSignalPills({
  locale = "it",
  maxVisible = 3,
  signals = [],
}: BusinessSignalPillsProps) {
  const visibleSignals = Array.from(new Set(signals)).slice(0, maxVisible);

  if (!visibleSignals.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {visibleSignals.map((signal) => {
        const meta = getBusinessSignalMeta(signal, locale);

        return (
          <span key={signal} className={getToneClass(meta.tone)}>
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}
