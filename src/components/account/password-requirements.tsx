"use client";

import { IconCheck, IconX } from "@tabler/icons-react";

import type { Locale } from "@/lib/i18n";
import {
  getPasswordRequirementStates,
  PASSWORD_MIN_LENGTH,
  type PasswordRequirementKey,
} from "@/lib/password-rules";

const requirementOrder: PasswordRequirementKey[] = [
  "length",
  "uppercase",
  "number",
  "special",
];

type PasswordRequirementsProps = {
  locale: Locale;
  password: string;
};

export function PasswordRequirements({
  locale,
  password,
}: PasswordRequirementsProps) {
  const requirements = getPasswordRequirementStates(password);
  const copy =
    locale === "it"
      ? {
          length: `Almeno ${PASSWORD_MIN_LENGTH} caratteri`,
          number: "Almeno 1 numero",
          special: "Almeno 1 carattere speciale",
          title: "La password deve includere:",
          uppercase: "Almeno 1 lettera maiuscola",
        }
      : {
          length: `At least ${PASSWORD_MIN_LENGTH} characters`,
          number: "At least 1 number",
          special: "At least 1 special character",
          title: "Your password must include:",
          uppercase: "At least 1 uppercase letter",
        };

  return (
    <div
      aria-live="polite"
      className="rounded-[1.2rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.68)] px-4 py-4"
    >
      <p className="text-sm font-medium text-[var(--foreground)]">{copy.title}</p>
      <ul className="mt-3 grid gap-2">
        {requirementOrder.map((key) => {
          const met = requirements[key];

          return (
            <li
              key={key}
              className={`flex items-center gap-2 text-sm ${met ? "text-[var(--color-olive)]" : "text-[var(--accent)]"}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full ${met ? "bg-[rgba(111,143,78,0.14)]" : "bg-[rgba(191,91,42,0.14)]"}`}
              >
                {met ? <IconCheck size={12} /> : <IconX size={12} />}
              </span>
              <span>{copy[key]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
