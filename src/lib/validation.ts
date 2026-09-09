import { parsePhoneNumberFromString } from "libphonenumber-js/core";
import rawPhoneNumberMetadata from "libphonenumber-js/metadata.min.json";
import { z } from "zod";

import { buildSelectedAddressFromStoredFields } from "@/lib/address-selection";
import { normalizeUrlInput } from "@/lib/business-links";
import { LISTING_SIGNER_ROLE_VALUES } from "@/lib/listing-offer";
import { isStrongPassword, PASSWORD_MIN_LENGTH } from "@/lib/password-rules";

export const usernamePattern = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/;
export const paymentMethodValues = [
  "ONLINE",
  "CASH",
  "BANK_TRANSFER",
  "OTHER",
] as const;
export const verificationChannelValues = ["EMAIL", "SMS", "WHATSAPP"] as const;
export const partnerHeardAboutValues = [
  "friend-family",
  "social-media",
  "online-search",
  "business-owner",
  "local-event",
  "other",
] as const;

// Normalize the JSON module for both Next.js and the Node test loader.
const phoneNumberMetadataModule = rawPhoneNumberMetadata as typeof rawPhoneNumberMetadata & {
  default?: typeof rawPhoneNumberMetadata;
};
const phoneNumberMetadata =
  phoneNumberMetadataModule.default ?? rawPhoneNumberMetadata;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Canonical E.164 representation for account identifiers. Publishing already
 * validates owner contacts with the same libphonenumber metadata; keeping the
 * normalized value here prevents formatting variations from becoming separate
 * accounts. The configured default is only used for legacy/local numbers,
 * matching the rest of the application phone handling.
 */
export function normalizePhoneNumber(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;

  const defaultCountry = (process.env.DEFAULT_PHONE_COUNTRY || "IT").trim().toUpperCase();
  const parsed = parsePhoneNumberFromString(
    trimmed,
    defaultCountry.length === 2 ? defaultCountry as Parameters<typeof parsePhoneNumberFromString>[1] : "IT",
    phoneNumberMetadata,
  );

  return parsed?.isValid() ? parsed.number : null;
}

export function getStringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

export function emptyToUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export type BirthdayValidationError = "invalid_birth_date" | "underage";

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Validates the date as entered instead of relying on JavaScript's date
 * normalization, which would turn values such as 2025-02-29 into March 1.
 */
export function validateBirthday(
  value: string,
  now: Date = new Date(),
): BirthdayValidationError | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return "invalid_birth_date";
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > getDaysInMonth(year, month)
  ) {
    return "invalid_birth_date";
  }

  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();

  if (
    year > currentYear ||
    (year === currentYear &&
      (month > currentMonth || (month === currentMonth && day > currentDay)))
  ) {
    return "invalid_birth_date";
  }

  const age = currentYear - year;
  const hasReachedBirthdayThisYear =
    month < currentMonth || (month === currentMonth && day <= currentDay);

  return age > 18 || (age === 18 && hasReachedBirthdayThisYear)
    ? null
    : "underage";
}

export function parsePhotoUrls(value: string) {
  const urls = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return urls.length ? urls : undefined;
}

export function parseSubmissionOfferItems(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^(notes collected on site|punti raccolti sul posto):$/i.test(line));
}

const optionalUrlSchema = z
  .string()
  .transform((value) => normalizeUrlInput(value) ?? emptyToUndefined(value))
  .refine((value) => !value || z.string().url().safeParse(value).success, {
    message: "invalid_url",
  })
  .optional();

const optionalSubmissionUrlSchema = z
  .string()
  .transform((value) => normalizeUrlInput(value) ?? undefined)
  .optional();

const optionalEmailSchema = z
  .string()
  .transform((value) => emptyToUndefined(normalizeEmail(value)))
  .refine((value) => !value || z.string().email().safeParse(value).success, {
    message: "invalid_email",
  })
  .optional();

const optionalSubmissionEmailSchema = z
  .string()
  .transform((value) => {
    const normalized = emptyToUndefined(normalizeEmail(value));

    if (!normalized) {
      return undefined;
    }

    return z.string().email().safeParse(normalized).success ? normalized : undefined;
  })
  .optional();

const optionalHandleSchema = z
  .string()
  .transform((value) => emptyToUndefined(value.trim()))
  .refine((value) => !value || value.length <= 120, {
    message: "invalid_handle",
  })
  .optional();

const optionalPhoneSchema = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !value || value.length >= 5, {
    message: "invalid_phone",
  });

function isPossiblePhoneNumber(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  const parsed = parsePhoneNumberFromString(trimmed, "IT", phoneNumberMetadata);
  return Boolean(parsed?.isPossible());
}

const requiredPhoneSubmissionSchema = z
  .string()
  .trim()
  .min(5)
  .max(40)
  .refine((value) => isPossiblePhoneNumber(value), {
    message: "invalid_phone",
  });

const optionalPhoneSubmissionSchema = optionalPhoneSchema.refine(
  (value) => !value || isPossiblePhoneNumber(value),
  {
    message: "invalid_phone",
  },
);

const hoursDraftSchema = z.string().trim().max(4000);
const optionalStructuredAddressTextSchema = z
  .string()
  .transform((value) => emptyToUndefined(value))
  .optional();
const optionalCoordinateSchema = z.preprocess((value) => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return undefined;
    }

    const numericValue = Number(trimmed);
    return Number.isFinite(numericValue) ? numericValue : Number.NaN;
  }

  return value;
}, z.number().finite().optional());
const photoUrlsDraftSchema = z
  .string()
  .optional()
  .transform((value) => parsePhotoUrls(value ?? ""));

const baseBusinessSubmissionShape = {
  address: z.string().trim().max(160),
  addressCountry: optionalStructuredAddressTextSchema,
  addressCountryCode: optionalStructuredAddressTextSchema,
  addressLatitude: optionalCoordinateSchema,
  addressLocality: optionalStructuredAddressTextSchema,
  addressLongitude: optionalCoordinateSchema,
  addressPlaceId: optionalStructuredAddressTextSchema,
  addressPostalCode: optionalStructuredAddressTextSchema,
  addressProvince: optionalStructuredAddressTextSchema,
  addressRegion: optionalStructuredAddressTextSchema,
  addressRoute: optionalStructuredAddressTextSchema,
  addressStreetNumber: optionalStructuredAddressTextSchema,
  agreementSignature: z.string().trim().max(50000).optional(),
  businessName: z.string().trim().max(120),
  categoryId: z.string().trim(),
  email: optionalSubmissionEmailSchema,
  facebook: optionalHandleSchema,
  googleMapsUrl: optionalSubmissionUrlSchema,
  instagram: optionalHandleSchema,
  longDescription: z.string().trim().max(4000),
  openingHours: hoursDraftSchema,
  ownerEmail: optionalSubmissionEmailSchema,
  ownerHasNoEmail: z.boolean(),
  ownerName: z.string().trim().max(120),
  ownerPhone: z.string().trim().max(40),
  signerFullName: z.string().trim().max(120).optional(),
  signerRole: z.enum(LISTING_SIGNER_ROLE_VALUES).optional(),
  signerRoleOther: z.string().trim().max(120).optional(),
  paymentMethod: z.enum(paymentMethodValues).optional(),
  phone: z.string().trim().max(40),
  photoUrls: photoUrlsDraftSchema,
  shortDescription: z.string().trim().max(220),
  townId: z.string().trim(),
  website: optionalSubmissionUrlSchema,
  whatsapp: z.string().trim().max(40),
} satisfies Record<string, z.ZodType>;

export const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

export const signupSchema = z.object({
  email: z.string().trim().email(),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH)
    .max(128)
    .refine((value) => isStrongPassword(value), {
      message: "invalid_password_strength",
    }),
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .transform((value) => value.toLowerCase())
    .refine((value) => usernamePattern.test(value)),
});

export const completeProfileSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .transform((value) => value.toLowerCase())
    .refine((value) => usernamePattern.test(value)),
});

export const businessSubmissionDraftSchema = z.object({
  ...baseBusinessSubmissionShape,
  categoryId: z.string().trim().min(1),
  townId: z.string().trim().min(1),
});

type StructuredAddressValidationInput = {
  address: string;
  addressCountry?: string | null | undefined;
  addressCountryCode?: string | null | undefined;
  addressLatitude?: number | string | null | undefined;
  addressLocality?: string | null | undefined;
  addressLongitude?: number | string | null | undefined;
  addressPlaceId?: string | null | undefined;
  addressPostalCode?: string | null | undefined;
  addressProvince?: string | null | undefined;
  addressRegion?: string | null | undefined;
  addressRoute?: string | null | undefined;
  addressStreetNumber?: string | null | undefined;
};

function withStructuredAddressValidation<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
) {
  return schema.superRefine((value, ctx) => {
    const structuredValue = value as StructuredAddressValidationInput;
    const selectedAddress = buildSelectedAddressFromStoredFields({
      address: structuredValue.address,
      addressCountry: structuredValue.addressCountry,
      addressCountryCode: structuredValue.addressCountryCode,
      addressLatitude: structuredValue.addressLatitude,
      addressLocality: structuredValue.addressLocality,
      addressLongitude: structuredValue.addressLongitude,
      addressPlaceId: structuredValue.addressPlaceId,
      addressPostalCode: structuredValue.addressPostalCode,
      addressProvince: structuredValue.addressProvince,
      addressRegion: structuredValue.addressRegion,
      addressRoute: structuredValue.addressRoute,
      addressStreetNumber: structuredValue.addressStreetNumber,
    });

    if (!selectedAddress) {
      ctx.addIssue({
        code: "custom",
        message: "invalid_address_selection",
        path: ["address"],
      });
      return;
    }

    if (structuredValue.address.trim() !== selectedAddress.formattedAddress.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "invalid_address_selection",
        path: ["address"],
      });
    }
  });
}

const businessSubmissionSubmitSchemaBase = z.object({
  ...baseBusinessSubmissionShape,
  address: z.string().trim().min(4).max(160),
  agreementSignature: z.string().trim().min(2).max(50000),
  businessName: z.string().trim().min(2).max(120),
  categoryId: z.string().trim().min(1),
  longDescription: z
    .string()
    .trim()
    .max(4000)
    .refine((value) => parseSubmissionOfferItems(value).length >= 2, {
      message: "missing_offer_items",
    }),
  openingHours: z.string().trim().min(10).max(4000),
  ownerName: z.string().trim().min(2).max(120),
  ownerPhone: requiredPhoneSubmissionSchema,
  signerFullName: z.string().trim().min(2).max(120),
  signerRole: z.enum(LISTING_SIGNER_ROLE_VALUES),
  signerRoleOther: z.string().trim().max(120).optional(),
  paymentMethod: z.enum(paymentMethodValues),
  phone: requiredPhoneSubmissionSchema,
  photoUrls: z
    .string()
    .transform((value) => parsePhotoUrls(value))
    .refine((value) => Boolean(value && value.length >= 2), {
      message: "missing_photos",
    }),
  shortDescription: z.string().trim().max(220),
  townId: z.string().trim().min(1),
  whatsapp: optionalPhoneSubmissionSchema,
}).superRefine((value, ctx) => {
  if (
    value.signerRole === "OTHER_AUTHORIZED_REPRESENTATIVE" &&
    !value.signerRoleOther?.trim()
  ) {
    ctx.addIssue({
      code: "custom",
      message: "missing_signer_role_other",
      path: ["signerRoleOther"],
    });
  }
});

const adminBusinessSubmissionSubmitSchemaBase = z.object({
  ...baseBusinessSubmissionShape,
  address: z.string().trim().min(4).max(160),
  agreementSignature: z.string().trim().min(2).max(50000),
  businessName: z.string().trim().min(2).max(120),
  categoryId: z.string().trim().min(1),
  longDescription: z
    .string()
    .trim()
    .max(4000)
    .refine((value) => parseSubmissionOfferItems(value).length >= 2, {
      message: "missing_offer_items",
    }),
  openingHours: z.string().trim().min(10).max(4000),
  ownerName: z.string().trim().min(2).max(120),
  ownerPhone: requiredPhoneSubmissionSchema,
  signerFullName: z.string().trim().min(2).max(120),
  signerRole: z.enum(LISTING_SIGNER_ROLE_VALUES),
  signerRoleOther: z.string().trim().max(120).optional(),
  phone: requiredPhoneSubmissionSchema,
  photoUrls: z
    .string()
    .transform((value) => parsePhotoUrls(value))
    .refine((value) => Boolean(value && value.length >= 2), {
      message: "missing_photos",
    }),
  shortDescription: z.string().trim().max(220),
  townId: z.string().trim().min(1),
  whatsapp: optionalPhoneSubmissionSchema,
}).superRefine((value, ctx) => {
  if (
    value.signerRole === "OTHER_AUTHORIZED_REPRESENTATIVE" &&
    !value.signerRoleOther?.trim()
  ) {
    ctx.addIssue({
      code: "custom",
      message: "missing_signer_role_other",
      path: ["signerRoleOther"],
    });
  }
});

export const businessSubmissionSubmitSchema =
  withStructuredAddressValidation(businessSubmissionSubmitSchemaBase);

export const adminBusinessSubmissionSubmitSchema =
  withStructuredAddressValidation(adminBusinessSubmissionSubmitSchemaBase);

export const localPartnerOnboardingSchema = z.object({
  baseTownOrArea: z.string().trim().min(2).max(120),
  birthDate: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const validationError = validateBirthday(value);

      if (validationError) {
        ctx.addIssue({
          code: "custom",
          message: validationError,
        });
      }
    }),
  heardAbout: z.enum(partnerHeardAboutValues),
  heardAboutOther: z.string().trim().max(300).optional(),
  phone: z
    .string()
    .trim()
    .min(5)
    .max(40)
    .refine((value) => isPossiblePhoneNumber(value), {
      message: "invalid_phone",
    }),
  whatsapp: optionalPhoneSchema.optional(),
});

export const businessClaimRequestSchema = z.object({
  businessId: z.string().trim().min(1),
  claimantName: z.string().trim().min(2).max(120),
  claimantPosition: z.string().trim().min(2).max(80),
  verificationChannel: z.enum(verificationChannelValues),
});

export const ownedBusinessProfileSchema = z.object({
  address: z.string().trim().min(4).max(160),
  businessId: z.string().trim().min(1),
  businessName: z.string().trim().min(2).max(120),
  description: z.string().trim().min(18).max(4000),
  email: optionalEmailSchema,
  openingHoursText: z.string().trim().max(1000).optional(),
  ownerEmail: optionalEmailSchema,
  ownerName: z.string().trim().min(2).max(120),
  ownerPhone: z.string().trim().min(5).max(40),
  phone: z.string().trim().max(40).optional(),
  shortDescription: z.string().trim().min(12).max(220),
  website: optionalUrlSchema,
});

export const verificationCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});
