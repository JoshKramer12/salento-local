type SocialNetwork = "facebook" | "instagram";

const socialHosts: Record<SocialNetwork, readonly string[]> = {
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com", "www.fb.com"],
  instagram: ["instagram.com", "www.instagram.com"],
};

function ensureProtocol(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function parseUrl(value: string) {
  try {
    const parsed = new URL(ensureProtocol(value.trim()));

    if (!/^https?:$/i.test(parsed.protocol)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function normalizeHandle(value: string) {
  return value.trim().replace(/^@+/, "").replace(/^\/+|\/+$/g, "");
}

function looksLikeExplicitSocialUrl(value: string, network: SocialNetwork) {
  const normalized = value.trim().toLowerCase();

  return (
    /^https?:\/\//.test(normalized) ||
    normalized.includes("/") ||
    socialHosts[network].some((host) => normalized.includes(host))
  );
}

function looksLikeExplicitUrl(value: string) {
  const normalized = value.trim().toLowerCase();

  return /^https?:\/\//.test(normalized) || normalized.includes("/");
}

function extractSocialPath(parsed: URL, network: SocialNetwork) {
  const hostname = parsed.hostname.toLowerCase();

  if (!socialHosts[network].includes(hostname)) {
    return null;
  }

  const firstSegment = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)[0];

  return firstSegment ? normalizeHandle(firstSegment) : null;
}

export function normalizeUrlInput(value?: string | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = parseUrl(trimmed);

  if (!parsed || !parsed.hostname.includes(".")) {
    return undefined;
  }

  return parsed.toString();
}

export function normalizeSubmissionSocialValue(value?: string | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = looksLikeExplicitUrl(trimmed) ? parseUrl(trimmed) : null;

  if (parsed) {
    return parsed.toString();
  }

  return normalizeHandle(trimmed);
}

/**
 * Keeps the publish-form value compatible with older handles and URLs while
 * reserving the visible @ character for the input adornment.
 */
export function normalizeSubmissionSocialInput(value?: string | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return "";
  }

  return looksLikeExplicitUrl(trimmed) ? trimmed : normalizeHandle(trimmed);
}

function normalizeSocialUrl(value: string | null | undefined, network: SocialNetwork) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = looksLikeExplicitSocialUrl(trimmed, network) ? parseUrl(trimmed) : null;

  if (parsed) {
    const socialPath = extractSocialPath(parsed, network);

    if (socialPath) {
      return `https://www.${network}.com/${socialPath}`;
    }

    return parsed.toString();
  }

  const handle = normalizeHandle(trimmed);

  if (!handle) {
    return undefined;
  }

  return `https://www.${network}.com/${handle}`;
}

export function normalizeInstagramUrl(value?: string | null) {
  return normalizeSocialUrl(value, "instagram");
}

export function normalizeFacebookUrl(value?: string | null) {
  return normalizeSocialUrl(value, "facebook");
}

export function getWebsiteDisplayLabel(value?: string | null) {
  const normalized = normalizeUrlInput(value);

  if (!normalized) {
    return value?.trim() || null;
  }

  const parsed = new URL(normalized);
  const label = `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`.replace(/\/$/, "");

  return label || parsed.hostname;
}

export function getSocialDisplayLabel(
  value: string | null | undefined,
  network: SocialNetwork,
) {
  const normalized =
    network === "instagram" ? normalizeInstagramUrl(value) : normalizeFacebookUrl(value);

  if (!normalized) {
    return null;
  }

  const parsed = new URL(normalized);
  const handle = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)[0];

  return handle ? `@${handle}` : parsed.hostname;
}
