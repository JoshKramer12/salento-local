import { getSafeInternalRedirect } from "@/lib/redirects";

const BUSINESS_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type BusinessOrigin = {
  name: string;
  slug: string;
  townId: string;
};

export function buildBusinessOriginHref(destination: string, businessSlug: string) {
  const safeDestination = getSafeInternalRedirect(destination);

  if (!safeDestination) {
    return "/towns";
  }

  const url = new URL(safeDestination, "https://salentolocal.invalid");
  url.searchParams.set("fromBusiness", businessSlug);

  return `${url.pathname}${url.search}${url.hash}`;
}

export function getBusinessOriginSlug(value: string | null | undefined) {
  const slug = value?.trim();

  return slug && slug.length <= 160 && BUSINESS_SLUG_PATTERN.test(slug) ? slug : null;
}

export function resolveBusinessBackLink(
  fromBusiness: string | null | undefined,
  business: BusinessOrigin | null,
  destinationTownId: string,
) {
  const businessSlug = getBusinessOriginSlug(fromBusiness);

  if (
    !businessSlug ||
    !business ||
    business.slug !== businessSlug ||
    business.townId !== destinationTownId
  ) {
    return null;
  }

  return {
    href: `/businesses/${business.slug}`,
    name: business.name,
  };
}
