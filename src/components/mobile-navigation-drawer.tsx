"use client";

import {
  IconBook2,
  IconBuildingStore,
  IconClipboardText,
  IconCompass,
  IconLayoutDashboard,
  IconLogout,
  IconMapPins,
  IconPlus,
  IconSettings,
  IconHelp,
  IconWallet,
} from "@tabler/icons-react";
import type { UserRole } from "@prisma/client";
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { signOutAction } from "@/app/(account)/sign-out-action";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { LanguageToggle } from "@/components/language-toggle";
import {
  getAccountNavigationItems,
  getDashboardHref,
  getPublishHref,
  type AccountNavigationKey,
} from "@/lib/account-navigation";
import type { Locale } from "@/lib/i18n";

type MobileNavigationViewer = {
  name?: string | null;
  profileCompleted: boolean;
  role: UserRole;
  username: string;
};

type MobileNavigationDrawerProps = {
  locale: Locale;
  notificationCount: number;
  onClose: () => void;
  open: boolean;
  viewer: MobileNavigationViewer | null;
};

const accountIcons = {
  businesses: IconClipboardText,
  dashboard: IconLayoutDashboard,
  earnings: IconWallet,
  guide: IconBook2,
  publish: IconPlus,
} satisfies Record<AccountNavigationKey, typeof IconLayoutDashboard>;

export function MobileNavigationDrawer({
  locale,
  notificationCount,
  onClose,
  open,
  viewer,
}: MobileNavigationDrawerProps) {
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, open]);

  if (!mounted || !open) return null;

  const italian = locale === "it";
  const copy = italian
    ? {
        account: "Il tuo account",
        discover: "Scopri",
        earn: "Guadagna con noi",
        explore: "Esplora",
        exploreSalento: "Esplora il Salento",
        forBusiness: "Per le attività",
        login: "Accedi",
        language: "Lingua",
        logout: "Esci",
        settings: "Impostazioni",
        support: "Assistenza",
        townsAndLocalities: "Comuni e costa",
      }
    : {
        account: "Your account",
        discover: "Discover",
        earn: "Earn with us",
        explore: "Explore",
        exploreSalento: "Explore Salento",
        forBusiness: "For businesses",
        login: "Log in",
        language: "Language",
        logout: "Log out",
        settings: "Settings",
        support: "Support",
        townsAndLocalities: "Towns & coast",
      };
  const displayName = viewer?.name?.trim() || viewer?.username.trim() || "";
  const initial = displayName.charAt(0).toUpperCase() || "?";
  const roleLabel = viewer
    ? getRoleLabel(viewer.role, locale)
    : "";
  const accountItems = viewer
    ? getAccountNavigationItems(locale, viewer.role, {
        addBusinessLabel: true,
        dashboardHref: getDashboardHref(viewer.profileCompleted),
        publishHref: getPublishHref(viewer.role, true),
      })
    : [];
  const publishItem = accountItems.find((item) => item.key === "publish");
  const regularAccountItems = accountItems.filter((item) => item.key !== "publish");

  return createPortal(
    <div
      id="mobile-navigation"
      className="fixed inset-0 z-40 xl:hidden"
      role="dialog"
      aria-label={italian ? "Navigazione principale" : "Main navigation"}
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(36,50,58,0.24)] backdrop-blur-[2px]"
        aria-label={italian ? "Chiudi menu" : "Close menu"}
        onClick={onClose}
      />

      <div className="absolute inset-x-0 bottom-0 top-16 overflow-y-auto overscroll-contain bg-[color:rgba(255,253,249,0.99)] shadow-[0_-12px_40px_rgba(36,50,58,0.1)]">
        <div className="mx-auto w-full max-w-[34rem] px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5">
          {viewer ? (
            <div className="flex items-center gap-3 rounded-[1.4rem] border border-[rgba(232,222,208,0.72)] bg-[linear-gradient(135deg,rgba(246,230,200,0.42),rgba(255,255,255,0.75))] px-4 py-4">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-semibold text-white shadow-sm">
                {initial}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-[var(--foreground)]">
                  {displayName}
                </p>
                <p className="mt-0.5 text-sm text-[var(--muted)]">{roleLabel}</p>
              </div>
            </div>
          ) : null}

          {viewer ? (
            <section className="pt-6" aria-labelledby="mobile-account-heading">
              <h2
                id="mobile-account-heading"
                className="px-1 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--primary)]"
              >
                {copy.account}
              </h2>
              <div className="mt-2 grid gap-0.5">
                {regularAccountItems.map((item) => {
                  const Icon = accountIcons[item.key];

                  return (
                    <HardNavigationLink
                      key={item.key}
                      href={item.href}
                      className="flex min-h-12 items-center gap-3 rounded-2xl px-2 py-2.5 text-[0.96rem] font-medium text-[var(--foreground)] transition hover:bg-white"
                      onClick={onClose}
                    >
                      <Icon size={21} stroke={1.8} className="shrink-0 text-[var(--primary)]" />
                      <span>{item.label}</span>
                      {item.key === "businesses" && notificationCount > 0 ? (
                        <NotificationBadge count={notificationCount} className="ml-auto" />
                      ) : null}
                    </HardNavigationLink>
                  );
                })}
              </div>

              {publishItem ? (
                <HardNavigationLink
                  href={publishItem.href}
                  className="mobile-menu-primary mt-3 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-semibold shadow-[0_12px_28px_rgba(42,98,87,0.2)] transition"
                  onClick={onClose}
                >
                  <IconPlus size={22} />
                  <span>{publishItem.label}</span>
                </HardNavigationLink>
              ) : null}
            </section>
          ) : null}

          <section
            className={`${viewer ? "mt-6 border-t border-[var(--border)] pt-6" : "pt-1"}`}
            aria-labelledby="mobile-explore-heading"
          >
            <h2
              id="mobile-explore-heading"
              className="px-1 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--primary)]"
            >
              {copy.exploreSalento}
            </h2>
            <div className="mt-2 grid gap-0.5">
              <DrawerLink href="/" icon={IconCompass} label={copy.discover} onClose={onClose} />
              <DrawerLink
                href="/towns"
                icon={IconMapPins}
                label={copy.townsAndLocalities}
                onClose={onClose}
              />
              <DrawerLink
                href="/explore"
                icon={IconBuildingStore}
                label={copy.explore}
                onClose={onClose}
              />
            </div>
          </section>

          {viewer?.role !== "BUSINESS_OWNER" ? (
            <section className="mt-6 border-t border-[var(--border)] pt-5" aria-labelledby="mobile-language-heading">
              <h2
                id="mobile-language-heading"
                className="px-1 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--primary)]"
              >
                {copy.language}
              </h2>
              <div className="mt-3 px-1">
                <LanguageToggle locale={locale} />
              </div>
            </section>
          ) : null}

          {!viewer ? (
            <div className="mt-6 grid gap-2 border-t border-[var(--border)] pt-5">
              <HardNavigationLink
                href="/signup/business"
                className="flex min-h-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-white px-4 py-3 font-semibold text-[var(--foreground)]"
                onClick={onClose}
              >
                {copy.forBusiness}
              </HardNavigationLink>
              <HardNavigationLink
                href="/login"
                className="flex min-h-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-white px-4 py-3 font-semibold text-[var(--foreground)]"
                onClick={onClose}
              >
                {copy.login}
              </HardNavigationLink>
              <HardNavigationLink
                href="/earn"
                className="mobile-menu-primary flex min-h-12 items-center justify-center rounded-2xl px-4 py-3 font-semibold shadow-[0_12px_28px_rgba(42,98,87,0.2)]"
                onClick={onClose}
              >
                {copy.earn}
              </HardNavigationLink>
            </div>
          ) : null}

          {viewer ? (
            <div className="mt-6 grid gap-0.5 border-t border-[var(--border)] pt-5">
              {viewer.role === "GETTER" || viewer.role === "BUSINESS_OWNER" ? (
                <DrawerLink href="/dashboard/support" icon={IconHelp} label={copy.support} onClose={onClose} />
              ) : null}
              <DrawerLink
                href="/settings"
                icon={IconSettings}
                label={copy.settings}
                onClose={onClose}
              />
              <form action={signOutAction} onSubmit={onClose}>
                <button
                  type="submit"
                  className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left text-[0.96rem] font-medium text-[var(--foreground)] transition hover:bg-white"
                >
                  <IconLogout size={21} stroke={1.8} className="text-[var(--accent)]" />
                  <span>{copy.logout}</span>
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DrawerLink({
  href,
  icon: Icon,
  label,
  onClose,
}: {
  href: string;
  icon: typeof IconLayoutDashboard;
  label: string;
  onClose: () => void;
}) {
  return (
    <HardNavigationLink
      href={href}
      className="flex min-h-12 items-center gap-3 rounded-2xl px-2 py-2.5 text-[0.96rem] font-medium text-[var(--foreground)] transition hover:bg-white"
      onClick={onClose}
    >
      <Icon size={21} stroke={1.8} className="shrink-0 text-[var(--primary)]" />
      <span>{label}</span>
    </HardNavigationLink>
  );
}

export function NotificationBadge({ count, className = "" }: { count: number; className?: string }) {
  return (
    <span
      className={`inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[rgb(220,38,38)] px-1 text-[0.68rem] font-bold leading-none text-white shadow-sm ${className}`}
      aria-label={`${count} ${count === 1 ? "notification" : "notifications"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function getRoleLabel(role: UserRole, locale: Locale) {
  const labels: Record<UserRole, Record<Locale, string>> = {
    ADMIN: { en: "Administrator", it: "Amministratore" },
    BUSINESS_OWNER: { en: "Business owner", it: "Titolare attivita" },
    GETTER: { en: "Local Partner", it: "Partner locale" },
    USER: { en: "Member", it: "Membro" },
  };

  return labels[role][locale];
}
