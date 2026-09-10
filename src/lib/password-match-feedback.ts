import type { Locale } from "@/lib/i18n";

export type PasswordMatchFeedback = {
  message: string;
  state: "match" | "mismatch" | "none";
};

export function getPasswordMatchFeedback(
  password: string,
  confirmPassword: string,
  locale: Locale,
): PasswordMatchFeedback {
  if (!confirmPassword) {
    return { message: "", state: "none" };
  }

  const matches = password === confirmPassword;
  return {
    message:
      locale === "it"
        ? matches
          ? "Le password coincidono"
          : "Le password non coincidono"
        : matches
          ? "Passwords match"
          : "Passwords don't match",
    state: matches ? "match" : "mismatch",
  };
}
