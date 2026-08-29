import { HardNavigationLink } from "@/components/hard-navigation-link";
import { getAccountNavigationItems } from "@/lib/account-navigation";
import type { Locale } from "@/lib/i18n";

type DashboardNavProps = {
  active:
    | "adminBusinesses"
    | "adminUsers"
    | "businesses"
    | "claim"
    | "dashboard"
    | "earnings"
    | "guide"
    | "publish";
  isAdmin?: boolean;
  draftCount?: number;
  locale: Locale;
  role?: "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER";
};

export function DashboardNav({
  active,
  draftCount = 0,
  isAdmin = false,
  locale,
  role = "USER",
}: DashboardNavProps) {
  const items = getAccountNavigationItems(locale, role);

  return (
    <div className="dashboard-nav flex flex-wrap gap-2">
      {items.map((item) => (
        <HardNavigationLink
          key={item.href}
          href={item.href}
          className={`nav-link relative ${active === item.key ? "nav-link-active" : ""}`}
        >
          <span>{item.label}</span>
          {item.key === "businesses" && draftCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[rgb(220,38,38)] px-1 text-[0.68rem] font-semibold leading-none text-white">
              {draftCount > 99 ? "99+" : draftCount}
            </span>
          ) : null}
        </HardNavigationLink>
      ))}
      {isAdmin ? (
        <>
          <HardNavigationLink
            href="/dashboard/businesses?scope=all"
            className={`nav-link ${active === "adminBusinesses" ? "nav-link-active" : ""}`}
          >
            {locale === "it" ? "Tutte le attivita" : "All businesses"}
          </HardNavigationLink>
          <HardNavigationLink
            href="/dashboard/admin/users"
            className={`nav-link ${active === "adminUsers" ? "nav-link-active" : ""}`}
          >
            {locale === "it" ? "Utenti" : "Users"}
          </HardNavigationLink>
        </>
      ) : null}
    </div>
  );
}
