import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { PartnerPayoutMethod, PartnerPayoutSetupStatus } from "@prisma/client";
import { assertRealPartnerDisbursementsAllowed } from "@/lib/stripe";

const payoutMethods = ["STRIPE", "PAYPAL", "POSTEPAY", "HYPE"] as const;

export type PayoutMethod = (typeof payoutMethods)[number];

export function isPayoutMethod(value: string): value is PayoutMethod {
  return payoutMethods.includes(value as PayoutMethod);
}

export function normalizeIban(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function isValidItalianIban(value: string) {
  const iban = normalizeIban(value);
  if (!/^IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}$/.test(iban)) return false;

  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const digits = /[A-Z]/.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function getEncryptionKey() {
  const value = process.env.PAYOUT_DATA_ENCRYPTION_KEY?.trim();
  if (!value) return null;
  return createHash("sha256").update(value).digest();
}

/** Encrypt payout destination data at rest. Never use this for credentials or PINs. */
export function encryptPayoutDestination(value: string) {
  const key = getEncryptionKey();
  if (!key) throw new Error("missing_payout_data_encryption_key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptPayoutDestination(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  const key = getEncryptionKey();
  if (!key || version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("unreadable_payout_destination");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function getPayoutMethodSetupStatus(params: {
  method: PartnerPayoutMethod;
  paypalPayoutEmail?: string | null;
  bankPayoutIbanEncrypted?: string | null;
  stripePayoutsEnabled?: boolean;
}): PartnerPayoutSetupStatus {
  if (params.method === "STRIPE") {
    return params.stripePayoutsEnabled ? "READY" : "INCOMPLETE";
  }
  if (params.method === "PAYPAL") {
    return params.paypalPayoutEmail ? "READY" : "INCOMPLETE";
  }
  return params.bankPayoutIbanEncrypted ? "READY" : "INCOMPLETE";
}

export function isPaypalPayoutConfigured() {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID?.trim() &&
      process.env.PAYPAL_CLIENT_SECRET?.trim() &&
      process.env.PAYPAL_PAYOUTS_ENABLED === "true",
  );
}

export function getPaypalApiBaseUrl() {
  return process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPaypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("paypal_not_configured");
  const response = await fetch(`${getPaypalApiBaseUrl()}/v1/oauth2/token`, {
    body: "grant_type=client_credentials",
    cache: "no-store",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  if (!response.ok) throw new Error(`paypal_auth_failed:${response.status}`);
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("paypal_auth_failed");
  return data.access_token;
}

export async function createPaypalPayout(params: {
  amountCents: number;
  payoutId: string;
  recipientEmail: string;
}) {
  assertRealPartnerDisbursementsAllowed();
  const token = await getPaypalAccessToken();
  const senderBatchId = `salento-${params.payoutId}`.slice(0, 36);
  const response = await fetch(`${getPaypalApiBaseUrl()}/v1/payments/payouts`, {
    body: JSON.stringify({
      sender_batch_header: {
        email_message: "Salento Local Partner earnings.",
        email_subject: "Your Salento Local payout",
        recipient_type: "EMAIL",
        sender_batch_id: senderBatchId,
      },
      items: [
        {
          amount: { currency: "EUR", value: (params.amountCents / 100).toFixed(2) },
          note: "Salento Local Partner commission",
          recipient_wallet: "PAYPAL",
          receiver: params.recipientEmail,
          sender_item_id: params.payoutId,
        },
      ],
    }),
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => ({}))) as {
    batch_header?: { payout_batch_id?: string; batch_status?: string };
    message?: string;
    name?: string;
  };
  if (!response.ok || !body.batch_header?.payout_batch_id) {
    throw new Error(`paypal_payout_failed:${body.name ?? response.status}`);
  }
  return {
    batchId: body.batch_header.payout_batch_id,
    providerReference: senderBatchId,
    status: body.batch_header.batch_status ?? "PENDING",
  };
}

export async function getPaypalPayoutBatch(batchId: string) {
  const token = await getPaypalAccessToken();
  const response = await fetch(`${getPaypalApiBaseUrl()}/v1/payments/payouts/${encodeURIComponent(batchId)}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`paypal_payout_lookup_failed:${response.status}`);
  const body = (await response.json()) as {
    batch_header?: { batch_status?: string };
    items?: Array<{ payout_item_id?: string; transaction_status?: string }>;
  };
  return {
    batchStatus: body.batch_header?.batch_status ?? "PENDING",
    itemId: body.items?.[0]?.payout_item_id ?? null,
    itemStatus: body.items?.[0]?.transaction_status ?? "PENDING",
  };
}
