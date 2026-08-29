import crypto from "node:crypto";

export function createVerificationCode() {
  return `${crypto.randomInt(0, 1_000_000)}`.padStart(6, "0");
}

export function hashVerificationCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function isVerificationCodeValid(code: string, hash: string) {
  return hashVerificationCode(code) === hash;
}

export function buildVerificationExpiry(minutes = 15) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function buildVerificationResendAt(minutes = 2) {
  return new Date(Date.now() + minutes * 60 * 1000);
}
