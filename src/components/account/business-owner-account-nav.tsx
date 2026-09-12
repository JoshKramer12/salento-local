import { AccountWorkspaceNav } from "@/components/account/account-workspace-nav";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import {
  getBusinessOwnerNavigationItems,
  type BusinessOwnerNavigationKey,
} from "@/lib/business-owner-navigation";
import type { Locale } from "@/lib/i18n";

type BusinessOwnerAccountNavProps = {
  active: BusinessOwnerNavigationKey;
  locale: Locale;
};

function getAriaLabel(locale: Locale) {
  return locale === "it" ? "Navigazione titolare attività" : "Business owner navigation";
}

export function BusinessOwnerWorkspaceNav({ active, locale }: BusinessOwnerAccountNavProps) {
  return (
    <AccountWorkspaceNav
      active={active}
      ariaLabel={getAriaLabel(locale)}
      items={getBusinessOwnerNavigationItems(locale)}
    />
  );
}

export function BusinessOwnerAccountNav({ active, locale }: BusinessOwnerAccountNavProps) {
  const items = getBusinessOwnerNavigationItems(locale);

  return (
    <nav aria-label={getAriaLabel(locale)} className="dashboard-nav-shell mb-8 hidden md:block">
      <div className="dashboard-nav flex flex-wrap gap-2">
        {items.map((item) => (
          <HardNavigationLink
            key={item.key}
            ariaCurrent={active === item.key ? "true" : undefined}
            className={`nav-link ${active === item.key ? "nav-link-active" : ""}`}
            href={item.href}
          >
            {item.label}
          </HardNavigationLink>
        ))}
      </div>
    </nav>
  );
}
