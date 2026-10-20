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
  const startsNewSubmission = href === "/publish" || href === "/publish?mode=admin";

  function prefetchRoute() {
    if (!startsNewSubmission) void router.prefetch(href);
  }

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || !startsNewSubmission || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    const url = new URL(href, window.location.origin);
    url.searchParams.set("new", crypto.randomUUID());
    router.push(`${url.pathname}${url.search}`);
  }

  return (
    <Link
      aria-current={ariaCurrent}
      href={href}
      className={className}
      prefetch={!startsNewSubmission}
      title={title}
      onClick={handleClick}
      onFocus={prefetchRoute}
      onMouseEnter={prefetchRoute}
      onTouchStart={prefetchRoute}
    >
      {children}
    </Link>
  );
}
