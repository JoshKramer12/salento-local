import {
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";

import type { Locale } from "@/lib/i18n";

export type PhoneCountryOption = {
  code: CountryCode;
  dialCode: string;
  flag: string;
  label: string;
  name: string;
};

const supportedPhoneCountries = getCountries() as CountryCode[];
const dialCodeByCountry = new Map(
  supportedPhoneCountries.map((country) => [country, `+${getCountryCallingCode(country)}`]),
);

function getFlagEmoji(countryCode: string) {
  return countryCode
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

export function buildPhoneCountryOptions(locale: Locale): PhoneCountryOption[] {
  const displayNames =
    typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([locale === "it" ? "it" : "en"], {
          type: "region",
        })
      : null;

  return supportedPhoneCountries
    .map((country) => {
      const name = displayNames?.of(country) ?? country;
      const dialCode = dialCodeByCountry.get(country) ?? "";
      const flag = getFlagEmoji(country);

      return {
        code: country,
        dialCode,
        flag,
        label: `${flag} ${name} (${dialCode})`,
        name,
      } satisfies PhoneCountryOption;
    })
    .sort((left, right) => {
      if (left.code === "IT") {
        return -1;
      }

      if (right.code === "IT") {
        return 1;
      }

      return left.name.localeCompare(right.name, locale);
    });
}
