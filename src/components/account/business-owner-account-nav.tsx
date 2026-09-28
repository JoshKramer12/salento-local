import { AccountWorkspaceNav } from "@/components/account/account-workspace-nav";
import { DraftCountBadge } from "@/components/account/dashboard-nav";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import {
  getBusinessOwnerNavigationItems,
  type BusinessOwnerNavigationKey,
} from "@/lib/business-owner-navigation";
import type { Locale } from "@/lib/i18n";

type BusinessOwnerAccountNavProps = {
  active: BusinessOwnerNavigationKey;
  draftCount?: number;
  locale: Locale;
};

function getAriaLabel(locale: Locale) {
  return locale === "it" ? "Navigazione titolare attività" : "Business owner navigation";
}

export function BusinessOwnerWorkspaceNav({ active, locale }: BusinessOwnerAccountNavProps) {
  return (
    <><AccountWorkspaceNav
      active={active}
      ariaLabel={getAriaLabel(locale)}
      columns={2}
      scrollable
      items={getBusinessOwnerNavigationItems(locale)}
    /><div className="shell hidden px-4 py-3 text-right sm:px-6 md:block"><HardNavigationLink className="text-sm font-semibold text-[var(--primary)] underline" href="/dashboard/support">{locale === "it" ? "Assistenza" : "Support"}</HardNavigationLink></div></>
  );
}

export function BusinessOwnerAccountNav({ active, draftCount = 0, locale }: BusinessOwnerAccountNavProps) {
  const items = getBusinessOwnerNavigationItems(locale);

  return (
    <nav aria-label={getAriaLabel(locale)} className="dashboard-nav-shell mb-8 hidden md:block">
      <div className="dashboard-nav flex flex-wrap gap-2">
        {items.map((item) => (
          <HardNavigationLink
            key={item.key}
            ariaCurrent={active === item.key ? "true" : undefined}
            className={`nav-link relative ${active === item.key ? "nav-link-active" : ""}`}
            href={item.href}
          >
            <span>{item.label}</span>
            {item.key === "drafts" ? (
              <DraftCountBadge className="absolute -right-1 -top-1" count={draftCount} />
            ) : null}
          </HardNavigationLink>
        ))}
      </div>
    </nav>
  );
}
