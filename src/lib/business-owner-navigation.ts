import type { Locale } from "@/lib/i18n";

export type BusinessOwnerNavigationKey = "businesses" | "claims" | "drafts";

export function getBusinessOwnerNavigationItems(locale: Locale) {
  const labels =
    locale === "it"
      ? {
          businesses: "Le mie attività",
          claims: "Rivendicazioni",
          drafts: "Bozze",
        }
      : {
          businesses: "My businesses",
          claims: "Claims",
          drafts: "Drafts",
        };

  return [
    { href: "/dashboard", key: "businesses" as const, label: labels.businesses },
    { href: "/dashboard/businesses#drafts", key: "drafts" as const, label: labels.drafts },
    { href: "/claim", key: "claims" as const, label: labels.claims },
  ] satisfies { href: string; key: BusinessOwnerNavigationKey; label: string }[];
}
