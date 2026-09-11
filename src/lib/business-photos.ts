export function getStoredPhotoUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<string[]>((urls, url) => {
    if (typeof url === "string" && url.trim()) {
      urls.push(url.trim());
    }

    return urls;
  }, []);
}

export function mergeBusinessPhotoUrls(...sources: ReadonlyArray<ReadonlyArray<string>>): string[] {
  const seen = new Set<string>();

  return sources.flatMap((source) =>
    source.reduce<string[]>((urls, url) => {
      const normalized = url.trim();

      if (!normalized || seen.has(normalized)) {
        return urls;
      }

      seen.add(normalized);
      urls.push(normalized);
      return urls;
    }, []),
  );
}
