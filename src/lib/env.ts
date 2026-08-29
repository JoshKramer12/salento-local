export function normalizeEnvValue(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return "";
  }

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const hasMatchingQuotes =
    trimmed.length >= 2 && ((first === '"' && last === '"') || (first === "'" && last === "'"));

  return hasMatchingQuotes ? trimmed.slice(1, -1).trim() : trimmed;
}
