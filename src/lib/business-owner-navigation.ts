import type { Locale } from "@/lib/i18n";

export type BusinessOwnerNavigationKey = "businesses" | "drafts";

export function getBusinessOwnerNavigationItems(locale: Locale) {
  const labels =
    locale === "it"
      ? {
          businesses: "Le mie attività",
          drafts: "Bozze",
        }
      : {
          businesses: "My businesses",
          drafts: "Drafts",
        };

  return [
    { href: "/dashboard", key: "businesses" as const, label: labels.businesses },
    { href: "/dashboard/businesses#drafts", key: "drafts" as const, label: labels.drafts },
  ] satisfies { href: string; key: BusinessOwnerNavigationKey; label: string }[];
}
