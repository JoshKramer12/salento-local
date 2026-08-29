import { HardNavigationLink } from "@/components/hard-navigation-link";
import { getAccountNavigationItems } from "@/lib/account-navigation";
import type { Locale } from "@/lib/i18n";

type PartnerWorkspaceNavProps = {
  active: "businesses" | "dashboard" | "earnings";
  locale: Locale;
};

export function PartnerWorkspaceNav({ active, locale }: PartnerWorkspaceNavProps) {
  const items = getAccountNavigationItems(locale, "GETTER")
    .filter(
      (item) =>
        item.key === "dashboard" || item.key === "businesses" || item.key === "earnings",
    )
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
    <nav
      aria-label={locale === "it" ? "Navigazione area partner" : "Partner workspace navigation"}
      className="sticky top-16 z-30 border-b border-[var(--border)] bg-[color:rgba(255,248,239,0.96)] py-2 backdrop-blur-md md:hidden"
    >
      <div className="shell grid grid-cols-3 gap-1 px-1">
        {items.map((item) => {
          const isActive = item.key === active;

          return (
            <HardNavigationLink
              key={item.key}
              ariaCurrent={isActive ? "true" : undefined}
              href={item.href}
              className={`flex min-h-10 min-w-0 items-center justify-center rounded-xl px-1.5 text-center text-[0.72rem] font-semibold transition sm:text-xs ${
                isActive
                  ? "border border-[rgba(42,98,87,0.14)] bg-white text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted)] hover:bg-white/70 hover:text-[var(--foreground)]"
              }`}
            >
              <span className="truncate">{item.label}</span>
            </HardNavigationLink>
          );
        })}
      </div>
    </nav>
  );
}
