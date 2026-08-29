import Link from "next/link";

import type { Locale } from "@/lib/i18n";

type OwnedBusinessListItem = {
  address: string;
  categoryName: string;
  name: string;
  shortDescription: string;
  slug: string;
  townName: string;
  updatedAt: Date;
};

type OwnedBusinessListProps = {
  businesses: OwnedBusinessListItem[];
  locale: Locale;
};

export function OwnedBusinessList({ businesses, locale }: OwnedBusinessListProps) {
  const copy =
    locale === "it"
      ? {
          edit: "Modifica profilo attivita",
          empty: "Non ci sono ancora attivita collegate al tuo account.",
          publicPage: "Pagina pubblica",
          updated: "Aggiornata",
        }
      : {
          edit: "Edit business profile",
          empty: "There are no businesses connected to your account yet.",
          publicPage: "View Page",
          updated: "Updated",
        };

  if (!businesses.length) {
    return <div className="card p-6 text-sm text-[var(--muted)]">{copy.empty}</div>;
  }

  return (
    <div className="grid gap-4">
      {businesses.map((business) => (
        <article key={business.slug} className="card grid gap-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-serif text-2xl text-[var(--foreground)]">{business.name}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {business.categoryName} · {business.townName}
              </p>
              <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                {business.shortDescription}
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">{business.address}</p>
            </div>
            <span className="rounded-full bg-[color:rgba(42,98,87,0.1)] px-3 py-1 text-xs font-medium text-[var(--primary)]">
              {copy.updated}:{" "}
              {new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
                dateStyle: "medium",
              }).format(business.updatedAt)}
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href={`/businesses/${business.slug}`} className="btn-secondary">
              {copy.publicPage}
            </Link>
            <Link href={`/businesses/${business.slug}/edit`} className="btn-primary">
              {copy.edit}
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
