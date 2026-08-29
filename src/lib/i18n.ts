export type Locale = "it" | "en";

export const defaultLocale: Locale = "it";
export const localeCookieName = "salento_locale";

export function isLocale(value: string): value is Locale {
  return value === "it" || value === "en";
}

export function getLocaleTag(locale: Locale) {
  return locale === "it" ? "it-IT" : "en-US";
}

export const localeLabels: Record<Locale, string> = {
  it: "Italiano",
  en: "English",
};
