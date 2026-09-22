"use client";

import { usePathname } from "next/navigation";
import {
  IconChevronDown,
  IconMapPin,
  IconMenu2,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { AccountMenu } from "@/components/account/account-menu";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { LanguageToggle } from "@/components/language-toggle";
import {
  MobileNavigationDrawer,
  NotificationBadge,
} from "@/components/mobile-navigation-drawer";
import { SearchAutocomplete } from "@/components/search-autocomplete";
import { getDesktopPartnerAddBusinessAction } from "@/lib/account-navigation";
import type { Locale } from "@/lib/i18n";

type HeaderViewer = {
  name?: string | null;
  profileCompleted: boolean;
  role: "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER";
  username: string;
};

type SiteHeaderProps = {
  locale: Locale;
  notificationCount?: number;
  viewer: HeaderViewer | null;
};

const navigation = [
  { href: "/", label: "Home" },
  { href: "/towns", label: "Towns" },
  { href: "/explore", label: "Explore" },
] as const;

export function SiteHeader({ locale, notificationCount = 0, viewer }: SiteHeaderProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileOpen(false), []);
  const copy =
    locale === "it"
      ? {
          addBusiness: "Aggiungi attività",
          earn: "Guadagna con noi",
          forBusiness: "Per le attività",
          login: "Accedi",
          dashboard: "Dashboard",
          discover: "Scopri",
          explore: "Esplora",
          localities: "Località",
          searchPlaceholder: "Cerca in tutto il Salento...",
          towns: "Comuni",
          townsAndLocalities: "Comuni e località",
        }
      : {
          addBusiness: "Add business",
          earn: "Earn with us",
          forBusiness: "For businesses",
          login: "Log in",
          dashboard: "Dashboard",
          discover: "Discover",
          explore: "Explore",
          localities: "Localities",
          searchPlaceholder: "Search across Salento...",
          towns: "Towns",
          townsAndLocalities: "Towns & localities",
        };

  const navItems = navigation.map((item) => ({
    href: item.href,
    label:
      item.label === "Home"
        ? copy.discover
        : item.label === "Towns"
          ? copy.towns
          : copy.explore,
  }));
  const desktopSearchWidthClass = viewer ? "w-[18rem]" : "w-[13rem]";
  const desktopPartnerAddBusinessAction = getDesktopPartnerAddBusinessAction(
    locale,
    viewer?.role,
  );

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1280px)");

    function handleBreakpointChange(event: MediaQueryListEvent) {
      if (event.matches) closeMobileMenu();
    }

    desktopQuery.addEventListener("change", handleBreakpointChange);
    window.addEventListener("popstate", closeMobileMenu);

    return () => {
      desktopQuery.removeEventListener("change", handleBreakpointChange);
      window.removeEventListener("popstate", closeMobileMenu);
    };
  }, [closeMobileMenu]);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[color:rgba(255,248,239,0.96)] backdrop-blur-md">
        <div className="shell px-2 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-2">
          <HardNavigationLink href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)] text-white">
              <IconMapPin size={16} stroke={2.4} />
            </span>
            <span className="site-header-wordmark font-serif text-lg leading-none text-[var(--color-charcoal)]">
              Salento
              <span className="ml-0.5 italic text-[var(--color-terracotta)]">Local</span>
            </span>
          </HardNavigationLink>

          <nav className="hidden items-center gap-2 xl:flex">
            {navItems.map((item) =>
              item.href === "/towns" ? (
                <details key={item.href} className="group relative">
                  <summary
                    className={`nav-link inline-flex list-none items-center gap-1 [&::-webkit-details-marker]:hidden ${
                      pathname.startsWith("/towns") || pathname.startsWith("/localities")
                        ? "nav-link-active"
                        : ""
                    }`}
                  >
                    {item.label}
                    <IconChevronDown size={14} />
                  </summary>
                  <div className="absolute left-0 top-[calc(100%+0.75rem)] w-64 rounded-3xl border border-[var(--color-border)] bg-white p-3 shadow-[var(--shadow-soft)]">
                    <HardNavigationLink
                      href="/towns"
                      className="block rounded-2xl px-3 py-3 text-sm text-[var(--color-charcoal)] hover:bg-[rgba(255,248,239,0.9)]"
                    >
                      {copy.townsAndLocalities}
                    </HardNavigationLink>
                    <HardNavigationLink
                      href="/localities"
                      className="mt-1 block rounded-2xl px-3 py-3 text-sm text-[var(--color-charcoal)] hover:bg-[rgba(255,248,239,0.9)]"
                    >
                      {copy.localities}
                    </HardNavigationLink>
                  </div>
                </details>
              ) : (
                <HardNavigationLink
                  key={item.href}
                  href={item.href}
                  className={`nav-link ${
                    item.href === "/"
                      ? pathname === "/"
                        ? "nav-link-active"
                        : ""
                      : pathname.startsWith(item.href)
                        ? "nav-link-active"
                        : ""
                  }`}
                >
                  {item.label}
                </HardNavigationLink>
              ),
            )}
            {viewer ? (
              <HardNavigationLink
                href="/dashboard"
                className={`nav-link ${pathname.startsWith("/dashboard") ? "nav-link-active" : ""}`}
              >
                {copy.dashboard}
              </HardNavigationLink>
            ) : null}
          </nav>

          <div className="hidden items-center gap-1.5 xl:flex">
            {desktopPartnerAddBusinessAction ? (
              <HardNavigationLink
                href={desktopPartnerAddBusinessAction.href}
                className="btn-primary whitespace-nowrap"
              >
                + {desktopPartnerAddBusinessAction.label}
              </HardNavigationLink>
            ) : viewer?.role !== "BUSINESS_OWNER" ? (
              <LanguageToggle locale={locale} />
            ) : null}
            <SearchAutocomplete
              locale={locale}
              placeholder={copy.searchPlaceholder}
              searchPath="/directory"
              variant="header"
              className={desktopSearchWidthClass}
              inputClassName="text-[var(--color-charcoal)] placeholder:text-[var(--color-muted)]"
            />
            {viewer ? (
              <AccountMenu locale={locale} user={viewer} />
            ) : (
              <>
                <HardNavigationLink href="/signup/business" className="nav-link whitespace-nowrap">
                  {copy.forBusiness}
                </HardNavigationLink>
                <HardNavigationLink href="/login" className="nav-link whitespace-nowrap">
                  {copy.login}
                </HardNavigationLink>
                <HardNavigationLink href="/earn" className="btn-primary whitespace-nowrap">
                  {copy.earn}
                </HardNavigationLink>
              </>
            )}
          </div>

            <div className="flex min-w-0 items-center gap-1 xl:hidden">
              {!viewer ? (
                <HardNavigationLink
                  href="/earn"
                  className="btn-primary inline-flex h-10 shrink-0 whitespace-nowrap rounded-xl px-3 text-xs sm:px-4 sm:text-sm"
                >
                  {copy.earn}
                </HardNavigationLink>
              ) : (
                <HardNavigationLink
                  href="/publish"
                  className="btn-primary inline-flex h-10 shrink-0 whitespace-nowrap rounded-xl px-2.5 text-xs sm:px-3 sm:text-sm"
                >
                  + {copy.addBusiness}
                </HardNavigationLink>
              )}
              <button
                type="button"
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-[var(--color-charcoal)] transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(42,98,87,0.32)]"
                aria-controls="mobile-navigation"
                aria-expanded={mobileOpen}
                aria-label={
                  mobileOpen
                    ? locale === "it"
                      ? "Chiudi menu"
                      : "Close menu"
                    : locale === "it"
                      ? "Apri menu"
                      : "Open menu"
                }
                onClick={() => setMobileOpen((value) => !value)}
              >
                {mobileOpen ? <IconX size={23} /> : <IconMenu2 size={23} />}
                {!mobileOpen && viewer && notificationCount > 0 ? (
                  <NotificationBadge
                    count={notificationCount}
                    className="absolute -right-1 -top-1 ring-2 ring-[var(--color-cream)]"
                  />
                ) : null}
              </button>
            </div>
          </div>
        </div>
      </header>
      <MobileNavigationDrawer
        locale={locale}
        notificationCount={notificationCount}
        onClose={closeMobileMenu}
        open={mobileOpen}
        viewer={viewer}
      />
    </>
  );
}
