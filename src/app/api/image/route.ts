import { NextRequest } from "next/server";

import {
  isAllowedRemoteImageUrl,
  isRemoteImageSizeAllowed,
  isSafeRemoteImageContentType,
} from "@/lib/remote-image";

const DEFAULT_WIDTH = 1600;
const MAX_WIDTH = 2200;
const MIN_WIDTH = 200;

function clampWidth(value: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}

function normalizeRemoteUrl(rawUrl: string, width: number) {
  const url = new URL(rawUrl);

  if (!isAllowedRemoteImageUrl(url)) {
    throw new Error("Unsupported protocol");
  }

  if (
    url.hostname === "commons.wikimedia.org" &&
    url.pathname.startsWith("/wiki/Special:Redirect/file/")
  ) {
    url.pathname = url.pathname.replace(
      "/wiki/Special:Redirect/file/",
      "/wiki/Special:FilePath/",
    );
    url.searchParams.delete("width");
    url.searchParams.set("width", String(width));
  }

  if (
    url.hostname === "commons.wikimedia.org" &&
    url.pathname.startsWith("/wiki/Special:FilePath/")
  ) {
    url.searchParams.delete("width");
    url.searchParams.set("width", String(width));
  }

  if (url.hostname === "upload.wikimedia.org") {
    const segments = url.pathname.split("/").filter(Boolean);
    const wikiIndex = segments.indexOf("wikipedia");
    const repo = wikiIndex >= 0 ? segments[wikiIndex + 1] : null;
    const thumbIndex = segments.indexOf("thumb");
    const filename = thumbIndex >= 0 ? segments[thumbIndex + 3] : segments.at(-1);

    if (repo && filename) {
      const decodedFilename = decodeURIComponent(filename);
      const baseHost =
        repo === "commons" ? "commons.wikimedia.org" : `${repo}.wikipedia.org`;
      const normalized = new URL(
        `/wiki/Special:FilePath/${encodeURIComponent(decodedFilename)}`,
        `https://${baseHost}`,
      );
      normalized.searchParams.set("width", String(width));
      return normalized.toString();
    }
  }

  return url.toString();
}

async function fetchTrustedRemoteImage(url: string) {
  let currentUrl = new URL(url);

  // Do not let a permitted Wikimedia URL turn this endpoint into a general
  // purpose proxy through an HTTP redirect.
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!isAllowedRemoteImageUrl(currentUrl)) {
      return null;
    }

    const response = await fetch(currentUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*;q=0.8",
        "User-Agent": "SalentoDirectory/1.0 (+image proxy)",
      },
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");

      if (!location) {
        return null;
      }

      currentUrl = new URL(location, currentUrl);
      continue;
    }

    return response;
  }

  return null;
}

function buildFallbackUrl(request: NextRequest) {
  const seed = request.nextUrl.searchParams.get("seed");
  const label = request.nextUrl.searchParams.get("label");
  const type = request.nextUrl.searchParams.get("type") ?? "business";

  if (!seed || !label) {
    return null;
  }

  const params = new URLSearchParams({
    seed,
    label,
    type,
  });

  return new URL(`/api/placeholder?${params.toString()}`, request.nextUrl.origin);
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  const rawWidth = Number(request.nextUrl.searchParams.get("w") ?? DEFAULT_WIDTH);
  const width = clampWidth(Number.isFinite(rawWidth) ? rawWidth : DEFAULT_WIDTH);
  const fallbackUrl = buildFallbackUrl(request);

  if (!rawUrl) {
    return fallbackUrl
      ? Response.redirect(fallbackUrl)
      : new Response("Missing url", { status: 400 });
  }

  let remoteUrl: string;

  try {
    remoteUrl = normalizeRemoteUrl(rawUrl, width);
  } catch {
    return fallbackUrl
      ? Response.redirect(fallbackUrl)
      : new Response("Invalid url", { status: 400 });
  }

  let upstream: Response | null;

  try {
    upstream = await fetchTrustedRemoteImage(remoteUrl);
  } catch {
    return fallbackUrl
      ? Response.redirect(fallbackUrl)
      : new Response("Unable to load image", { status: 502 });
  }

  if (!upstream?.ok || !upstream.body) {
    return fallbackUrl
      ? Response.redirect(fallbackUrl)
      : new Response("Unable to load image", {
          status: upstream?.status || 502,
        });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const contentLength = upstream.headers.get("content-length");

  if (
    !isSafeRemoteImageContentType(contentType) ||
    !isRemoteImageSizeAllowed(contentLength)
  ) {
    return fallbackUrl
      ? Response.redirect(fallbackUrl)
      : new Response("Invalid image response", { status: 502 });
  }

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000");
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
