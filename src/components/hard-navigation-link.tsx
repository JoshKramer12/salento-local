"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type HardNavigationLinkProps = {
  ariaCurrent?: "true" | undefined;
  children: React.ReactNode;
  className?: string;
  href: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  title?: string;
};

export function HardNavigationLink({
  ariaCurrent,
  children,
  className,
  href,
  onClick,
  title,
}: HardNavigationLinkProps) {
  const router = useRouter();

  function prefetchRoute() {
    void router.prefetch(href);
  }

  return (
    <Link
      aria-current={ariaCurrent}
      href={href}
      className={className}
      prefetch
      title={title}
      onClick={onClick}
      onFocus={prefetchRoute}
      onMouseEnter={prefetchRoute}
      onTouchStart={prefetchRoute}
    >
      {children}
    </Link>
  );
}
