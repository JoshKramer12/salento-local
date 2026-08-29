const allowedImageHosts = new Set([
  "commons.wikimedia.org",
  "upload.wikimedia.org",
]);

export const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024;

function isAllowedWikipediaHost(hostname: string) {
  return hostname.endsWith(".wikipedia.org");
}

export function isAllowedRemoteImageUrl(value: string | URL) {
  const url = typeof value === "string" ? new URL(value) : value;

  return (
    url.protocol === "https:" &&
    (allowedImageHosts.has(url.hostname.toLowerCase()) ||
      isAllowedWikipediaHost(url.hostname.toLowerCase()))
  );
}

export function isSafeRemoteImageContentType(value: string | null) {
  if (!value) {
    return false;
  }

  const contentType = value.split(";", 1)[0]?.trim().toLowerCase();
  return Boolean(
    contentType &&
      ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(
        contentType,
      ),
  );
}

export function isRemoteImageSizeAllowed(value: string | null) {
  if (!value) {
    return true;
  }

  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= MAX_REMOTE_IMAGE_BYTES;
}
