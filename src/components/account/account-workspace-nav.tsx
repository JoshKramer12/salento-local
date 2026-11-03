import { HardNavigationLink } from "@/components/hard-navigation-link";

type AccountWorkspaceNavItem<Key extends string> = {
  href: string;
  key: Key;
  label: string;
};

type AccountWorkspaceNavProps<Key extends string> = {
  active: Key;
  ariaLabel: string;
  columns?: 2 | 3;
  items: readonly AccountWorkspaceNavItem<Key>[];
  scrollable?: boolean;
  sticky?: boolean;
};

/**
 * The compact account navigation used below the mobile site header. Keeping the
 * structure here makes every account area use the same mobile treatment.
 */
export function AccountWorkspaceNav<Key extends string>({
  active,
  ariaLabel,
  columns = 3,
  items,
  scrollable = false,
  sticky = true,
}: AccountWorkspaceNavProps<Key>) {
  return (
    <nav
      aria-label={ariaLabel}
      className={`${sticky ? "sticky top-[72px] z-30" : "relative z-20"} border-b border-[var(--border)] bg-[color:rgba(255,248,239,0.96)] py-2 backdrop-blur-md md:hidden`}
    >
      <div className={scrollable ? "shell flex gap-1 overflow-x-auto overscroll-x-contain px-1 pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : `shell grid ${columns === 2 ? "grid-cols-2" : "grid-cols-3"} gap-1 px-1`}>
        {items.map((item) => {
          const isActive = item.key === active;

          return (
            <HardNavigationLink
              key={item.key}
              ariaCurrent={isActive ? "true" : undefined}
              href={item.href}
              className={`nav-link flex min-h-11 ${scrollable ? "shrink-0" : "min-w-0"} items-center justify-center whitespace-nowrap text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${isActive ? "nav-link-active" : ""}`}
            >
              <span className={scrollable ? "" : "truncate"}>{item.label}</span>
            </HardNavigationLink>
          );
        })}
      </div>
    </nav>
  );
}
