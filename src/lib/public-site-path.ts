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

const sharedAccountRoots = [
  "/dashboard",
  "/settings",
  "/manage-business",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/claim",
  "/publish",
  "/signup",
  "/partner/guide",
] as const;

const specializedWorkflowRoots = [
  "/dashboard/membership/payment",
  "/dashboard/membership/bank-transfer",
  "/dashboard/membership/recovery-unavailable",
  "/dashboard/refund",
  "/publish/payment",
  "/signup/business/details",
  "/signup/business/join",
] as const;

function matchesPathRoot(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function usesRedesignedSiteHeader(pathname: string) {
  if (isPublicSitePath(pathname)) return true;
  if (/^\/businesses\/[^/]+\/edit(?:\/|$)/.test(pathname)) return true;

  return sharedAccountRoots.some((root) => matchesPathRoot(pathname, root))
    && !specializedWorkflowRoots.some((root) => matchesPathRoot(pathname, root));
}
