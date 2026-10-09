import type { Metadata } from "next";

// SEO URLs are intentionally independent of payment and email return URLs.
export const PUBLIC_SITE_URL = "https://www.salentolocal.ca";

export function publicUrl(path: string) {
  return new URL(path, PUBLIC_SITE_URL).toString();
}

export function discoveryMetadata(
  path: string,
  searchParams: Record<string, string | string[] | undefined> = {},
): Pick<Metadata, "alternates" | "robots"> {
  // Search, filters, sort, view, and pagination remain usable, but are not
  // separate SEO landing pages. In particular, page 2 is not page 1's canonical.
  if (Object.values(searchParams).some((value) => value !== undefined)) {
    return { robots: { index: false, follow: true } };
  }

  return { alternates: { canonical: publicUrl(path) } };
}
