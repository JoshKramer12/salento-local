import type { Locale } from "@/lib/i18n";
import type { BirthdayValidationError } from "@/lib/validation";

const birthdayValidationMessages: Record<
  Locale,
  Record<BirthdayValidationError, string>
> = {
  en: {
    invalid_birth_date: "Please enter a valid birthday.",
    underage: "You must be at least 18 years old to create an account.",
  },
  it: {
    invalid_birth_date: "Inserisci una data di nascita valida.",
    underage: "Devi avere almeno 18 anni per creare un account.",
  },
};

export function getBirthdayValidationMessage(
  locale: Locale,
  validationError: BirthdayValidationError,
) {
  return birthdayValidationMessages[locale][validationError];
}
