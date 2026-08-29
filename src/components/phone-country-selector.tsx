"use client";

import { IconChevronDown } from "@tabler/icons-react";
import type { CountryCode } from "libphonenumber-js";

import type { PhoneCountryOption } from "@/lib/phone-country-options";

type PhoneCountrySelectorProps = {
  "aria-label": string;
  "aria-invalid"?: boolean;
  onChange: (country: CountryCode) => void;
  options: PhoneCountryOption[];
  value: CountryCode;
};

export function PhoneCountrySelector({
  "aria-invalid": ariaInvalid = false,
  "aria-label": ariaLabel,
  onChange,
  options,
  value,
}: PhoneCountrySelectorProps) {
  const selected = options.find((option) => option.code === value) ?? options[0];

  return (
    <div className="relative min-w-0">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as CountryCode)}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.flag} {option.name} · {option.code} {option.dialCode}
          </option>
        ))}
      </select>
      <div
        aria-hidden="true"
        className={`input-field flex min-h-[3.2rem] items-center gap-1.5 !py-2 !pl-3 !pr-2 text-sm font-semibold tabular-nums transition peer-focus-visible:border-[rgba(30,111,140,0.45)] peer-focus-visible:shadow-[0_0_0_4px_rgba(30,111,140,0.08)] ${
          ariaInvalid ? "border-[var(--error)]" : ""
        }`}
      >
        <span className="text-base leading-none">{selected?.flag ?? ""}</span>
        <span>{selected?.code ?? value}</span>
        <span className="text-[var(--muted)]">{selected?.dialCode ?? ""}</span>
        <IconChevronDown size={16} className="ml-auto shrink-0 text-[var(--muted)]" />
      </div>
    </div>
  );
}
