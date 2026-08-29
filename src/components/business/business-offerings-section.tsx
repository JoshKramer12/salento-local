import { IconSparkles } from "@tabler/icons-react";

import type { Locale } from "@/lib/i18n";

type BusinessOfferingsSectionProps = {
  items: readonly string[];
  kicker?: string;
  locale?: Locale;
};

export function BusinessOfferingsSection({
  items,
  kicker,
  locale = "it",
}: BusinessOfferingsSectionProps) {
  const copy =
    locale === "it"
      ? {
          title: "Cosa trovi qui",
        }
      : {
          title: "What you can find here",
        };

  return (
    <section className="rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-8">
      <p className="section-kicker">{kicker || copy.title}</p>
      <h2 className="mt-3 font-serif text-3xl text-[var(--foreground)]">{copy.title}</h2>

      <div className="mt-6 flex flex-wrap gap-3">
        {items.map((item) => (
          <div
            key={item}
            className="inline-flex min-h-[4.25rem] max-w-full items-center gap-3 rounded-full border border-[var(--border)] bg-[color:rgba(247,244,239,0.88)] px-4 py-3 text-sm text-[var(--foreground)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[var(--card)] text-[var(--accent)]">
              <IconSparkles size={15} />
            </span>
            <span className="leading-6">{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
