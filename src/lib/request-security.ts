import { getRequestOrigin } from "@/lib/request-origin";

/**
 * Browsers include Origin for cross-site fetches and form posts. Requests
 * without it are retained for trusted non-browser clients (for example a
 * local health-check), while an explicitly foreign Origin is always denied.
 */
export function hasSameOriginOrNoOrigin(request: Request) {
  const origin = request.headers.get("origin")?.trim();

  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === getRequestOrigin(request);
  } catch {
    return false;
  }
}

/** Cookie-authenticated financial mutations require an explicit browser Origin. */
export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return false;
  try {
    return new URL(origin).origin === getRequestOrigin(request);
  } catch {
    return false;
  }
}
