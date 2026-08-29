export const PASSWORD_MIN_LENGTH = 8;

export const passwordRequirementKeys = [
  "length",
  "uppercase",
  "number",
  "special",
] as const;

export type PasswordRequirementKey = (typeof passwordRequirementKeys)[number];

export function getPasswordRequirementStates(password: string) {
  return {
    length: password.length >= PASSWORD_MIN_LENGTH,
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    uppercase: /[A-Z]/.test(password),
  } satisfies Record<PasswordRequirementKey, boolean>;
}

export function isStrongPassword(password: string) {
  const requirements = getPasswordRequirementStates(password);
  return passwordRequirementKeys.every((key) => requirements[key]);
}
