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
};

/**
 * The compact account navigation used below the mobile site header. Keeping the
 * structure here makes every account area use the same sticky mobile treatment.
 */
export function AccountWorkspaceNav<Key extends string>({
  active,
  ariaLabel,
  items,
}: AccountWorkspaceNavProps<Key>) {
  return (
    <nav
      aria-label={ariaLabel}
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
