import { HardNavigationLink } from "@/components/hard-navigation-link";
import type { Locale } from "@/lib/i18n";

type BusinessOwnerAccountNavProps = {
  active: "businesses" | "claims" | "drafts";
  locale: Locale;
};

export function BusinessOwnerAccountNav({ active, locale }: BusinessOwnerAccountNavProps) {
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
  const items = [
    { href: "/dashboard", key: "businesses" as const, label: labels.businesses },
    { href: "/dashboard/businesses#drafts", key: "drafts" as const, label: labels.drafts },
    { href: "/claim", key: "claims" as const, label: labels.claims },
  ];

  return (
    <nav aria-label={locale === "it" ? "Navigazione titolare attività" : "Business owner navigation"} className="mb-7 max-w-full sm:mb-8">
      <div className="max-w-full overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max gap-1 rounded-full border border-[var(--border)] bg-[color:rgba(255,253,249,0.9)] p-1 shadow-[0_5px_14px_rgba(66,51,31,0.04)]">
          {items.map((item) => {
            const isActive = active === item.key;

            return (
              <HardNavigationLink
                aria-current={isActive ? "page" : undefined}
                className={`min-h-10 shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition sm:px-5 ${
                  isActive
                    ? "bg-[var(--primary)] text-white shadow-sm"
                    : "text-[var(--muted)] hover:bg-[color:rgba(42,98,87,0.08)] hover:text-[var(--foreground)]"
                }`}
                href={item.href}
                key={item.key}
              >
                {item.label}
              </HardNavigationLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
