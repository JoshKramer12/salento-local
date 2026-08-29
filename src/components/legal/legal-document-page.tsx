import Link from "next/link";

import type { CookieTableRow, LegalSection } from "@/lib/legal";
import { getLegalLinks, getLegalPageLabels } from "@/lib/legal";
import type { Locale } from "@/lib/i18n";

type LegalDocumentPageProps = {
  cookieTable?: CookieTableRow[];
  locale: Locale;
  sections: LegalSection[];
  summary: string;
  title: string;
  updatedAt: string;
  version: string;
};

export function LegalDocumentPage({
  cookieTable,
  locale,
  sections,
  summary,
  title,
  updatedAt,
  version,
}: LegalDocumentPageProps) {
  const labels = getLegalPageLabels(locale);
  const links = getLegalLinks(locale);

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <section className="rounded-[2rem] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(237,232,223,0.86))] p-8 shadow-[var(--shadow-soft)] sm:p-10">
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/" className="font-medium text-[var(--primary)]">
              {labels.backToSite}
            </Link>
            <Link href={links.terms.href} className="text-[var(--muted)] hover:text-[var(--foreground)]">
              {links.terms.label}
            </Link>
            <Link
              href={links.privacy.href}
              className="text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              {links.privacy.label}
            </Link>
            <Link
              href={links.cookies.href}
              className="text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              {links.cookies.label}
            </Link>
          </div>

          <p className="section-kicker mt-6 mb-3">
            {locale === "it" ? "Documenti legali" : "Legal documents"}
          </p>
          <h1 className="max-w-3xl font-serif text-4xl text-[var(--foreground)] sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-3xl text-[var(--muted)]">{summary}</p>
          <p className="mt-6 text-sm text-[var(--muted)]">
            {labels.lastUpdated}: {updatedAt}
            {" · "}
            {labels.version}: {version}
          </p>
        </section>

        <article className="card mt-8 p-6 sm:p-8">
          <div className="grid gap-8">
            {sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-28">
                <h2 className="font-serif text-2xl text-[var(--foreground)]">{section.title}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph} className="mt-4 text-sm leading-7 text-[var(--foreground)]">
                    {paragraph}
                  </p>
                ))}
                {section.bullets?.length ? (
                  <ul className="mt-4 space-y-3 pl-5 text-sm leading-7 text-[var(--foreground)] list-disc">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
                {cookieTable && section.id === "table" ? (
                  <div className="mt-5 overflow-x-auto rounded-[1.5rem] border border-[var(--border)]">
                    <table className="min-w-full divide-y divide-[var(--border)] text-left text-sm">
                      <thead className="bg-[color:rgba(247,244,239,0.7)] text-[var(--foreground)]">
                        <tr>
                          <th className="px-4 py-3 font-medium">
                            {locale === "it" ? "Nome" : "Name"}
                          </th>
                          <th className="px-4 py-3 font-medium">
                            {locale === "it" ? "Categoria" : "Category"}
                          </th>
                          <th className="px-4 py-3 font-medium">
                            {locale === "it" ? "Provider" : "Provider"}
                          </th>
                          <th className="px-4 py-3 font-medium">
                            {locale === "it" ? "Finalita" : "Purpose"}
                          </th>
                          <th className="px-4 py-3 font-medium">
                            {locale === "it" ? "Durata" : "Duration"}
                          </th>
                          <th className="px-4 py-3 font-medium">
                            {locale === "it" ? "Consenso" : "Consent required"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] bg-white text-[var(--foreground)]">
                        {cookieTable.map((row) => (
                          <tr key={row.name}>
                            <td className="px-4 py-4 align-top">{row.name}</td>
                            <td className="px-4 py-4 align-top">{row.category}</td>
                            <td className="px-4 py-4 align-top">{row.provider}</td>
                            <td className="px-4 py-4 align-top">{row.purpose}</td>
                            <td className="px-4 py-4 align-top">{row.duration}</td>
                            <td className="px-4 py-4 align-top">{row.consentRequired}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}
