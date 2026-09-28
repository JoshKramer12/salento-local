import { HardNavigationLink } from "@/components/hard-navigation-link";
import { AccountWorkspaceNav } from "@/components/account/account-workspace-nav";
import { getAccountNavigationItems } from "@/lib/account-navigation";
import type { AccountNavigationKey } from "@/lib/account-navigation";
import type { Locale } from "@/lib/i18n";

type PartnerWorkspaceNavProps = {
  active: AccountNavigationKey;
  locale: Locale;
};

export function PartnerWorkspaceNav({ active, locale }: PartnerWorkspaceNavProps) {
  const items = getAccountNavigationItems(locale, "GETTER")
    .map((item) => ({
      ...item,
      label:
        item.key === "businesses"
          ? locale === "it"
            ? "Segnalazioni"
            : "Submissions"
          : item.label,
    }));

  return (
    <><AccountWorkspaceNav
      active={active}
      ariaLabel={locale === "it" ? "Navigazione area partner" : "Partner workspace navigation"}
      items={items}
      scrollable
      sticky={false}
    /><div className="shell px-4 py-3 text-right sm:px-6"><HardNavigationLink className="text-sm font-semibold text-[var(--primary)] underline" href="/dashboard/support">{locale === "it" ? "Assistenza" : "Support"}</HardNavigationLink></div></>
  );
}
