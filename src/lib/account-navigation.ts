import type { UserRole } from "@prisma/client";

import type { Locale } from "@/lib/i18n";

export type AccountNavigationKey =
  | "businesses"
  | "claim"
  | "dashboard"
  | "earnings"
  | "guide"
  | "publish";

type AccountNavigationOptions = {
  addBusinessLabel?: boolean;
  dashboardHref?: string;
  publishHref?: string;
};

export function getDashboardHref(profileCompleted: boolean) {
  return profileCompleted ? "/dashboard" : "/complete-profile";
}

export function getPublishHref(role: UserRole, adminMode = false) {
  return role === "ADMIN" && adminMode ? "/publish?mode=admin" : "/publish";
}

export function getDesktopPartnerAddBusinessAction(locale: Locale, role?: UserRole | null) {
  if (role !== "GETTER") {
    return null;
  }

  return {
    href: getPublishHref(role),
    label: locale === "it" ? "Aggiungi attività" : "Add business",
  };
}

export function getAccountNavigationItems(
  locale: Locale,
  role: UserRole,
  options: AccountNavigationOptions = {},
) {
  const italian = locale === "it";

  return [
    {
      href: options.dashboardHref ?? "/dashboard",
      key: "dashboard",
      label: "Dashboard",
    },
    {
      href: "/dashboard/businesses",
      key: "businesses",
      label:
        role === "GETTER"
          ? italian
            ? "Le mie segnalazioni"
            : "My submissions"
          : italian
            ? "Le mie attivita"
            : "My businesses",
    },
    ...(role === "GETTER" || role === "ADMIN"
      ? [
          {
            href: "/dashboard/earnings",
            key: "earnings" as const,
            label: italian ? "Guadagni" : "Earnings",
          },
        ]
      : []),
    ...(role === "GETTER"
      ? [
          {
            href: "/partner/guide",
            key: "guide" as const,
            label: italian ? "Guida" : "Guide",
          },
        ]
      : []),
    ...(role === "BUSINESS_OWNER" || role === "ADMIN"
      ? [
          {
            href: "/claim",
            key: "claim" as const,
            label: italian ? "Rivendica attivita" : "Claim business",
          },
        ]
      : []),
    {
      href: options.publishHref ?? "/publish",
      key: "publish",
      label: options.addBusinessLabel
        ? italian
          ? "Aggiungi un'attivita"
          : "Add a business"
        : italian
          ? "Pubblica attivita"
          : "Publish business",
    },
  ] satisfies {
    href: string;
    key: AccountNavigationKey;
    label: string;
  }[];
}
