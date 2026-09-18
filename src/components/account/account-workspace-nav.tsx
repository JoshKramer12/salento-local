import { HardNavigationLink } from "@/components/hard-navigation-link";

type AccountWorkspaceNavItem<Key extends string> = {
  href: string;
  key: Key;
  label: string;
};

type AccountWorkspaceNavProps<Key extends string> = {
  active: Key;
  ariaLabel: string;
  items: readonly AccountWorkspaceNavItem<Key>[];
  scrollable?: boolean;
};

/**
 * The compact account navigation used below the mobile site header. Keeping the
 * structure here makes every account area use the same sticky mobile treatment.
 */
export function AccountWorkspaceNav<Key extends string>({
  active,
  ariaLabel,
  items,
  scrollable = false,
}: AccountWorkspaceNavProps<Key>) {
  return (
    <nav
      aria-label={ariaLabel}
      className="sticky top-16 z-30 border-b border-[var(--border)] bg-[color:rgba(255,248,239,0.96)] py-2 backdrop-blur-md md:hidden"
    >
      <div className={scrollable ? "shell flex gap-1 overflow-x-auto px-1 pb-px [scrollbar-width:none]" : "shell grid grid-cols-3 gap-1 px-1"}>
        {items.map((item) => {
          const isActive = item.key === active;

          return (
            <HardNavigationLink
              key={item.key}
              ariaCurrent={isActive ? "true" : undefined}
              href={item.href}
              className={`flex min-h-10 ${scrollable ? "shrink-0 px-3" : "min-w-0 px-1.5"} items-center justify-center rounded-xl text-center text-[0.72rem] font-semibold transition sm:text-xs ${
                isActive
                  ? "border border-[rgba(42,98,87,0.14)] bg-white text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted)] hover:bg-white/70 hover:text-[var(--foreground)]"
              }`}
            >
              <span className={scrollable ? "" : "truncate"}>{item.label}</span>
            </HardNavigationLink>
          );
        })}
      </div>
    </nav>
  );
}
