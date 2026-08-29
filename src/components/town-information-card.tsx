import { IconExternalLink } from "@tabler/icons-react";

import type { Locale } from "@/lib/i18n";

type TownInformationCardProps = {
  facts: Array<{
    label: string;
    value: string;
    href?: string;
  }>;
  locale?: Locale;
  quickFacts?: string[];
};

export function TownInformationCard({
  facts,
  locale = "it",
  quickFacts = [],
}: TownInformationCardProps) {
  return (
    <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-7">
      <p className="section-kicker mb-3">{locale === "it" ? "Informazioni" : "Town information"}</p>
      <h2 className="font-serif text-2xl text-[var(--foreground)]">
        {locale === "it" ? "Informazioni utili" : "Useful details"}
      </h2>

      <div className="mt-6 space-y-4 text-sm">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4 last:border-b-0 last:pb-0">
            <span className="text-[var(--muted)]">{fact.label}</span>
            {fact.href ? (
              <a
                href={fact.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-right font-medium text-[var(--primary)] transition-colors hover:text-[var(--color-blue-deep)]"
              >
                <span className="line-clamp-1 max-w-[14rem]">{fact.value}</span>
                <IconExternalLink size={14} />
              </a>
            ) : (
              <span className="text-right font-medium text-[var(--foreground)]">{fact.value}</span>
            )}
          </div>
        ))}
      </div>

      {quickFacts.length ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {quickFacts.map((fact) => (
            <span key={fact} className="pill-muted">
              {fact}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
