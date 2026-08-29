export function getSafeInternalRedirect(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  // Backslashes are treated as forward slashes by some URL consumers.  Reject
  // them (and their percent-encoded form) so an input such as `/\\evil.test`
  // can never become a scheme-relative external redirect.
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /%2f|%5c|[\u0000-\u001f\u007f]/i.test(value)
  ) {
    return null;
  }

  try {
    const base = new URL("https://salentolocal.invalid");
    const resolved = new URL(value, base);

    if (resolved.origin !== base.origin) {
      return null;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}
