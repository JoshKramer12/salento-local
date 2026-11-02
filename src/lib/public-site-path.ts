const publicSiteRoots = [
  "/directory",
  "/explore",
  "/towns",
  "/localities",
  "/businesses",
  "/earn",
  "/privacy",
  "/terms",
  "/cookies",
] as const;

export function isPublicSitePath(pathname: string) {
  if (pathname === "/") return true;
  if (/^\/businesses\/[^/]+\/edit(?:\/|$)/.test(pathname)) return false;
  return publicSiteRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}
