export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeName(value: string) {
  return normalizeWhitespace(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " "),
  );
}

export function normalizeAddress(value?: string | null) {
  if (!value) {
    return "";
  }

  return normalizeName(
    value
      .replace(/\bvia\b/gi, "via")
      .replace(/\bpiazza\b/gi, "piazza")
      .replace(/\bcorso\b/gi, "corso"),
  );
}

export function normalizePhone(value?: string | null) {
  if (!value) {
    return "";
  }

  const digits = value.replace(/[^\d+]/g, "");
  if (!digits) {
    return "";
  }

  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }

  return digits;
}

export function normalizeWebsite(value?: string | null) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    const pathname = url.pathname.replace(/\/+$/g, "");
    const host = url.hostname.replace(/^www\./, "");

    return `${host}${pathname}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

export function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

export function haversineKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

export function tokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeName(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeName(right).split(" ").filter(Boolean));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}

export function isTruthyString(value?: string | null) {
  return Boolean(value?.trim());
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
