"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  IconLayoutDashboard,
  IconLogout,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react";

import { signOutAction } from "@/app/(account)/sign-out-action";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { getDashboardHref, getPublishHref } from "@/lib/account-navigation";
import type { Locale } from "@/lib/i18n";

type AccountMenuProps = {
  locale: Locale;
  user: {
    profileCompleted: boolean;
    role: "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER";
    username: string;
  };
};

function LogoutButton({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center gap-3 rounded-[1rem] px-4 py-3 text-left text-sm text-[var(--foreground)] transition hover:bg-[color:rgba(247,244,239,0.72)]"
    >
      <IconLogout size={18} className="text-[var(--accent)]" />
      <span>{pending ? (locale === "it" ? "Uscita..." : "Logging out...") : label}</span>
    </button>
  );
}

export function AccountMenu({ locale, user }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstLetter = user.username.trim().charAt(0).toUpperCase() || "?";
  const dashboardHref = getDashboardHref(user.profileCompleted);
  const publishHref = getPublishHref(user.role, true);
  const copy =
    locale === "it"
      ? {
          addBusiness: "Aggiungi una nuova attivita",
          dashboard: "Dashboard",
          logout: "Esci",
          settings: "Impostazioni",
        }
      : {
          addBusiness: "Add a new business",
          dashboard: "Dashboard",
          logout: "Log out",
          settings: "Settings",
        };

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={user.username}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-white text-sm font-semibold text-[var(--foreground)] shadow-sm transition hover:border-[rgba(42,98,87,0.28)] hover:text-[var(--primary)]"
        onClick={() => setOpen((current) => !current)}
      >
        {firstLetter}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.7rem)] z-50 w-72 rounded-[1.5rem] border border-[var(--border)] bg-white p-2.5 shadow-[var(--shadow-card)]">
          <div className="rounded-[1.1rem] bg-[color:rgba(247,244,239,0.72)] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--accent)]">
              {copy.settings}
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
              {user.username}
            </p>
          </div>

          <div className="mt-2 grid gap-1">
            <HardNavigationLink
              href={dashboardHref}
              className="flex items-center gap-3 rounded-[1rem] px-4 py-3 text-sm text-[var(--foreground)] transition hover:bg-[color:rgba(247,244,239,0.72)]"
              onClick={() => setOpen(false)}
            >
              <IconLayoutDashboard size={18} className="text-[var(--primary)]" />
              <span>{copy.dashboard}</span>
            </HardNavigationLink>

            <HardNavigationLink
              href={publishHref}
              className="flex items-center gap-3 rounded-[1rem] px-4 py-3 text-sm text-[var(--foreground)] transition hover:bg-[color:rgba(247,244,239,0.72)]"
              onClick={() => setOpen(false)}
            >
              <IconPlus size={18} className="text-[var(--primary)]" />
              <span>{copy.addBusiness}</span>
            </HardNavigationLink>

            <HardNavigationLink
              href="/settings"
              className="flex items-center gap-3 rounded-[1rem] px-4 py-3 text-sm text-[var(--foreground)] transition hover:bg-[color:rgba(247,244,239,0.72)]"
              onClick={() => setOpen(false)}
            >
              <IconSettings size={18} className="text-[var(--primary)]" />
              <span>{copy.settings}</span>
            </HardNavigationLink>

            <form action={signOutAction}>
              <LogoutButton locale={locale} label={copy.logout} />
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
