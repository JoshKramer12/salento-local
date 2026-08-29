import type { NextRequest } from "next/server";

type RequestWithNextUrl = Request & {
  nextUrl?: {
    host: string;
    origin: string;
    protocol: string;
  };
};

export function getOriginFromHeaders(_headers: Headers, fallbackOrigin?: string) {
  const configured =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`
      : "");

  if (configured) {
    try {
      const url = new URL(configured);

      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      // A deployment configuration error must not make request headers trusted.
    }
  }

  if (fallbackOrigin) {
    try {
      return new URL(fallbackOrigin).origin;
    } catch {
      // Fall through to the local development default.
    }
  }

  return "http://localhost:3000";
}

export function getRequestOrigin(request: NextRequest | Request) {
  const typedRequest = request as RequestWithNextUrl;
  const requestUrl = new URL(request.url);
  const fallbackOrigin = typedRequest.nextUrl?.origin || requestUrl.origin;

  return getOriginFromHeaders(request.headers, fallbackOrigin);
}
