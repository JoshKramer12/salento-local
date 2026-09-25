"use server";

import bcrypt from "bcryptjs";
import {
  Prisma,
  type PaymentStatus,
  type SubmissionStatus,
  type VerificationChannel,
} from "@prisma/client";
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { buildPaymentStatusForMethod, isDraftLikeSubmission } from "@/lib/account";
import {
  CLAIM_VERIFICATION_EXPIRY_MINUTES,
  CLAIM_VERIFICATION_MAX_ATTEMPTS,
  CLAIM_VERIFICATION_MAX_RESENDS,
  CLAIM_VERIFICATION_RESEND_COOLDOWN_MINUTES,
  evaluateClaimCodeAttempt,
  evaluateClaimResend,
} from "@/lib/business-claim-verification";
import {
  canUsePrimaryAdminUsername,
  isPrimaryAdminUsername,
  normalizeAdminUsername,
} from "@/lib/admin";
import {
  buildAddressSelectionStorage,
  buildGoogleMapsSearchUrl,
  buildSelectedAddressFromStoredFields,
  buildStreetAddressLine,
  normalizeAddressSelectionValue,
} from "@/lib/address-selection";
import { signIn } from "@/lib/auth";
import { canManageBusiness, findUserByNormalizedEmail } from "@/lib/business-owner-access";
import {
  getBusinessClaimVerificationEmail,
  isBusinessAlreadyManaged,
  shouldShowClaimEmailChoice,
} from "@/lib/business-claim";
import {
  requireAdminViewer,
  requireCompletedViewer,
  requireViewer,
} from "@/lib/auth-guards";
import {
  normalizeFacebookUrl,
  normalizeInstagramUrl,
  normalizeSubmissionSocialValue,
} from "@/lib/business-links";
import { mergeBusinessPhotoUrls } from "@/lib/business-photos";
import {
  getBusinessNameCandidateSearchTerms,
  getBusinessNameMatchStrength,
  isBusinessNameDuplicateSignal,
  normalizeDuplicateBusinessName,
  normalizeDuplicatePhone,
  normalizedAddressValuesMatch,
} from "@/lib/duplicate-business-matching";
import { sendVerificationCode } from "@/lib/claim-delivery";
import type { Locale } from "@/lib/i18n";
import {
  hasAcceptedCurrentLegalDocuments,
  recordCurrentLegalAcceptances,
} from "@/lib/legal-consent";
import {
  ensurePendingPartnerCommissionForSubmission,
  runWeeklyPartnerPayouts,
} from "@/lib/partner-ledger";
import {
  encryptPayoutDestination,
  isPayoutMethod,
  isValidItalianIban,
  normalizeIban,
} from "@/lib/partner-payout-methods";
import { LISTING_OFFER, resolveContractualEmail } from "@/lib/listing-offer";
import { ensureManualElementPaymentIntent, getNoEmailPaymentPhoneError } from "@/lib/no-email-payment";
import { ensureEmbeddedSubscription } from "@/lib/embedded-subscription";
import {
  DEFAULT_COMMISSION_CENTS,
  DEFAULT_LISTING_PRICE_CENTS,
  DEFAULT_PLATFORM_SHARE_CENTS,
  canPublishSubmission,
  getPartnerUserIdForSubmission,
  getBankTransferReference,
  getStatusAfterPayment,
  getStatusAfterSubmit,
} from "@/lib/payment";
import {
  ensurePaymentQrActionResult,
  getPaymentQrOpeningError,
  preparePaymentQrNavigation,
  toPaymentQrSelectionResult,
  type PaymentQrSelectionResult,
} from "@/lib/payment-qr-navigation";
import { prisma } from "@/lib/prisma";
import { getSafeInternalRedirect } from "@/lib/redirects";
import {
  consumeSecurityRateLimit,
} from "@/lib/security-rate-limit";
import {
  ensureStripeBankTransferIntent,
} from "@/lib/stripe-checkout";
import { getPaymentElementPublishableKey } from "@/lib/stripe";
import { publishSubmissionAfterPayment } from "@/lib/submission-publication";
import { ensureInitialBusinessMembership } from "@/lib/business-membership";
import {
  buildVerificationExpiry,
  buildVerificationResendAt,
  createVerificationCode,
  hashVerificationCode,
  isVerificationCodeValid,
} from "@/lib/verification";
import {
  type BirthdayValidationError,
  adminBusinessSubmissionSubmitSchema,
  businessClaimRequestSchema,
  businessSubmissionDraftSchema,
  businessSubmissionSubmitSchema,
  completeProfileSchema,
  getStringValue,
  loginSchema,
  localPartnerOnboardingSchema,
  normalizeEmail,
  normalizeUsername,
  ownedBusinessProfileSchema,
  signupSchema,
  verificationCodeSchema,
} from "@/lib/validation";
import {
  getBirthdayValidationMessage,
} from "@/lib/signup-validation-messages";

export type SubmissionFormValues = {
  address: string;
  addressCountry: string;
  addressCountryCode: string;
  addressLatitude: string;
  addressLocality: string;
  addressLongitude: string;
  addressPlaceId: string;
  addressPostalCode: string;
  addressProvince: string;
  addressRegion: string;
  addressRoute: string;
  addressStreetNumber: string;
  agreementAccepted: boolean;
  agreementSignature: string;
  businessSummary: string;
  businessName: string;
  categoryId: string;
  email: string;
  facebook: string;
  googleMapsUrl: string;
  id?: string;
  instagram: string;
  longDescription: string;
  openingHours: string;
  ownerEmail: string;
  ownerHasNoEmail: boolean;
  ownerName: string;
  ownerPhone: string;
  signerFullName: string;
  signerRole: string;
  signerRoleOther: string;
  paymentMethod?: string;
  phone: string;
  photoUrls: string;
  shortDescription: string;
  townId: string;
  website: string;
  whatsapp: string;
};

export type DuplicateBusinessMatch = {
  address: string;
  categoryName: string;
  id: string;
  matchReasons: Array<"address" | "name" | "phone">;
  name: string;
  phone: string | null;
  slug: string;
  townName: string;
};

export type FormState = {
  duplicateCheckMessage?: string;
  duplicateMatches?: DuplicateBusinessMatch[];
  error?: string;
  fieldErrors?: Record<string, string>;
  invalidFields?: string[];
  notice?: string;
  paymentDestination?: string;
  signupValues?: {
    baseTownOrArea?: string;
    businessTermsAccepted: boolean;
    birthDate?: string;
    confirmPassword?: string;
    email: string;
    heardAbout?: string;
    heardAboutOther?: string;
    hometownTownId?: string;
    partnerPhone?: string;
    partnerTermsAccepted: boolean;
    password?: string;
    username: string;
    whatsapp?: string;
  };
  submission?: SubmissionFormValues;
};

export type PartnerPayoutActionState = {
  failedPartners?: number;
  message?: string;
  processedPartners?: number;
  sentAmountCents?: number;
  status: "error" | "failed" | "idle" | "partial" | "success";
};

const formCopy = {
  en: {
    duplicateEmail: "That email is already being used.",
    duplicateUsername: "That username is already taken.",
    invalidEmail: "Please enter a valid email address.",
    genericError: "Something went wrong. Please try again.",
    invalidCredentials: "Invalid email, username, or password.",
    invalidForm: "Please check the highlighted fields and try again.",
    missingBusinessTerms:
      "Please read and accept the Salento Local Business Terms & Conditions.",
    missingOfferItems: "Add at least 2 bullet points about what the business sells or offers.",
  invalidSession: "Please log in again to continue.",
    passwordMismatch: "The passwords do not match.",
    missingPartnerTerms: "Please read and accept the Salento Local Partner Terms & Conditions.",
    missingAgreement: "Please confirm that the owner approved the listing and price.",
    missingAddressSelection:
      "Choose the correct address from the dropdown before continuing.",
    missingOwnerEmail: "Add the owner email or confirm they do not have one.",
    missingContractualEmail: "Add the business email or owner email before continuing.",
    missingPaymentMethod: "Choose how the customer will pay for this listing.",
    missingSignerName: "Enter the full name of the person approving this listing.",
    missingSignerRole: "Choose the role of the person approving this listing.",
    missingSignerRoleOther: "Specify the signer role before continuing.",
    missingVerificationChannel:
      "Choose how you want to verify this business before continuing.",
    missingSignature: "Add the owner's signature before submitting.",
    missingPhotos: "Add at least one exterior photo and one interior photo.",
    notAllowed: "You can only edit your own submissions.",
    reservedAdminUsername: "That username is reserved.",
    unknownTown: "Please choose a valid town and category.",
    verificationCodeExpired: "That verification code expired. Request a new one.",
    verificationCodeInvalid: "That verification code is not valid.",
    verificationContactMissing:
      "This verification method is not available for the selected business.",
    verificationEmailRequired: "Add the email address where we should send the code.",
    verificationMethodUnavailable:
      "This verification method is not available right now. Choose another option.",
    verificationPhoneInvalid:
      "Enter a valid mobile number, including the country code if it is not Italian.",
    verificationPhoneRequired: "Add the mobile number where we should send the code.",
    verificationResendLimit:
      "You have requested too many codes. Please start a new claim if you still need help.",
    verificationResendRateLimited:
      "Too many attempts. Please wait before trying again.",
    verificationSendFailed:
      "We could not send the verification code just now. Please try again in a moment.",
    verificationSentByEmail: "We sent a 6-digit code to your email.",
    verificationSentBySms: "We sent a 6-digit code by SMS.",
    verificationTooManyAttempts:
      "Too many failed attempts. Request a new verification code.",
    usernameRule:
      "Use 3 to 30 lowercase letters, numbers, dots, dashes, or underscores.",
  },
  it: {
    duplicateEmail: "Questa email e gia in uso.",
    duplicateUsername: "Questo username e gia occupato.",
    invalidEmail: "Inserisci un indirizzo email valido.",
    genericError: "Qualcosa non ha funzionato. Riprova.",
    invalidCredentials: "Email, username o password non validi.",
    invalidForm: "Controlla i campi evidenziati e riprova.",
    missingBusinessTerms:
      "Leggi e accetta i Termini e Condizioni per le Attivita Commerciali di Salento Local.",
    missingOfferItems: "Aggiungi almeno 2 punti su cosa vende o offre l'attivita.",
    invalidSession: "Accedi di nuovo per continuare.",
    passwordMismatch: "Le password non coincidono.",
    missingPartnerTerms:
      "Leggi e accetta i Termini e Condizioni del Programma Partner di Salento Local.",
    missingAgreement:
      "Conferma che il proprietario ha approvato la scheda e il prezzo prima di inviare.",
    missingAddressSelection:
      "Scegli l'indirizzo corretto dal menu prima di continuare.",
    missingOwnerEmail:
      "Inserisci l'email del proprietario oppure conferma che non ne ha una.",
    missingContractualEmail:
      "Inserisci l'email dell'attivita oppure l'email del proprietario prima di continuare.",
    missingPaymentMethod: "Scegli come il cliente paghera questa scheda.",
    missingSignerName:
      "Inserisci il nome completo della persona che approva questa scheda.",
    missingSignerRole:
      "Scegli il ruolo della persona che approva questa scheda.",
    missingSignerRoleOther: "Specifica il ruolo del firmatario prima di continuare.",
    missingVerificationChannel:
      "Scegli come vuoi verificare questa attivita prima di continuare.",
    missingSignature: "Aggiungi la firma del proprietario prima di inviare.",
    missingPhotos: "Aggiungi almeno una foto esterna e una foto interna.",
    notAllowed: "Puoi modificare solo le tue segnalazioni.",
    reservedAdminUsername: "Questo username e riservato.",
    unknownTown: "Seleziona un comune e una categoria validi.",
    verificationCodeExpired: "Questo codice e scaduto. Richiedine uno nuovo.",
    verificationCodeInvalid: "Questo codice non e valido.",
    verificationContactMissing:
      "Questo metodo di verifica non e disponibile per l'attivita selezionata.",
    verificationEmailRequired: "Inserisci l'email a cui dobbiamo inviare il codice.",
    verificationMethodUnavailable:
      "Questo metodo di verifica non e disponibile in questo momento. Scegline un altro.",
    verificationPhoneInvalid:
      "Inserisci un numero di cellulare valido, con prefisso internazionale se non e italiano.",
    verificationPhoneRequired:
      "Inserisci il numero di cellulare a cui dobbiamo inviare il codice.",
    verificationResendLimit:
      "Hai richiesto troppi codici. Se ti serve ancora aiuto, avvia una nuova richiesta.",
    verificationResendRateLimited:
      "Troppi tentativi ravvicinati. Aspetta un momento prima di riprovare.",
    verificationSendFailed:
      "Non siamo riusciti a inviare il codice di verifica in questo momento. Riprova tra poco.",
    verificationSentByEmail: "Abbiamo inviato un codice di 6 cifre alla tua email.",
    verificationSentBySms: "Abbiamo inviato un codice di 6 cifre via SMS.",
    verificationTooManyAttempts:
      "Troppi tentativi non riusciti. Richiedi un nuovo codice.",
    usernameRule:
      "Usa da 3 a 30 caratteri minuscoli: lettere, numeri, punti, trattini o underscore.",
  },
} satisfies Record<Locale, Record<string, string>>;

function getLocaleFromForm(formData: FormData): Locale {
  return getStringValue(formData.get("locale")) === "en" ? "en" : "it";
}

function getBirthdayValidationError(
  issues: Array<{ message: string; path: PropertyKey[] }>,
): BirthdayValidationError | undefined {
  const message = issues.find((issue) => issue.path[0] === "birthDate")?.message;

  return message === "underage" || message === "invalid_birth_date"
    ? message
    : undefined;
}

function buildFieldErrors(
  fields: string[],
  locale: Locale,
  birthdayValidationError?: BirthdayValidationError,
) {
  const map: Record<string, string> = {
    businessTermsAccepted: formCopy[locale].missingBusinessTerms,
    birthDate: getBirthdayValidationMessage(
      locale,
      birthdayValidationError ?? "invalid_birth_date",
    ),
    confirmPassword: formCopy[locale].passwordMismatch,
    email: formCopy[locale].invalidEmail,
    heardAbout: formCopy[locale].invalidForm,
    partnerTermsAccepted: formCopy[locale].missingPartnerTerms,
    phone: formCopy[locale].invalidForm,
    baseTownOrArea: formCopy[locale].unknownTown,
    whatsapp: formCopy[locale].invalidForm,
    username: formCopy[locale].usernameRule,
  };

  return Object.fromEntries(
    fields.map((field) => [field, map[field] ?? formCopy[locale].invalidForm]),
  );
}

function buildSubmissionFieldErrors(fields: string[], locale: Locale) {
  const map: Record<string, string> = {
    address: formCopy[locale].invalidForm,
    addressCountry: formCopy[locale].missingAddressSelection,
    addressCountryCode: formCopy[locale].missingAddressSelection,
    addressLatitude: formCopy[locale].missingAddressSelection,
    addressLocality: formCopy[locale].missingAddressSelection,
    addressLongitude: formCopy[locale].missingAddressSelection,
    addressPlaceId: formCopy[locale].missingAddressSelection,
    addressPostalCode: formCopy[locale].missingAddressSelection,
    addressProvince: formCopy[locale].missingAddressSelection,
    addressRegion: formCopy[locale].missingAddressSelection,
    addressRoute: formCopy[locale].missingAddressSelection,
    addressStreetNumber: formCopy[locale].missingAddressSelection,
    businessName: formCopy[locale].invalidForm,
    businessTermsAccepted: formCopy[locale].missingBusinessTerms,
    categoryId: formCopy[locale].unknownTown,
    email: formCopy[locale].invalidForm,
    longDescription: formCopy[locale].missingOfferItems,
    openingHours: formCopy[locale].invalidForm,
    ownerEmail: formCopy[locale].invalidForm,
    agreementSignature: formCopy[locale].missingSignature,
    ownerName: formCopy[locale].invalidForm,
    ownerPhone: formCopy[locale].invalidForm,
    signerFullName: formCopy[locale].missingSignerName,
    signerRole: formCopy[locale].missingSignerRole,
    signerRoleOther: formCopy[locale].missingSignerRoleOther,
    paymentMethod: formCopy[locale].missingPaymentMethod,
    phone: formCopy[locale].invalidForm,
    photoUrls: formCopy[locale].missingPhotos,
    shortDescription: formCopy[locale].invalidForm,
    townId: formCopy[locale].unknownTown,
    whatsapp: formCopy[locale].invalidForm,
  };

  return Object.fromEntries(fields.map((field) => [field, map[field] ?? formCopy[locale].invalidForm]));
}

function resolveVerificationDeliveryErrorMessage(error: unknown, locale: Locale) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (
    message.includes("twilio_verify_send_failed:") &&
    message.includes("The phone number is unverified")
  ) {
    return locale === "it"
      ? "Il tuo account Twilio e ancora in modalita trial. Per inviare SMS a questo numero devi prima verificarlo nella console Twilio, oppure passare a un account a pagamento."
      : "Your Twilio account is still in trial mode. To send SMS to this number, first verify the number in the Twilio console or upgrade the account.";
  }

  return formCopy[locale].verificationSendFailed;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

async function findPotentialDuplicateBusinesses(input: {
  address: string;
  addressPlaceId?: string | null;
  businessName: string;
  existingBusinessId?: string | null;
  phone?: string | null;
  route?: string | null;
  streetNumber?: string | null;
  townId: string;
}) {
  const normalizedName = normalizeDuplicateBusinessName(input.businessName);
  const normalizedAddress = normalizeAddressSelectionValue(input.address);
  const normalizedPhone = normalizeDuplicatePhone(input.phone);
  const nameCandidateSearchTerms = getBusinessNameCandidateSearchTerms(input.businessName);
  const streetAddress = buildStreetAddressLine({
    formattedAddress: input.address,
    route: input.route ?? null,
    streetNumber: input.streetNumber ?? null,
  });
  const normalizedStreetAddress = normalizeAddressSelectionValue(streetAddress);
  const localClauses: Prisma.BusinessWhereInput[] = [];
  const clauses: Prisma.BusinessWhereInput[] = [];

  if (input.addressPlaceId) {
    localClauses.push({
      addressPlaceId: input.addressPlaceId,
    });
  }

  if (normalizedName) {
    localClauses.push({
      name: {
        equals: input.businessName.trim(),
      },
    });
  }

  for (const token of nameCandidateSearchTerms) {
    localClauses.push({
      name: {
        contains: token,
      },
    });
  }

  if (input.address.trim()) {
    localClauses.push({
      address: {
        equals: input.address.trim(),
      },
    });
  }

  if (input.route?.trim() && input.streetNumber?.trim()) {
    localClauses.push({
      AND: [
        {
          addressRoute: {
            equals: input.route.trim(),
          },
        },
        {
          addressStreetNumber: {
            equals: input.streetNumber.trim(),
          },
        },
      ],
    });
    localClauses.push({
      AND: [
        {
          address: {
            contains: input.route.trim(),
          },
        },
        {
          address: {
            contains: input.streetNumber.trim(),
          },
        },
      ],
    });
  }

  if (normalizedPhone.length >= 6) {
    clauses.push({
      phone: {
        contains: normalizedPhone.slice(-6),
      },
    });
  }

  if (localClauses.length) {
    clauses.push({
      AND: [
        {
          townId: input.townId,
        },
        {
          OR: localClauses,
        },
      ],
    });
  }

  if (!clauses.length) {
    return [];
  }

  const businesses = await prisma.business.findMany({
    where: {
      id: input.existingBusinessId
        ? {
            not: input.existingBusinessId,
          }
        : undefined,
      isLikelyClosed: false,
      OR: clauses,
    },
    select: {
      address: true,
      addressPlaceId: true,
      addressRoute: true,
      addressStreetNumber: true,
      category: {
        select: {
          name: true,
        },
      },
      id: true,
      name: true,
      phone: true,
      slug: true,
      townId: true,
      town: {
        select: {
          name: true,
        },
      },
    },
    take: 32,
  });

  return businesses
    .map((business) => {
      const businessAddressNormalized = normalizeAddressSelectionValue(business.address);
      const businessStreetAddressNormalized = normalizeAddressSelectionValue(
        buildStreetAddressLine({
          formattedAddress: business.address,
          route: business.addressRoute,
          streetNumber: business.addressStreetNumber,
        }),
      );

      const addressMatches =
        (input.addressPlaceId && business.addressPlaceId === input.addressPlaceId) ||
        normalizedAddressValuesMatch(
          [normalizedAddress, normalizedStreetAddress],
          [businessAddressNormalized, businessStreetAddressNormalized],
        );

      const phoneMatches = Boolean(
        normalizedPhone &&
        business.phone &&
        normalizeDuplicatePhone(business.phone) === normalizedPhone
      );
      const nameMatchStrength = getBusinessNameMatchStrength(input.businessName, business.name);
      const matchReasons: DuplicateBusinessMatch["matchReasons"] = [];

      if (
        isBusinessNameDuplicateSignal({
          addressMatches,
          matchStrength: nameMatchStrength,
          phoneMatches,
          sameTown: business.townId === input.townId,
        })
      ) {
        matchReasons.push("name");
      }

      if (addressMatches) {
        matchReasons.push("address");
      }

      if (phoneMatches) {
        matchReasons.push("phone");
      }

      if (!matchReasons.length) {
        return null;
      }

      return {
        address: business.address,
        categoryName: business.category.name,
        id: business.id,
        matchReasons,
        name: business.name,
        phone: business.phone,
        slug: business.slug,
        townName: business.town.name,
      } satisfies DuplicateBusinessMatch;
    })
    .filter((business): business is DuplicateBusinessMatch => Boolean(business))
    .sort((left, right) => right.matchReasons.length - left.matchReasons.length);
}

function buildBusinessDescription(shortDescription: string, longDescription: string) {
  const cleanedLines = longDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(notes collected on site|punti raccolti sul posto):$/i.test(line))
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);

  if (!cleanedLines.length) {
    return shortDescription;
  }

  return cleanedLines.join(". ");
}

function buildOpeningHoursSummary(value: string, locale: Locale) {
  if (!value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Array<{
      close1?: string;
      close2?: string;
      closed?: boolean;
      day?: string;
      open1?: string;
      open2?: string;
      split?: boolean;
    }>;

    if (!Array.isArray(parsed)) {
      return value;
    }

    const dayLabels = {
      monday: "Mo",
      tuesday: "Tu",
      wednesday: "We",
      thursday: "Th",
      friday: "Fr",
      saturday: "Sa",
      sunday: "Su",
    };

    return parsed
      .map((day) => {
        const label = dayLabels[day.day as keyof typeof dayLabels] ?? day.day ?? "";

        if (day.closed) {
          return `${label} ${locale === "it" ? "chiuso" : "closed"}`;
        }

        const firstWindow =
          day.open1 && day.close1 ? `${day.open1}-${day.close1}` : null;
        const secondWindow =
          day.split && day.open2 && day.close2 ? `${day.open2}-${day.close2}` : null;
        const windows = [firstWindow, secondWindow].filter(Boolean).join(",");

        return windows ? `${label} ${windows}` : null;
      })
      .filter(Boolean)
      .join("; ");
  } catch {
    return value;
  }
}

async function buildUniqueBusinessSlug(baseValue: string, existingBusinessId?: string | null) {
  const baseSlug = slugify(baseValue) || "business";
  let attempt = baseSlug;
  let counter = 2;

  while (true) {
    const existingBusiness = await prisma.business.findUnique({
      where: {
        slug: attempt,
      },
      select: {
        id: true,
      },
    });

    if (!existingBusiness || existingBusiness.id === existingBusinessId) {
      return attempt;
    }

    attempt = `${baseSlug}-${counter}`;
    counter += 1;
  }
}

function buildAdminRedirect(search: string) {
  return search ? `/settings?admin=${encodeURIComponent(search)}` : "/settings";
}

function appendReturnPathNotice(returnPath: string, key: string, value: string) {
  const separator = returnPath.includes("?") ? "&" : "?";
  return `${returnPath}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function getRoleOnboardingRedirect(role: "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER") {
  return "/dashboard";
}

function resolveRequestedAccountRole({
  requestedRole,
}: {
  requestedRole: string;
}) {
  if (requestedRole === "BUSINESS_OWNER") {
    return "BUSINESS_OWNER" as const;
  }

  if (requestedRole === "GETTER") {
    return "GETTER" as const;
  }

  return "USER" as const;
}

function buildPostAuthRedirect(role: "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER") {
  return getRoleOnboardingRedirect(role);
}

function resolvePostAuthRedirect(
  role: "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER",
  overrideValue: string,
) {
  return getSafeInternalRedirect(overrideValue) ?? buildPostAuthRedirect(role);
}

function resolveVerificationDestination({
  channel,
  email,
  phone,
  whatsapp,
}: {
  channel: VerificationChannel;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
}) {
  if (channel === "EMAIL") {
    return email?.trim() || null;
  }

  if (channel === "SMS") {
    return phone?.trim() || whatsapp?.trim() || null;
  }

  if (channel === "WHATSAPP") {
    return whatsapp?.trim() || null;
  }

  return null;
}

async function issueSubmissionVerificationCode({
  locale,
  submissionId,
}: {
  locale: Locale;
  submissionId: string;
}) {
  const submission = await prisma.businessSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      ownerEmail: true,
      ownerPhone: true,
      verificationChannel: true,
    },
  });

  if (!submission?.verificationChannel || submission.verificationChannel === "MANUAL") {
    return null;
  }

  const recipient = resolveVerificationDestination({
    channel: submission.verificationChannel,
    email: submission.ownerEmail,
    whatsapp: submission.ownerPhone,
  });

  if (!recipient) {
    return null;
  }

  const code = createVerificationCode();

  await prisma.businessSubmission.update({
    where: { id: submission.id },
    data: {
      verificationAttempts: 0,
      verificationCodeExpiresAt: buildVerificationExpiry(15),
      verificationCodeHash: hashVerificationCode(code),
      verificationLastSentAt: new Date(),
      verificationSentTo: recipient,
    },
  });

  await sendVerificationCode({
    channel: submission.verificationChannel,
    code,
    locale,
    recipient,
    subject: "business-submission",
  });

  return recipient;
}

async function issueBusinessClaimVerificationCode({
  claimId,
  locale,
  resend = false,
}: {
  claimId: string;
  locale: Locale;
  resend?: boolean;
}) {
  const claim = await prisma.businessClaim.findUnique({
    where: { id: claimId },
    select: {
      businessContactEmail: true,
      verificationChannel: true,
      id: true,
    },
  });

  if (!claim || claim.verificationChannel !== "EMAIL") {
    return null;
  }

  const recipient = getBusinessClaimVerificationEmail({
    ownerEmail: claim.businessContactEmail,
    ownerHasNoEmail: false,
  });

  if (!recipient) {
    return null;
  }

  const code = createVerificationCode();
  const now = new Date();

  const issued = await prisma.businessClaim.updateMany({
    where: resend
      ? {
          id: claim.id,
          resendAvailableAt: { lte: now },
          resendCount: { lt: CLAIM_VERIFICATION_MAX_RESENDS + 1 },
          status: "AWAITING_VERIFICATION",
          verificationChannel: "EMAIL",
        }
      : {
          id: claim.id,
          status: "REQUESTED",
          verificationChannel: "EMAIL",
        },
    data: {
      resendAvailableAt: buildVerificationResendAt(CLAIM_VERIFICATION_RESEND_COOLDOWN_MINUTES),
      resendCount: {
        increment: 1,
      },
      status: "AWAITING_VERIFICATION",
      verificationAttempts: 0,
      verificationCodeExpiresAt: buildVerificationExpiry(CLAIM_VERIFICATION_EXPIRY_MINUTES),
      verificationCodeHash: hashVerificationCode(code),
      verificationLastSentAt: new Date(),
      verificationSentTo: recipient,
    },
  });

  if (!issued.count) {
    return null;
  }

  await sendVerificationCode({
    channel: claim.verificationChannel,
    code,
    locale,
    recipient,
    subject: "business-claim",
  });

  return recipient;
}

export async function loginAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const redirectTo = getSafeInternalRedirect(getStringValue(formData.get("redirectTo")));
  const parsed = loginSchema.safeParse({
    identifier: getStringValue(formData.get("identifier")),
    password: getStringValue(formData.get("password")),
  });

  if (!parsed.success) {
    return {
      error: formCopy[locale].invalidForm,
      fieldErrors: buildFieldErrors(["identifier", "password"], locale),
    };
  }

  try {
    await signIn("credentials", {
      identifier: parsed.data.identifier,
      password: parsed.data.password,
      redirectTo: redirectTo ?? "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: formCopy[locale].invalidCredentials,
      };
    }

    throw error;
  }

  return {};
}

export async function signupAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const requestedRole = getStringValue(formData.get("accountType"));
  const redirectTo = getStringValue(formData.get("redirectTo"));
  const confirmPassword = getStringValue(formData.get("confirmPassword"));
  const rawPassword = getStringValue(formData.get("password"));
  const rawEmail = getStringValue(formData.get("email"));
  const rawUsername = getStringValue(formData.get("username"));
  const requestedUsername = normalizeUsername(rawUsername);
  const signupValues = {
    baseTownOrArea: getStringValue(formData.get("baseTownOrArea")),
    businessTermsAccepted: getStringValue(formData.get("businessTermsAccepted")) === "on",
    birthDate: getStringValue(formData.get("birthDate")),
    confirmPassword,
    email: rawEmail,
    heardAbout: getStringValue(formData.get("heardAbout")).trim(),
    heardAboutOther: getStringValue(formData.get("heardAboutOther")).trim(),
    hometownTownId: getStringValue(formData.get("hometownTownId")).trim(),
    partnerPhone: getStringValue(formData.get("phone")),
    partnerTermsAccepted: getStringValue(formData.get("partnerTermsAccepted")) === "on",
    password: rawPassword,
    username: rawUsername,
    whatsapp: getStringValue(formData.get("whatsapp")),
  };
  const parsed = signupSchema.safeParse({
    email: normalizeEmail(rawEmail),
    password: rawPassword,
    username: requestedUsername,
  });
  const requiresBusinessTerms = requestedRole === "BUSINESS_OWNER";
  const requiresPartnerTerms = requestedRole === "GETTER";
  const missingBusinessTerms = requiresBusinessTerms && !signupValues.businessTermsAccepted;
  const missingPartnerTerms = requiresPartnerTerms && !signupValues.partnerTermsAccepted;
  const passwordMismatch = confirmPassword !== rawPassword;
  const hometownTownId = getStringValue(formData.get("hometownTownId")).trim();
  const rawHeardAbout = signupValues.heardAbout;
  const rawHeardAboutOther = signupValues.heardAboutOther;
  const rawPartnerProfile = {
    baseTownOrArea: signupValues.baseTownOrArea,
    birthDate: signupValues.birthDate,
    heardAbout: rawHeardAbout,
    heardAboutOther: rawHeardAboutOther,
    phone: signupValues.partnerPhone,
    whatsapp: signupValues.whatsapp,
  };
  const parsedPartnerProfile =
    requestedRole === "GETTER"
      ? localPartnerOnboardingSchema.safeParse(rawPartnerProfile)
      : null;
  const hometown =
    requestedRole === "GETTER" && hometownTownId
      ? await prisma.town.findUnique({
          where: {
            id: hometownTownId,
          },
          select: {
            name: true,
          },
        })
      : null;
  const invalidPartnerTown =
    requestedRole === "GETTER" && (!hometownTownId || !hometown);
  const invalidHeardAboutOther =
    requestedRole === "GETTER" &&
    rawHeardAbout === "other" &&
    !rawHeardAboutOther;

  if (
    !parsed.success ||
    missingBusinessTerms ||
    missingPartnerTerms ||
    passwordMismatch ||
    (requestedRole === "GETTER" &&
      (!parsedPartnerProfile?.success || invalidPartnerTown || invalidHeardAboutOther))
  ) {
    const invalidFields = parsed.success
      ? []
      : parsed.error.issues.map((issue) => String(issue.path[0] ?? "form"));

    if (missingBusinessTerms) {
      invalidFields.push("businessTermsAccepted");
    }

    if (missingPartnerTerms) {
      invalidFields.push("partnerTermsAccepted");
    }

    if (passwordMismatch) {
      invalidFields.push("confirmPassword");
    }

    if (requestedRole === "GETTER") {
      if (parsedPartnerProfile && !parsedPartnerProfile.success) {
        invalidFields.push(
          ...parsedPartnerProfile.error.issues.map((issue) =>
            String(issue.path[0] ?? "form"),
          ),
        );
      }

      if (invalidPartnerTown) {
        invalidFields.push("baseTownOrArea");
      }

      if (invalidHeardAboutOther) {
        invalidFields.push("heardAbout");
      }
    }

    const uniqueInvalidFields = [...new Set(invalidFields)];
    const birthdayValidationError =
      parsedPartnerProfile && !parsedPartnerProfile.success
        ? getBirthdayValidationError(parsedPartnerProfile.error.issues)
        : undefined;
    const hasInvalidBirthday = Boolean(birthdayValidationError);

    return {
      error:
        hasInvalidBirthday
          ? getBirthdayValidationMessage(
              locale,
              birthdayValidationError ?? "invalid_birth_date",
            )
          : missingBusinessTerms && uniqueInvalidFields.length === 1
          ? formCopy[locale].missingBusinessTerms
          : missingPartnerTerms && uniqueInvalidFields.length === 1
            ? formCopy[locale].missingPartnerTerms
            : passwordMismatch && uniqueInvalidFields.length === 1
              ? formCopy[locale].passwordMismatch
              : formCopy[locale].invalidForm,
      fieldErrors: buildFieldErrors(
        uniqueInvalidFields,
        locale,
        birthdayValidationError,
      ),
      signupValues,
    };
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: parsed.data.email },
        { username: parsed.data.username },
      ],
    },
    select: {
      email: true,
      username: true,
    },
  });

  if (existing?.email === parsed.data.email) {
    return {
      error: formCopy[locale].duplicateEmail,
      fieldErrors: {
        email: formCopy[locale].duplicateEmail,
      },
      signupValues,
    };
  }

  if (existing?.username === parsed.data.username) {
    return {
      error: formCopy[locale].duplicateUsername,
      fieldErrors: {
        username: formCopy[locale].duplicateUsername,
      },
      signupValues,
    };
  }

  if (!canUsePrimaryAdminUsername(null, parsed.data.username)) {
    return {
      error: formCopy[locale].reservedAdminUsername,
      fieldErrors: {
        username: formCopy[locale].reservedAdminUsername,
      },
      signupValues,
    };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const role = resolveRequestedAccountRole({
    requestedRole,
  });

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: parsed.data.email,
        passwordHash,
        profileCompleted: true,
        role,
        username: parsed.data.username,
      },
    });

    if (role === "GETTER" && parsedPartnerProfile?.success && hometown) {
      const heardAboutValue =
        parsedPartnerProfile.data.heardAbout === "other"
          ? `other:${rawHeardAboutOther}`
          : parsedPartnerProfile.data.heardAbout;

      await tx.localPartnerProfile.create({
        data: {
          baseTownOrArea: hometown.name,
          billingAddress: "",
          birthDate: new Date(parsedPartnerProfile.data.birthDate),
          completedAt: new Date(),
          fullName: "",
          heardAbout: heardAboutValue,
          legalFullName: "",
          phone: parsedPartnerProfile.data.phone,
          preferredLanguage: locale,
          taxIdOrVatNumber: "",
          understandsDirectPayment: true,
          understandsNoCash: true,
          understandsNoNegotiation: true,
          understandsNoPricing: true,
          user: {
            connect: {
              id: user.id,
            },
          },
          whatsapp: parsedPartnerProfile.data.whatsapp?.trim() || null,
        },
      });

      await recordCurrentLegalAcceptances({
        acceptanceContext: "PARTNER_SIGNUP",
        audience: "partner",
        db: tx,
        locale,
        userId: user.id,
      });
    }

    if (role === "BUSINESS_OWNER") {
      await recordCurrentLegalAcceptances({
        acceptanceContext: "BUSINESS_SIGNUP",
        audience: "business",
        db: tx,
        locale,
        userId: user.id,
      });
    }
  });

  try {
    await signIn("credentials", {
      identifier: parsed.data.email,
      password: rawPassword,
      redirectTo: resolvePostAuthRedirect(role, redirectTo),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: formCopy[locale].invalidSession,
        signupValues,
      };
    }

    throw error;
  }

  return {};
}

export async function completeProfileAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireViewer();
  const requestedRole = getStringValue(formData.get("accountType"));
  const redirectTo = getStringValue(formData.get("redirectTo"));
  const parsed = completeProfileSchema.safeParse({
    username: normalizeUsername(getStringValue(formData.get("username"))),
  });

  if (!parsed.success) {
    return {
      error: formCopy[locale].invalidForm,
      fieldErrors: {
        username: formCopy[locale].usernameRule,
      },
    };
  }

  const existing = await prisma.user.findFirst({
    where: {
      username: parsed.data.username,
      NOT: {
        id: viewer.id,
      },
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return {
      error: formCopy[locale].duplicateUsername,
      fieldErrors: {
        username: formCopy[locale].duplicateUsername,
      },
    };
  }

  if (!canUsePrimaryAdminUsername(viewer, parsed.data.username)) {
    return {
      error: formCopy[locale].reservedAdminUsername,
      fieldErrors: {
        username: formCopy[locale].reservedAdminUsername,
      },
    };
  }

  const role = resolveRequestedAccountRole({
    requestedRole,
  });

  await prisma.user.update({
    where: {
      id: viewer.id,
    },
    data: {
      profileCompleted: true,
      role,
      username: parsed.data.username,
    },
  });

  redirect(resolvePostAuthRedirect(role, redirectTo));
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT;")
  );
}

export async function saveBusinessSubmissionAction(
  previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const requestedIntent = getStringValue(formData.get("intent"));
  const requestedPaymentMethod = getStringValue(formData.get("paymentMethod"));
  const isPaymentSubmission =
    requestedIntent === "submit" &&
    (requestedPaymentMethod === "ONLINE" || requestedPaymentMethod === "BANK_TRANSFER");

  try {
    const result = await saveBusinessSubmission(previousState, formData);

    if (!isPaymentSubmission) {
      return result;
    }

    return ensurePaymentQrActionResult({
      locale,
      onInvalidResult: (reason) => {
        console.error("[publish:payment-action-contract]", {
          duplicateDecision: getStringValue(formData.get("duplicateDecision")),
          duplicateMatchCount: result.duplicateMatches?.length ?? 0,
          paymentMethod: requestedPaymentMethod,
          reason,
          submissionId: getStringValue(formData.get("submissionId")),
        });
      },
      result,
    });
  } catch (error) {
    // redirect() deliberately throws an internal control-flow value. It must
    // reach Next.js unchanged or the form appears to do nothing.
    if (isNextRedirect(error)) {
      throw error;
    }

    console.error(
      "[publish:save-submission]",
      {
        paymentMethod: requestedPaymentMethod || null,
        stage: isPaymentSubmission ? "payment-submission" : "draft-or-validation",
        submissionId: getStringValue(formData.get("submissionId")) || null,
      },
      error,
    );

    return {
      error:
        locale === "it"
          ? isPaymentSubmission
            ? getPaymentQrOpeningError("it")
            : "Non siamo riusciti a salvare la bozza. Riprova tra un momento."
          : isPaymentSubmission
            ? getPaymentQrOpeningError("en")
            : "We couldn't save the draft. Please try again in a moment.",
    };
  }
}

export async function openBusinessSubmissionPaymentAction(
  formData: FormData,
): Promise<PaymentQrSelectionResult> {
  const locale = getLocaleFromForm(formData);
  const paymentMethod = getStringValue(formData.get("paymentMethod"));

  if (paymentMethod !== "ONLINE" && paymentMethod !== "BANK_TRANSFER") {
    return {
      error: getPaymentQrOpeningError(locale),
      ok: false,
    };
  }

  if (
    paymentMethod === "ONLINE" &&
    !["AUTO", "MANUAL"].includes(getStringValue(formData.get("renewalPreference")))
  ) {
    return {
      error: locale === "it"
        ? "Scegli prima il rinnovo automatico o manuale."
        : "Choose automatic or manual renewal before continuing.",
      ok: false,
    };
  }

  // This dedicated action is the only client contract for a payment-choice
  // click. It cannot accidentally become a draft save after a UI refactor.
  formData.set("intent", "submit");
  formData.set("paymentMethod", paymentMethod);

  const result = await saveBusinessSubmissionAction({}, formData);

  return toPaymentQrSelectionResult({ locale, result });
}

async function saveBusinessSubmission(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();
  const adminMode =
    getStringValue(formData.get("adminMode")) === "true" && viewer.role === "ADMIN";
  const requestedIntent = getStringValue(formData.get("intent"));
  const intent = requestedIntent === "submit" ? "submit" : "draft";
  const isDuplicateCheck = requestedIntent === "check";
  const exitAfterDraftSave = getStringValue(formData.get("exitAfterDraftSave")) === "true";
  const duplicateDecision = getStringValue(formData.get("duplicateDecision")).trim();
  const submissionId = getStringValue(formData.get("submissionId")).trim();
  const rawSubmission = {
    address: getStringValue(formData.get("address")),
    addressCountry: getStringValue(formData.get("addressCountry")),
    addressCountryCode: getStringValue(formData.get("addressCountryCode")),
    addressLatitude: getStringValue(formData.get("addressLatitude")),
    addressLocality: getStringValue(formData.get("addressLocality")),
    addressLongitude: getStringValue(formData.get("addressLongitude")),
    addressPlaceId: getStringValue(formData.get("addressPlaceId")),
    addressPostalCode: getStringValue(formData.get("addressPostalCode")),
    addressProvince: getStringValue(formData.get("addressProvince")),
    addressRegion: getStringValue(formData.get("addressRegion")),
    addressRoute: getStringValue(formData.get("addressRoute")),
    addressStreetNumber: getStringValue(formData.get("addressStreetNumber")),
    agreementAccepted: getStringValue(formData.get("agreement")) === "on",
    agreementSignature: getStringValue(formData.get("agreementSignature")),
    businessSummary: getStringValue(formData.get("businessSummary")),
    businessName: getStringValue(formData.get("businessName")),
    categoryId: getStringValue(formData.get("categoryId")),
    email: getStringValue(formData.get("email")),
    facebook: getStringValue(formData.get("facebook")),
    googleMapsUrl: getStringValue(formData.get("googleMapsUrl")),
    id: submissionId || undefined,
    instagram: getStringValue(formData.get("instagram")),
    longDescription: getStringValue(formData.get("longDescription")),
    openingHours: getStringValue(formData.get("openingHours")),
    ownerEmail: getStringValue(formData.get("ownerEmail")),
    ownerHasNoEmail: getStringValue(formData.get("ownerHasNoEmail")) === "on",
    ownerName: getStringValue(formData.get("ownerName")),
    ownerPhone: getStringValue(formData.get("ownerPhone")),
    signerFullName: getStringValue(formData.get("signerFullName")),
    signerRole: getStringValue(formData.get("signerRole")),
    signerRoleOther: getStringValue(formData.get("signerRoleOther")),
    paymentMethod: getStringValue(formData.get("paymentMethod")) || undefined,
    phone: getStringValue(formData.get("phone")),
    photoUrls: getStringValue(formData.get("photoUrls")),
    shortDescription: getStringValue(formData.get("shortDescription")),
    townId: getStringValue(formData.get("townId")),
    website: getStringValue(formData.get("website")),
    whatsapp: getStringValue(formData.get("whatsapp")),
  };
  const wantsPaymentStep = intent === "submit" && Boolean(rawSubmission.paymentMethod);
  // An untouched optional draft field arrives from the hidden form control as
  // an empty string. Normalize it for validation so early drafts can save; the
  // final-submit schema still requires a real signer role.
  const submissionForValidation = {
    ...rawSubmission,
    signerRole: rawSubmission.signerRole || undefined,
  };
  const parsed =
    wantsPaymentStep
      ? adminMode
        ? adminBusinessSubmissionSubmitSchema.safeParse(submissionForValidation)
        : businessSubmissionSubmitSchema.safeParse(submissionForValidation)
      : businessSubmissionDraftSchema.safeParse(submissionForValidation);

  if (!parsed.success) {
    const invalidFields = parsed.error.issues.map((issue) =>
      String(issue.path[0] ?? "form"),
    );

    return {
      error: formCopy[locale].invalidForm,
      fieldErrors: buildSubmissionFieldErrors(invalidFields, locale),
      invalidFields,
      submission: rawSubmission,
    };
  }

  const noEmailPhoneError = wantsPaymentStep ? getNoEmailPaymentPhoneError({
    locale,
    ownerEmail: parsed.data.ownerEmail,
    ownerPhone: parsed.data.ownerPhone,
    paymentMethod: parsed.data.paymentMethod,
    submitterRole: viewer.role,
  }) : null;
  if (noEmailPhoneError) return { ...noEmailPhoneError, submission: rawSubmission };

  if (wantsPaymentStep &&
    parsed.data.paymentMethod === "ONLINE" && !parsed.data.ownerEmail?.trim() &&
    getStringValue(formData.get("renewalPreference")) !== "MANUAL") {
    return {
      error: locale === "it"
        ? "Per un titolare senza email scegli il rinnovo manuale."
        : "Choose manual renewal for an owner without email.",
      submission: rawSubmission,
    };
  }

  if (wantsPaymentStep && getStringValue(formData.get("agreement")) !== "on") {
    return {
      error: formCopy[locale].missingAgreement,
      fieldErrors: {
        agreement: formCopy[locale].missingAgreement,
      },
      invalidFields: ["agreement"],
      submission: rawSubmission,
    };
  }

  const contractualEmail = resolveContractualEmail({
    businessEmail: parsed.data.email,
    ownerEmail: parsed.data.ownerEmail,
  });

  const [town, category] = await Promise.all([
    parsed.data.townId
      ? prisma.town.findUnique({
          where: {
            id: parsed.data.townId,
          },
          select: {
            id: true,
            latitude: true,
            longitude: true,
            name: true,
            slug: true,
          },
        })
      : Promise.resolve(null),
    parsed.data.categoryId
      ? prisma.category.findUnique({
          where: {
            id: parsed.data.categoryId,
          },
          select: {
            id: true,
            slug: true,
          },
        })
      : Promise.resolve(null),
  ]);

  const hasInvalidLocation =
    (parsed.data.townId && !town) || (parsed.data.categoryId && !category);

  if (hasInvalidLocation) {
    return {
      error: formCopy[locale].unknownTown,
      fieldErrors: {
        categoryId: formCopy[locale].unknownTown,
        townId: formCopy[locale].unknownTown,
      },
      invalidFields: ["categoryId", "townId"],
      submission: rawSubmission,
    };
  }

  const selectedAddress = buildSelectedAddressFromStoredFields({
    address: parsed.data.address,
    addressCountry: parsed.data.addressCountry,
    addressCountryCode: parsed.data.addressCountryCode,
    addressLatitude: parsed.data.addressLatitude,
    addressLocality: parsed.data.addressLocality,
    addressLongitude: parsed.data.addressLongitude,
    addressPlaceId: parsed.data.addressPlaceId,
    addressPostalCode: parsed.data.addressPostalCode,
    addressProvince: parsed.data.addressProvince,
    addressRegion: parsed.data.addressRegion,
    addressRoute: parsed.data.addressRoute,
    addressStreetNumber: parsed.data.addressStreetNumber,
  });

  if (wantsPaymentStep && !selectedAddress) {
    return {
      error: formCopy[locale].missingAddressSelection,
      fieldErrors: {
        address: formCopy[locale].missingAddressSelection,
      },
      invalidFields: ["address"],
      submission: rawSubmission,
    };
  }

  const selectedAddressStorage = selectedAddress
    ? buildAddressSelectionStorage(selectedAddress)
    : null;

  // The guided form checks for an existing listing as soon as the business and
  // address are known.  It deliberately does not write a record: the regular
  // submit path below remains the single authority for creating a submission.
  if (isDuplicateCheck) {
    const duplicateMatches = await findPotentialDuplicateBusinesses({
      address: parsed.data.address,
      addressPlaceId: selectedAddressStorage?.addressPlaceId,
      businessName: parsed.data.businessName,
      phone: parsed.data.phone,
      route: selectedAddressStorage?.addressRoute,
      streetNumber: selectedAddressStorage?.addressStreetNumber,
      townId: parsed.data.townId,
    });

    return {
      duplicateCheckMessage: duplicateMatches.length
        ? locale === "it"
          ? "Questa attivita potrebbe essere gia presente. Controlla prima di continuare."
          : "This business may already be listed. Please check before continuing."
        : "",
      duplicateMatches,
      submission: rawSubmission,
    };
  }
  let existingSubmission: {
    createdBusinessId: string | null;
    id: string;
    userId: string;
  } | null = null;

  if (submissionId) {
    existingSubmission = await prisma.businessSubmission.findUnique({
      where: {
        id: submissionId,
      },
      select: {
        createdBusinessId: true,
        id: true,
        userId: true,
      },
    });

    if (!existingSubmission || existingSubmission.userId !== viewer.id) {
      return {
        error: formCopy[locale].notAllowed,
        submission: rawSubmission,
      };
    }

    if (adminMode && intent === "submit") {
      const socialLinks = Object.fromEntries(
        [
          ["facebook", normalizeFacebookUrl(parsed.data.facebook)],
          ["instagram", normalizeInstagramUrl(parsed.data.instagram)],
        ].filter((entry): entry is [string, string] => Boolean(entry[1])),
      );
      const mapsUrl =
        selectedAddress ? buildGoogleMapsSearchUrl(selectedAddress) : parsed.data.googleMapsUrl;
      const businessSlug = await buildUniqueBusinessSlug(
        `${parsed.data.businessName}-${town?.slug ?? "salento"}`,
        existingSubmission.createdBusinessId,
      );
      const publicEmail = contractualEmail;
      const businessData = {
        address: parsed.data.address,
        categoryId: parsed.data.categoryId,
        description: buildBusinessDescription(
          parsed.data.shortDescription,
          parsed.data.longDescription,
        ),
        email: publicEmail || null,
        heroImageSeed: `${businessSlug}-manual`,
        addressCountry: selectedAddressStorage?.addressCountry,
        addressCountryCode: selectedAddressStorage?.addressCountryCode,
        addressLocality: selectedAddressStorage?.addressLocality,
        addressPlaceId: selectedAddressStorage?.addressPlaceId,
        addressPostalCode: selectedAddressStorage?.addressPostalCode,
        addressProvince: selectedAddressStorage?.addressProvince,
        addressRegion: selectedAddressStorage?.addressRegion,
        addressRoute: selectedAddressStorage?.addressRoute,
        addressStreetNumber: selectedAddressStorage?.addressStreetNumber,
        latitude: selectedAddressStorage?.addressLatitude ?? town?.latitude ?? 40.173,
        longitude: selectedAddressStorage?.addressLongitude ?? town?.longitude ?? 18.169,
        mapsUrl,
        name: parsed.data.businessName,
        openingHoursText: buildOpeningHoursSummary(parsed.data.openingHours, locale),
        phone: parsed.data.phone || null,
        shortDescription: parsed.data.shortDescription,
        slug: businessSlug,
        socialLinks: Object.keys(socialLinks).length ? socialLinks : undefined,
        townId: parsed.data.townId,
        verificationStatus: "OWNER_VERIFIED" as const,
        website: parsed.data.website || null,
      };
      const photoRows = (parsed.data.photoUrls ?? []).map((url, index) => ({
        alt: `${parsed.data.businessName} photo ${index + 1}`,
        sortOrder: index,
        url,
      }));

      const business = existingSubmission.createdBusinessId
        ? await prisma.business.update({
            where: {
              id: existingSubmission.createdBusinessId,
            },
            data: {
              ...businessData,
              hours: {
                deleteMany: {},
              },
              images: {
                create: photoRows,
                deleteMany: {},
              },
            },
            select: {
              id: true,
              localityId: true,
              slug: true,
              town: {
                select: {
                  slug: true,
                },
              },
            },
          })
        : await prisma.business.create({
            data: {
              ...businessData,
              images: photoRows.length
                ? {
                    create: photoRows,
                  }
                : undefined,
            },
            select: {
              id: true,
              localityId: true,
              slug: true,
              town: {
                select: {
                  slug: true,
                },
              },
            },
          });

      await prisma.businessSubmission.update({
        where: {
          id: submissionId,
        },
        data: {
          address: parsed.data.address,
          addressCountry: selectedAddressStorage?.addressCountry,
          addressCountryCode: selectedAddressStorage?.addressCountryCode,
          addressLatitude: selectedAddressStorage?.addressLatitude,
          addressLocality: selectedAddressStorage?.addressLocality,
          addressLongitude: selectedAddressStorage?.addressLongitude,
          addressPlaceId: selectedAddressStorage?.addressPlaceId,
          addressPostalCode: selectedAddressStorage?.addressPostalCode,
          addressProvince: selectedAddressStorage?.addressProvince,
          addressRegion: selectedAddressStorage?.addressRegion,
          addressRoute: selectedAddressStorage?.addressRoute,
          addressStreetNumber: selectedAddressStorage?.addressStreetNumber,
          agreementSignature: parsed.data.agreementSignature,
          automaticRenewalAtAcceptance: false,
          amountOwedCents: 0,
          amountPaidCents: 0,
          businessTermsAcceptedAt: new Date(),
          businessTermsVersion: LISTING_OFFER.businessTermsVersion,
          businessName: parsed.data.businessName,
          businessPriceCents: 0,
          categoryId: parsed.data.categoryId,
          commissionCents: 0,
          contractualEmail: publicEmail || null,
          createdBusinessId: business.id,
          email: publicEmail,
          facebook: normalizeSubmissionSocialValue(parsed.data.facebook),
          firstYearPriceCentsAtAcceptance: 0,
          googleMapsUrl: mapsUrl,
          instagram: normalizeSubmissionSocialValue(parsed.data.instagram),
          localityId: null,
          listingTermMonthsAtAcceptance: LISTING_OFFER.termMonths,
          longDescription: parsed.data.longDescription,
          openingHours: parsed.data.openingHours,
          ownerEmail: parsed.data.ownerEmail ?? "",
          ownerHasNoEmail: parsed.data.ownerHasNoEmail,
          ownerName: parsed.data.ownerName,
          ownerPhone: parsed.data.ownerPhone,
          paymentMethod: null,
          paymentStatus: "NOT_REQUIRED",
          phone: parsed.data.phone,
          photoUrls: parsed.data.photoUrls,
          platformShareCents: 0,
          privacyPolicyVersionPresented: LISTING_OFFER.privacyPolicyVersion,
          renewalPriceCentsAtAcceptance: 0,
          shortDescription: parsed.data.shortDescription,
          signedAt: new Date(),
          signerFullName: parsed.data.signerFullName || null,
          signerRole: parsed.data.signerRole || null,
          signerRoleOther: parsed.data.signerRoleOther || null,
          status: "PUBLISHED",
          townId: parsed.data.townId,
          website: parsed.data.website,
          whatsapp: parsed.data.whatsapp?.trim() || parsed.data.phone?.trim() || "",
        },
      });

      revalidatePath("/dashboard");
      revalidatePath("/dashboard/businesses");
      revalidatePath("/directory");
      revalidatePath("/explore");
      revalidatePath(`/businesses/${business.slug}`);
      revalidatePath(`/towns/${business.town.slug}`);

      redirect(`/businesses/${business.slug}`);
    }
  }

  const draftDuplicateMatches =
    intent === "draft"
      ? await findPotentialDuplicateBusinesses({
          address: parsed.data.address,
          addressPlaceId: selectedAddressStorage?.addressPlaceId,
          businessName: parsed.data.businessName,
          existingBusinessId: existingSubmission?.createdBusinessId ?? null,
          phone: parsed.data.phone,
          route: selectedAddressStorage?.addressRoute,
          streetNumber: selectedAddressStorage?.addressStreetNumber,
          townId: parsed.data.townId,
        })
      : [];

  if (intent === "submit" && duplicateDecision !== "new") {
    const duplicateMatches = await findPotentialDuplicateBusinesses({
      address: parsed.data.address,
      addressPlaceId: selectedAddressStorage?.addressPlaceId,
      businessName: parsed.data.businessName,
      existingBusinessId: existingSubmission?.createdBusinessId ?? null,
      phone: parsed.data.phone,
      route: selectedAddressStorage?.addressRoute,
      streetNumber: selectedAddressStorage?.addressStreetNumber,
      townId: parsed.data.townId,
    });

    if (duplicateMatches.length) {
      return {
        duplicateCheckMessage:
          locale === "it"
            ? "Questa attivita potrebbe esistere gia. Controlla prima le schede qui sotto."
            : "This business may already exist. Please review the listings below first.",
        duplicateMatches,
        submission: rawSubmission,
      };
    }
  }

  if (adminMode && intent === "submit" && town && category) {
    const socialLinks = Object.fromEntries(
      [
        ["facebook", normalizeFacebookUrl(parsed.data.facebook)],
        ["instagram", normalizeInstagramUrl(parsed.data.instagram)],
      ].filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const mapsUrl =
      selectedAddress ? buildGoogleMapsSearchUrl(selectedAddress) : parsed.data.googleMapsUrl;
    const businessSlug = await buildUniqueBusinessSlug(
      `${parsed.data.businessName}-${town.slug}`,
    );
    const publicEmail = contractualEmail;
    const photoRows = (parsed.data.photoUrls ?? []).map((url, index) => ({
      alt: `${parsed.data.businessName} photo ${index + 1}`,
      sortOrder: index,
      url,
    }));
    const business = await prisma.business.create({
      data: {
        address: parsed.data.address,
        categoryId: category.id,
        description: buildBusinessDescription(
          parsed.data.shortDescription,
          parsed.data.longDescription,
        ),
        email: publicEmail || null,
        heroImageSeed: `${businessSlug}-manual`,
        images: photoRows.length
          ? {
              create: photoRows,
            }
          : undefined,
        addressCountry: selectedAddressStorage?.addressCountry,
        addressCountryCode: selectedAddressStorage?.addressCountryCode,
        addressLocality: selectedAddressStorage?.addressLocality,
        addressPlaceId: selectedAddressStorage?.addressPlaceId,
        addressPostalCode: selectedAddressStorage?.addressPostalCode,
        addressProvince: selectedAddressStorage?.addressProvince,
        addressRegion: selectedAddressStorage?.addressRegion,
        addressRoute: selectedAddressStorage?.addressRoute,
        addressStreetNumber: selectedAddressStorage?.addressStreetNumber,
        latitude: selectedAddressStorage?.addressLatitude ?? town.latitude,
        longitude: selectedAddressStorage?.addressLongitude ?? town.longitude,
        mapsUrl,
        name: parsed.data.businessName,
        openingHoursText: buildOpeningHoursSummary(parsed.data.openingHours, locale),
        phone: parsed.data.phone || null,
        shortDescription: parsed.data.shortDescription,
        slug: businessSlug,
        socialLinks: Object.keys(socialLinks).length ? socialLinks : undefined,
        townId: town.id,
        verificationStatus: "OWNER_VERIFIED",
        website: parsed.data.website || null,
      },
      select: {
        id: true,
        slug: true,
        town: {
          select: {
            slug: true,
          },
        },
      },
    });

    await prisma.businessSubmission.create({
      data: {
        address: parsed.data.address,
        addressCountry: selectedAddressStorage?.addressCountry,
        addressCountryCode: selectedAddressStorage?.addressCountryCode,
        addressLatitude: selectedAddressStorage?.addressLatitude,
        addressLocality: selectedAddressStorage?.addressLocality,
        addressLongitude: selectedAddressStorage?.addressLongitude,
        addressPlaceId: selectedAddressStorage?.addressPlaceId,
        addressPostalCode: selectedAddressStorage?.addressPostalCode,
        addressProvince: selectedAddressStorage?.addressProvince,
        addressRegion: selectedAddressStorage?.addressRegion,
        addressRoute: selectedAddressStorage?.addressRoute,
        addressStreetNumber: selectedAddressStorage?.addressStreetNumber,
        agreementSignature: parsed.data.agreementSignature,
        automaticRenewalAtAcceptance: false,
        amountOwedCents: 0,
        amountPaidCents: 0,
        businessTermsAcceptedAt: new Date(),
        businessTermsVersion: LISTING_OFFER.businessTermsVersion,
        businessName: parsed.data.businessName,
        businessPriceCents: 0,
        categoryId: parsed.data.categoryId,
        commissionCents: 0,
        contractualEmail: publicEmail || null,
        createdBusinessId: business.id,
        email: publicEmail,
        facebook: normalizeSubmissionSocialValue(parsed.data.facebook),
        firstYearPriceCentsAtAcceptance: 0,
        googleMapsUrl: mapsUrl ?? "",
        instagram: normalizeSubmissionSocialValue(parsed.data.instagram),
        localityId: null,
        listingTermMonthsAtAcceptance: LISTING_OFFER.termMonths,
        longDescription: parsed.data.longDescription,
        openingHours: parsed.data.openingHours,
        ownerEmail: parsed.data.ownerEmail ?? "",
        ownerHasNoEmail: parsed.data.ownerHasNoEmail,
        ownerName: parsed.data.ownerName,
        ownerPhone: parsed.data.ownerPhone,
        paymentMethod: null,
        paymentStatus: "NOT_REQUIRED",
        phone: parsed.data.phone,
        photoUrls: parsed.data.photoUrls,
        platformShareCents: 0,
        privacyPolicyVersionPresented: LISTING_OFFER.privacyPolicyVersion,
        renewalPriceCentsAtAcceptance: 0,
        shortDescription: parsed.data.shortDescription,
        signedAt: new Date(),
        signerFullName: parsed.data.signerFullName || null,
        signerRole: parsed.data.signerRole || null,
        signerRoleOther: parsed.data.signerRoleOther || null,
        status: "PUBLISHED",
        townId: parsed.data.townId,
        userId: viewer.id,
        website: parsed.data.website,
        whatsapp: parsed.data.whatsapp?.trim() || parsed.data.phone?.trim() || "",
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/businesses");
    revalidatePath("/directory");
    revalidatePath("/explore");
    revalidatePath(`/businesses/${business.slug}`);
    revalidatePath(`/towns/${business.town.slug}`);

    redirect(`/businesses/${business.slug}`);
  }

  const status: SubmissionStatus = wantsPaymentStep ? getStatusAfterSubmit() : "DRAFT";
  const normalizedWhatsapp =
    parsed.data.whatsapp?.trim() || parsed.data.phone?.trim() || "";
  const publicEmail = contractualEmail;
  const nextPaymentStatus: PaymentStatus =
    wantsPaymentStep
      ? buildPaymentStatusForMethod(parsed.data.paymentMethod)
      : "NOT_REQUIRED";

  const baseSubmissionData = {
    address: parsed.data.address,
    addressCountry: selectedAddressStorage?.addressCountry ?? null,
    addressCountryCode: selectedAddressStorage?.addressCountryCode ?? null,
    addressLatitude: selectedAddressStorage?.addressLatitude ?? null,
    addressLocality: selectedAddressStorage?.addressLocality ?? null,
    addressLongitude: selectedAddressStorage?.addressLongitude ?? null,
    addressPlaceId: selectedAddressStorage?.addressPlaceId ?? null,
    addressPostalCode: selectedAddressStorage?.addressPostalCode ?? null,
    addressProvince: selectedAddressStorage?.addressProvince ?? null,
    addressRegion: selectedAddressStorage?.addressRegion ?? null,
    addressRoute: selectedAddressStorage?.addressRoute ?? null,
    addressStreetNumber: selectedAddressStorage?.addressStreetNumber ?? null,
    agreementSignature: parsed.data.agreementSignature,
    // Bank transfer is always manual. Online automatic renewal requires the
    // explicit, visible selection sent by the payment step.
    automaticRenewalAtAcceptance: wantsPaymentStep && parsed.data.paymentMethod === "ONLINE" && Boolean(parsed.data.ownerEmail?.trim()) && getStringValue(formData.get("renewalPreference")) === "AUTO",
    businessTermsAcceptedAt: wantsPaymentStep && rawSubmission.agreementAccepted ? new Date() : null,
    businessTermsVersion: wantsPaymentStep ? LISTING_OFFER.businessTermsVersion : null,
    businessName: parsed.data.businessName,
    categoryId: parsed.data.categoryId,
    contractualEmail: publicEmail || null,
    email: publicEmail,
    facebook: normalizeSubmissionSocialValue(parsed.data.facebook),
    firstYearPriceCentsAtAcceptance: wantsPaymentStep ? LISTING_OFFER.annualPriceCents : null,
    googleMapsUrl: selectedAddress ? buildGoogleMapsSearchUrl(selectedAddress) : "",
    instagram: normalizeSubmissionSocialValue(parsed.data.instagram),
    localityId: null,
    listingTermMonthsAtAcceptance: wantsPaymentStep ? LISTING_OFFER.termMonths : null,
    longDescription: parsed.data.longDescription,
    openingHours: parsed.data.openingHours,
    ownerEmail: parsed.data.ownerEmail ?? "",
    ownerHasNoEmail: parsed.data.ownerHasNoEmail,
    ownerName: parsed.data.ownerName,
    ownerPhone: parsed.data.ownerPhone,
    bankTransferReference: null,
    paymentMethod: parsed.data.paymentMethod,
    paymentStatus: nextPaymentStatus,
    phone: parsed.data.phone,
    photoUrls: parsed.data.photoUrls,
    privacyPolicyVersionPresented: wantsPaymentStep ? LISTING_OFFER.privacyPolicyVersion : null,
    renewalPriceCentsAtAcceptance: wantsPaymentStep ? LISTING_OFFER.renewalPriceCents : null,
    shortDescription: parsed.data.shortDescription,
    signedAt: wantsPaymentStep ? new Date() : null,
    signerFullName: parsed.data.signerFullName || null,
    signerRole: parsed.data.signerRole || null,
    signerRoleOther: parsed.data.signerRoleOther || null,
    status,
    townId: parsed.data.townId,
    userId: viewer.id,
    verificationChannel: null,
    website: parsed.data.website,
    whatsapp: normalizedWhatsapp,
  };

  async function preparePaymentDestination(id: string, amountOwedCents: number) {
    const paymentSubmission = parsed.data;
    const paymentMethod = paymentSubmission?.paymentMethod;

    if (!paymentSubmission || (paymentMethod !== "ONLINE" && paymentMethod !== "BANK_TRANSFER")) {
      throw new Error("The selected payment method cannot open a QR payment flow.");
    }

    return preparePaymentQrNavigation({
      method: paymentMethod,
      prepareBankTransfer: () =>
        ensureStripeBankTransferIntent({
          submission: {
            amountOwedCents,
            businessName: paymentSubmission.businessName,
            email: publicEmail,
            id,
            ownerEmail: paymentSubmission.ownerEmail,
            ownerName: paymentSubmission.ownerName,
            ownerPhone: paymentSubmission.ownerPhone,
            userId: viewer.id,
          },
          viewer: { email: viewer.email, id: viewer.id, role: viewer.role },
        }),
      prepareOnline: async () => {
        const setup = baseSubmissionData.automaticRenewalAtAcceptance
          ? await ensureEmbeddedSubscription(id)
          : await ensureManualElementPaymentIntent(id);
        if (!getPaymentElementPublishableKey() || !setup) {
          throw new Error("embedded_payment_unavailable");
        }
      },
      submissionId: id,
    });
  }

  if (submissionId) {
    const updatedSubmission = await prisma.businessSubmission.update({
      where: {
        id: submissionId,
      },
      data: baseSubmissionData,
      select: {
        amountOwedCents: true,
        id: true,
        status: true,
      },
    });

    if (wantsPaymentStep) {
      await ensurePendingPartnerCommissionForSubmission({
        businessSubmissionId: updatedSubmission.id,
      });

      return {
        paymentDestination: await preparePaymentDestination(
          updatedSubmission.id,
          updatedSubmission.amountOwedCents,
        ),
        submission: {
          ...rawSubmission,
          id: updatedSubmission.id,
        },
      };
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/businesses");

    if (exitAfterDraftSave) {
      redirect("/dashboard/businesses");
    }

    return {
      duplicateCheckMessage: draftDuplicateMatches.length
        ? locale === "it"
          ? "Questa attivita potrebbe essere gia presente. Controlla prima di continuare."
          : "This business may already be listed. Please check before continuing."
        : "",
      duplicateMatches: draftDuplicateMatches,
      notice:
        locale === "it"
          ? "Bozza salvata. Puoi continuare da qui oppure ritrovarla nelle tue bozze."
          : "Draft saved. You can keep working here or find it again in your drafts.",
      submission: {
        ...rawSubmission,
        id: updatedSubmission.id,
      },
    };
  } else {
    const createdSubmission = await prisma.businessSubmission.create({
      data: {
        ...baseSubmissionData,
        amountOwedCents: adminMode ? 0 : DEFAULT_LISTING_PRICE_CENTS,
        amountPaidCents: 0,
        businessPriceCents: adminMode ? 0 : DEFAULT_LISTING_PRICE_CENTS,
        commissionCents: adminMode ? 0 : DEFAULT_COMMISSION_CENTS,
        paymentStatus: nextPaymentStatus,
        platformShareCents: adminMode ? 0 : DEFAULT_PLATFORM_SHARE_CENTS,
      },
      select: {
        id: true,
      },
    });

    if (wantsPaymentStep) {
      await ensurePendingPartnerCommissionForSubmission({
        businessSubmissionId: createdSubmission.id,
      });

      return {
        paymentDestination: await preparePaymentDestination(
          createdSubmission.id,
          DEFAULT_LISTING_PRICE_CENTS,
        ),
        submission: {
          ...rawSubmission,
          id: createdSubmission.id,
        },
      };
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/businesses");

    if (exitAfterDraftSave) {
      redirect("/dashboard/businesses");
    }

    return {
      duplicateCheckMessage: draftDuplicateMatches.length
        ? locale === "it"
          ? "Questa attivita potrebbe essere gia presente. Controlla prima di continuare."
          : "This business may already be listed. Please check before continuing."
        : "",
      duplicateMatches: draftDuplicateMatches,
      notice:
        locale === "it"
          ? "Bozza salvata. Puoi continuare da qui oppure ritrovarla nelle tue bozze."
          : "Draft saved. You can keep working here or find it again in your drafts.",
      submission: {
        ...rawSubmission,
        id: createdSubmission.id,
      },
    };
  }
}

export type DeleteDraftSubmissionResult = {
  error?: string;
  success?: true;
};

export async function deleteDraftSubmissionAction(
  formData: FormData,
): Promise<DeleteDraftSubmissionResult> {
  const locale = getLocaleFromForm(formData);
  const submissionId = getStringValue(formData.get("submissionId")).trim();

  if (!submissionId) {
    return {
      error:
        locale === "it"
          ? "Non troviamo più questa bozza. Aggiorna la pagina e riprova."
          : "We couldn't find this draft. Refresh the page and try again.",
    };
  }

  try {
    const viewer = await requireCompletedViewer();
    const draft = await prisma.businessSubmission.findUnique({
      where: {
        id: submissionId,
      },
      select: {
        id: true,
        paymentMethod: true,
        paymentStatus: true,
        status: true,
        userId: true,
      },
    });

    if (!draft || draft.userId !== viewer.id || !isDraftLikeSubmission(draft)) {
      return {
        error:
          locale === "it"
            ? "Questa bozza non è più disponibile per l'eliminazione. Aggiorna la pagina e riprova."
            : "This draft is no longer available to delete. Refresh the page and try again.",
      };
    }

    await prisma.businessSubmission.delete({
      where: {
        id: draft.id,
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/businesses");

    return { success: true };
  } catch (error) {
    // Authentication redirects must keep their normal control flow.
    if (isNextRedirect(error)) {
      throw error;
    }

    console.error("[submission:delete-draft]", { submissionId }, error);

    return {
      error:
        locale === "it"
          ? "Non siamo riusciti a eliminare la bozza. Riprova tra un momento."
          : "We couldn't delete the draft. Please try again in a moment.",
    };
  }
}

export async function completeLocalPartnerOnboardingAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();

  if (viewer.role !== "GETTER") {
    redirect("/dashboard");
  }

  const parsed = localPartnerOnboardingSchema.safeParse({
    baseTownOrArea: getStringValue(formData.get("baseTownOrArea")),
    birthDate: getStringValue(formData.get("birthDate")),
    heardAbout: getStringValue(formData.get("heardAbout")),
    heardAboutOther: getStringValue(formData.get("heardAboutOther")),
    phone: getStringValue(formData.get("phone")),
    whatsapp: getStringValue(formData.get("whatsapp")),
  });

  if (!parsed.success) {
    const invalidFields = parsed.error.issues.map((issue) => String(issue.path[0] ?? "form"));
    const birthdayValidationError = getBirthdayValidationError(parsed.error.issues);
    const hasInvalidBirthday = Boolean(birthdayValidationError);

    return {
      error: hasInvalidBirthday
        ? getBirthdayValidationMessage(
            locale,
            birthdayValidationError ?? "invalid_birth_date",
          )
        : formCopy[locale].invalidForm,
      fieldErrors: buildFieldErrors(
        [...new Set(invalidFields)],
        locale,
        birthdayValidationError,
      ),
    };
  }

  const hometownTownId = getStringValue(formData.get("hometownTownId")).trim();
  const hometown = hometownTownId
    ? await prisma.town.findUnique({
        where: {
          id: hometownTownId,
        },
        select: {
          name: true,
        },
      })
    : null;

  if (!hometown) {
    return {
      error: formCopy[locale].unknownTown,
      fieldErrors: {
        baseTownOrArea: formCopy[locale].unknownTown,
      },
    };
  }

  if (parsed.data.heardAbout === "other" && !parsed.data.heardAboutOther?.trim()) {
    return {
      error: formCopy[locale].invalidForm,
      fieldErrors: {
        heardAbout: formCopy[locale].invalidForm,
      },
    };
  }

  const heardAboutValue =
    parsed.data.heardAbout === "other"
      ? `other:${parsed.data.heardAboutOther?.trim() || ""}`
      : parsed.data.heardAbout;

  await prisma.localPartnerProfile.upsert({
    where: {
      userId: viewer.id,
    },
    update: {
      baseTownOrArea: hometown.name,
      billingAddress: "",
      birthDate: new Date(parsed.data.birthDate),
      completedAt: new Date(),
      fullName: "",
      heardAbout: heardAboutValue,
      legalFullName: "",
      phone: parsed.data.phone,
      preferredLanguage: locale,
      taxIdOrVatNumber: "",
      understandsDirectPayment: true,
      understandsNoCash: true,
      understandsNoNegotiation: true,
      understandsNoPricing: true,
      whatsapp: parsed.data.whatsapp?.trim() || null,
    },
    create: {
      baseTownOrArea: hometown.name,
      billingAddress: "",
      birthDate: new Date(parsed.data.birthDate),
      completedAt: new Date(),
      fullName: "",
      heardAbout: heardAboutValue,
      legalFullName: "",
      phone: parsed.data.phone,
      preferredLanguage: locale,
      taxIdOrVatNumber: "",
      understandsDirectPayment: true,
      understandsNoCash: true,
      understandsNoNegotiation: true,
      understandsNoPricing: true,
      userId: viewer.id,
      whatsapp: parsed.data.whatsapp?.trim() || null,
    },
  });

  revalidatePath("/dashboard");

  redirect("/partner/onboarding");
}

export async function completePartnerFirstRunOnboardingAction() {
  const viewer = await requireCompletedViewer();

  if (viewer.role !== "GETTER") {
    redirect("/dashboard");
  }

  const profile = await prisma.localPartnerProfile.findUnique({
    where: { userId: viewer.id },
    select: { completedAt: true, partnerOnboardingCompletedAt: true },
  });

  if (!profile?.completedAt) {
    redirect("/onboarding/partner");
  }

  if (!profile.partnerOnboardingCompletedAt) {
    await prisma.localPartnerProfile.update({
      where: { userId: viewer.id },
      data: { partnerOnboardingCompletedAt: new Date() },
    });
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function startPartnerPayoutSetupAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const returnTo = getSafeInternalRedirect(getStringValue(formData.get("returnTo")));

  if (viewer.role !== "GETTER") {
    redirect("/dashboard");
  }

  const profile = await prisma.localPartnerProfile.findUnique({
    where: {
      userId: viewer.id,
    },
    select: {
      completedAt: true,
    },
  });

  if (!profile?.completedAt) {
    redirect("/onboarding/partner");
  }

  const searchParams = new URLSearchParams({
    returnTo: returnTo ?? "/dashboard",
  });
  redirect(`/onboarding/partner?${searchParams.toString()}`);
}

export async function savePartnerPayoutMethodAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();
  const methodValue = getStringValue(formData.get("method")).trim().toUpperCase();
  const returnTo =
    getSafeInternalRedirect(getStringValue(formData.get("returnTo"))) || "/dashboard";

  if (viewer.role !== "GETTER") redirect("/dashboard");
  if (!isPayoutMethod(methodValue) || methodValue === "STRIPE") {
    return { error: locale === "it" ? "Metodo di pagamento non valido." : "Invalid payout method." };
  }

  const profile = await prisma.localPartnerProfile.findUnique({
    where: { userId: viewer.id },
    select: { completedAt: true, partnerOnboardingCompletedAt: true },
  });
  if (!profile?.completedAt) redirect("/onboarding/partner");
  if (!profile.partnerOnboardingCompletedAt) redirect("/partner/onboarding");

  if (methodValue === "PAYPAL") {
    const email = normalizeEmail(getStringValue(formData.get("paypalEmail")));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return {
        error: locale === "it" ? "Inserisci un'email PayPal valida." : "Enter a valid PayPal email.",
        fieldErrors: { paypalEmail: locale === "it" ? "Email non valida." : "Invalid email." },
      };
    }
    await prisma.localPartnerProfile.update({
      where: { userId: viewer.id },
      data: {
        bankPayoutAccountHolder: null,
        bankPayoutIbanEncrypted: null,
        bankPayoutAccountLast4: null,
        payoutMethodUpdatedAt: new Date(),
        payoutSetupStatus: "READY",
        paypalPayoutEmail: email,
        preferredPayoutMethod: "PAYPAL",
      },
    });
  } else {
    const accountHolder = getStringValue(formData.get("accountHolder")).trim().replace(/\s+/g, " ");
    const iban = normalizeIban(getStringValue(formData.get("iban")));
    if (accountHolder.length < 3 || !isValidItalianIban(iban)) {
      return {
        error: locale === "it" ? "Controlla intestatario e IBAN italiano." : "Check the account holder and Italian IBAN.",
        fieldErrors: {
          ...(accountHolder.length < 3 ? { accountHolder: locale === "it" ? "Inserisci l'intestatario." : "Enter the account holder." } : {}),
          ...(!isValidItalianIban(iban) ? { iban: locale === "it" ? "Inserisci un IBAN italiano valido." : "Enter a valid Italian IBAN." } : {}),
        },
      };
    }
    let encryptedIban: string;
    try {
      encryptedIban = encryptPayoutDestination(iban);
    } catch {
      return {
        error:
          locale === "it"
            ? "La configurazione sicura dei pagamenti non è ancora disponibile. Riprova più tardi."
            : "Secure payout setup is not available yet. Please try again later.",
      };
    }
    await prisma.localPartnerProfile.update({
      where: { userId: viewer.id },
      data: {
        bankPayoutAccountHolder: accountHolder,
        bankPayoutIbanEncrypted: encryptedIban,
        bankPayoutAccountLast4: iban.slice(-4),
        payoutMethodUpdatedAt: new Date(),
        payoutSetupStatus: "READY",
        paypalPayoutEmail: null,
        preferredPayoutMethod: methodValue,
      },
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/earnings");
  redirect(returnTo);
}

export async function requestBusinessClaimAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();

  if (viewer.role !== "BUSINESS_OWNER") {
    redirect("/login");
  }

  const requiresBusinessLegalAcceptance = !(await hasAcceptedCurrentLegalDocuments({
    audience: "business",
    userId: viewer.id,
  }));

  const parsed = businessClaimRequestSchema.safeParse({
    businessId: getStringValue(formData.get("businessId")),
  });

  if (!parsed.success) {
    const invalidFields = parsed.error.issues.map((issue) =>
      String(issue.path[0] ?? "form"),
    );

    return {
      error: formCopy[locale].invalidForm,
      fieldErrors: buildFieldErrors(invalidFields, locale),
    };
  }

  if (requiresBusinessLegalAcceptance && getStringValue(formData.get("businessTermsAccepted")) !== "on") {
    return {
      error: formCopy[locale].missingBusinessTerms,
      fieldErrors: { businessTermsAccepted: formCopy[locale].missingBusinessTerms },
    };
  }

  const business = await prisma.business.findUnique({
    where: {
      id: parsed.data.businessId,
    },
    select: {
      id: true,
      ownerAccesses: { select: { userId: true } },
      ownerUserId: true,
      slug: true,
      submissions: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          ownerEmail: true,
          ownerHasNoEmail: true,
        },
      },
    },
  });

  if (!business) {
    return {
      error: formCopy[locale].unknownTown,
    };
  }

  if (isBusinessAlreadyManaged({
    ownerAccessUserIds: business.ownerAccesses.map((access) => access.userId),
    ownerUserId: business.ownerUserId,
  })) {
    return {
      error: locale === "it"
        ? "Questa attività è già gestita su Salento Local."
        : "This business is already managed on Salento Local.",
    };
  }

  const verificationEmail = getBusinessClaimVerificationEmail({
    ownerEmail: business.submissions[0]?.ownerEmail,
    ownerHasNoEmail: business.submissions[0]?.ownerHasNoEmail ?? true,
  });

  if (!verificationEmail) {
    return {
      error: locale === "it"
        ? "Questa attività non può ancora essere rivendicata online perché non è disponibile un'email registrata per la verifica."
        : "This business can't be claimed online yet because no registered verification email is available.",
    };
  }

  const reusableClaim = await prisma.businessClaim.findFirst({
    where: {
      businessId: business.id,
      status: "AWAITING_VERIFICATION",
      userId: viewer.id,
      verificationChannel: "EMAIL",
      verificationCodeExpiresAt: { gt: new Date() },
      verificationCodeHash: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  if (reusableClaim) {
    redirect(`/claim/verify?claim=${encodeURIComponent(reusableClaim.id)}`);
  }

  await prisma.businessClaim.updateMany({
    where: {
      businessId: business.id,
      status: "AWAITING_VERIFICATION",
      userId: viewer.id,
      verificationCodeExpiresAt: { lte: new Date() },
    },
    data: { status: "EXPIRED" },
  });

  const claimCreationLimit = await consumeSecurityRateLimit({
    clientAddress: "account",
    limit: 5,
    namespace: "business-claim-creation",
    subject: viewer.id,
    windowMs: 24 * 60 * 60 * 1000,
  });

  if (!claimCreationLimit.allowed) {
    return { error: formCopy[locale].invalidForm };
  }

  const claim = await prisma.businessClaim.create({
    data: {
      businessId: business.id,
      businessContactEmail: verificationEmail,
      claimantName: viewer.name?.trim() || viewer.username,
      claimantPosition: "OWNER",
      status: "REQUESTED",
      userId: viewer.id,
      verificationChannel: "EMAIL",
    },
  });

  if (requiresBusinessLegalAcceptance) {
    await recordCurrentLegalAcceptances({
      acceptanceContext: "BUSINESS_CLAIM",
      audience: "business",
      contextRef: claim.id,
      locale,
      userId: viewer.id,
    });
  }

  try {
    await issueBusinessClaimVerificationCode({
      claimId: claim.id,
      locale,
    });
  } catch (error) {
    console.error("[claim] failed to send verification code", error);
    await prisma.businessClaim.delete({
      where: {
        id: claim.id,
      },
    });

    return {
      error: resolveVerificationDeliveryErrorMessage(error, locale),
    };
  }

  redirect(`/claim/verify?claim=${encodeURIComponent(claim.id)}`);
}

export async function verifyBusinessClaimCodeAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();
  const claimId = getStringValue(formData.get("claimId")).trim();
  const parsed = verificationCodeSchema.safeParse({
    code: getStringValue(formData.get("code")),
  });

  if (!parsed.success) {
    return {
      error: formCopy[locale].verificationCodeInvalid,
    };
  }

  const claim = await prisma.businessClaim.findUnique({
    where: { id: claimId },
    include: {
      business: {
        select: {
          id: true,
          slug: true,
        },
      },
    },
  });

  if (!claim || claim.userId !== viewer.id) {
    return {
      error: formCopy[locale].notAllowed,
    };
  }

  if (claim.status !== "AWAITING_VERIFICATION" || claim.verificationChannel !== "EMAIL") {
    return {
      error: locale === "it"
        ? "Questa verifica non è più disponibile. Torna alla pagina dell'attività per ricominciare."
        : "This verification is no longer available. Return to the business page to start again.",
    };
  }

  if (!claim.verificationCodeHash || !claim.verificationCodeExpiresAt) {
    return {
      error: formCopy[locale].verificationCodeExpired,
    };
  }

  const verificationResult = evaluateClaimCodeAttempt({
    attempts: claim.verificationAttempts,
    code: parsed.data.code,
    expiresAt: claim.verificationCodeExpiresAt,
    hash: claim.verificationCodeHash,
  });

  if (verificationResult === "too_many_attempts") {
    return {
      error: formCopy[locale].verificationTooManyAttempts,
    };
  }

  if (verificationResult === "expired") {
    await prisma.businessClaim.update({
      where: { id: claim.id },
      data: {
        status: "EXPIRED",
      },
    });

    return {
      error: formCopy[locale].verificationCodeExpired,
    };
  }

  if (verificationResult === "invalid") {
    const attempted = await prisma.businessClaim.updateMany({
      where: {
        id: claim.id,
        status: "AWAITING_VERIFICATION",
        verificationAttempts: { lt: CLAIM_VERIFICATION_MAX_ATTEMPTS },
      },
      data: {
        verificationAttempts: {
          increment: 1,
        },
      },
    });

    if (!attempted.count) {
      return {
        error: formCopy[locale].verificationTooManyAttempts,
      };
    }

    return {
      error: formCopy[locale].verificationCodeInvalid,
    };
  }
  const approved = await prisma.$transaction(async (tx) => {
    const ownershipUpdate = await tx.business.updateMany({
      where: {
        id: claim.business.id,
        ownerUserId: null,
        ownerAccesses: { none: { userId: { not: null } } },
      },
      data: {
        email: normalizeEmail(claim.businessContactEmail ?? ""),
        ownerUserId: viewer.id,
        verificationStatus: "OWNER_VERIFIED",
      },
    });

    if (!ownershipUpdate.count) {
      await tx.businessClaim.updateMany({
        where: { id: claim.id, status: "AWAITING_VERIFICATION" },
        data: { status: "REJECTED" },
      });
      return false;
    }

    await tx.businessClaim.update({
      where: { id: claim.id },
      data: {
        reviewedAt: new Date(),
        status: "APPROVED",
        verificationCodeExpiresAt: null,
        verificationCodeHash: null,
        verificationSentTo: null,
        verifiedAt: new Date(),
      },
    });

    await tx.businessOwnerAccess.upsert({
      where: {
        businessId_email: {
          businessId: claim.business.id,
          email: normalizeEmail(claim.businessContactEmail ?? ""),
        },
      },
      create: {
        activatedAt: new Date(),
        businessId: claim.business.id,
        email: normalizeEmail(claim.businessContactEmail ?? ""),
        userId: viewer.id,
      },
      update: {
        activatedAt: new Date(),
        userId: viewer.id,
        verifiedAt: new Date(),
      },
    });
    return true;
  });

  if (!approved) {
    return {
      error: locale === "it"
        ? "Questa attività è stata collegata a un altro account mentre verificavi il codice."
        : "This business was connected to another account while you were verifying the code.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/businesses");
  revalidatePath(`/businesses/${claim.business.slug}`);
  if (shouldShowClaimEmailChoice(viewer.email, claim.businessContactEmail)) {
    redirect(`/claim/email?claim=${encodeURIComponent(claim.id)}`);
  }

  redirect(`/claim/success?business=${encodeURIComponent(claim.business.slug)}`);
}

export async function completeBusinessClaimEmailChoiceAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();
  const claimId = getStringValue(formData.get("claimId")).trim();
  const choice = getStringValue(formData.get("emailChoice"));

  if (choice !== "ACCOUNT" && choice !== "BUSINESS") {
    return { error: formCopy[locale].invalidForm };
  }

  const claim = await prisma.businessClaim.findUnique({
    where: { id: claimId },
    include: { business: { select: { id: true, ownerUserId: true, slug: true } } },
  });
  const currentUser = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { email: true, id: true },
  });

  if (
    !claim ||
    !currentUser?.email ||
    claim.userId !== viewer.id ||
    claim.status !== "APPROVED" ||
    claim.business.ownerUserId !== viewer.id ||
    !claim.businessContactEmail
  ) {
    return { error: formCopy[locale].notAllowed };
  }

  const accountEmail = normalizeEmail(currentUser.email);
  const businessEmail = normalizeEmail(claim.businessContactEmail);
  const selectedEmail = choice === "ACCOUNT" ? accountEmail : businessEmail;
  const emailOwner = await findUserByNormalizedEmail({ email: selectedEmail });

  if (emailOwner && emailOwner.id !== viewer.id) {
    return {
      error: locale === "it"
        ? "Questa email è già collegata a un altro account Salento Local. Continua con l'email del tuo account."
        : "That email is already connected to another Salento Local account. Please continue using your current account email.",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
    const currentAccess = await tx.businessOwnerAccess.findUnique({
      where: { businessId_userId: { businessId: claim.business.id, userId: viewer.id } },
    });
    const selectedAccess = await tx.businessOwnerAccess.findUnique({
      where: { businessId_email: { businessId: claim.business.id, email: selectedEmail } },
    });

    if (selectedAccess?.userId && selectedAccess.userId !== viewer.id) {
      throw new Error("claim_email_access_conflict");
    }

    if (selectedAccess && selectedAccess.id !== currentAccess?.id) {
      if (currentAccess) {
        await tx.businessOwnerAccess.update({
          where: { id: currentAccess.id },
          data: { userId: null },
        });
      }
      await tx.businessOwnerAccess.update({
        where: { id: selectedAccess.id },
        data: { activatedAt: new Date(), userId: viewer.id, verifiedAt: new Date() },
      });
    } else if (currentAccess) {
      await tx.businessOwnerAccess.update({
        where: { id: currentAccess.id },
        data: { email: selectedEmail, verifiedAt: new Date() },
      });
    } else {
      await tx.businessOwnerAccess.create({
        data: { activatedAt: new Date(), businessId: claim.business.id, email: selectedEmail, userId: viewer.id },
      });
    }

    await tx.business.update({
      where: { id: claim.business.id },
      data: { email: selectedEmail },
    });

    if (selectedEmail !== accountEmail) {
      await tx.user.update({ where: { id: viewer.id }, data: { email: selectedEmail } });
    }
    });
  } catch (error) {
    if (
      (error instanceof Error && error.message === "claim_email_access_conflict") ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    ) {
      return {
        error: locale === "it"
          ? "Questa email è già associata a un altro accesso per questa attività."
          : "That email is already associated with another access record for this business.",
      };
    }
    throw error;
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/businesses");
  revalidatePath(`/businesses/${claim.business.slug}`);
  redirect(`/claim/success?business=${encodeURIComponent(claim.business.slug)}`);
}

export async function resendBusinessClaimCodeAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();
  const claimId = getStringValue(formData.get("claimId")).trim();

  const claim = await prisma.businessClaim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      resendAvailableAt: true,
      resendCount: true,
      status: true,
      userId: true,
      verificationChannel: true,
    },
  });

  if (!claim || claim.userId !== viewer.id) {
    return {
      error: formCopy[locale].notAllowed,
    };
  }

  if (claim.verificationChannel !== "EMAIL" || claim.status !== "AWAITING_VERIFICATION") {
    return {
      error: locale === "it"
        ? "Questa verifica non è più disponibile."
        : "This verification is no longer available.",
    };
  }

  const resendStatus = evaluateClaimResend({
    resendAvailableAt: claim.resendAvailableAt,
    resendCount: Math.max(0, claim.resendCount - 1),
  });

  if (resendStatus === "cooldown") {
    return {
      error: formCopy[locale].verificationResendRateLimited,
    };
  }

  if (resendStatus === "limit_reached") {
    return {
      error: formCopy[locale].verificationResendLimit,
    };
  }

  try {
    const recipient = await issueBusinessClaimVerificationCode({
      claimId,
      locale,
      resend: true,
    });

    if (!recipient) {
      return {
        error: formCopy[locale].verificationResendRateLimited,
      };
    }
  } catch (error) {
    console.error("[claim] failed to resend verification code", error);
    return {
      error: resolveVerificationDeliveryErrorMessage(error, locale),
    };
  }

  return { notice: formCopy[locale].verificationSentByEmail };
}

export async function updateOwnedBusinessProfileAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();
  const parsed = ownedBusinessProfileSchema.safeParse({
    address: getStringValue(formData.get("address")),
    businessId: getStringValue(formData.get("businessId")),
    businessName: getStringValue(formData.get("businessName")),
    description: getStringValue(formData.get("description")),
    email: getStringValue(formData.get("email")),
    openingHoursText: getStringValue(formData.get("openingHoursText")),
    ownerEmail: getStringValue(formData.get("ownerEmail")),
    ownerName: getStringValue(formData.get("ownerName")),
    ownerPhone: getStringValue(formData.get("ownerPhone")),
    phone: getStringValue(formData.get("phone")),
    shortDescription: getStringValue(formData.get("shortDescription")),
    website: getStringValue(formData.get("website")),
  });

  if (!parsed.success) {
    const invalidFields = parsed.error.issues.map((issue) =>
      String(issue.path[0] ?? "form"),
    );

    return {
      error: formCopy[locale].invalidForm,
      fieldErrors: buildSubmissionFieldErrors(invalidFields, locale),
    };
  }

  const business = await prisma.business.findUnique({
    where: {
      id: parsed.data.businessId,
    },
    select: {
      id: true,
      ownerUserId: true,
      slug: true,
      town: {
        select: {
          slug: true,
        },
      },
    },
  });

  if (!business) {
    return {
      error: formCopy[locale].unknownTown,
    };
  }

  if (
    viewer.role !== "ADMIN" &&
    !(await canManageBusiness({ businessId: business.id, userId: viewer.id }))
  ) {
    return {
      error: formCopy[locale].notAllowed,
    };
  }

  const normalizedOwnerPhone = parsed.data.ownerPhone.trim();
  const normalizedPublicPhone = parsed.data.phone?.trim() || normalizedOwnerPhone;
  const normalizedPublicEmail = parsed.data.email ?? parsed.data.ownerEmail ?? "";

  await prisma.$transaction(async (tx) => {
    await tx.business.update({
      where: {
        id: business.id,
      },
      data: {
        address: parsed.data.address,
        description: parsed.data.description,
        email: normalizedPublicEmail || null,
        openingHoursText: parsed.data.openingHoursText?.trim() || null,
        phone: normalizedPublicPhone || null,
        shortDescription: parsed.data.shortDescription,
        website: parsed.data.website || null,
        name: parsed.data.businessName,
      },
    });

    const latestSubmission = await tx.businessSubmission.findFirst({
      where: {
        createdBusinessId: business.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
      },
    });

    if (latestSubmission) {
      await tx.businessSubmission.update({
        where: {
          id: latestSubmission.id,
        },
        data: {
          address: parsed.data.address,
          businessName: parsed.data.businessName,
          email: normalizedPublicEmail,
          longDescription: parsed.data.description,
          openingHours: parsed.data.openingHoursText?.trim() || "",
          ownerEmail: parsed.data.ownerEmail ?? "",
          ownerHasNoEmail: !parsed.data.ownerEmail,
          ownerName: parsed.data.ownerName,
          ownerPhone: normalizedOwnerPhone,
          phone: normalizedPublicPhone,
          shortDescription: parsed.data.shortDescription,
          website: parsed.data.website || "",
          whatsapp: normalizedPublicPhone,
        },
      });
    }
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/businesses");
  revalidatePath(`/businesses/${business.slug}`);
  revalidatePath(`/towns/${business.town.slug}`);
  redirect(`/businesses/${business.slug}`);
}

/**
 * Updates an already-published listing from the shared owner wizard. This is
 * intentionally separate from the submission action: an owner edit must never
 * create a submission or revisit payment, commission, or legal-acceptance
 * state.
 */
export async function updateOwnedBusinessWithWizardAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();
  const businessId = getStringValue(formData.get("businessId")).trim();

  if (viewer.role !== "BUSINESS_OWNER" || !businessId) {
    return { error: formCopy[locale].notAllowed };
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      addressCountry: true,
      addressCountryCode: true,
      addressLocality: true,
      addressPlaceId: true,
      addressPostalCode: true,
      addressProvince: true,
      addressRegion: true,
      addressRoute: true,
      addressStreetNumber: true,
      id: true,
      latitude: true,
      longitude: true,
      mapsUrl: true,
      claims: {
        where: { status: "APPROVED" },
        select: { id: true },
        take: 1,
      },
      slug: true,
      socialLinks: true,
      town: { select: { slug: true } },
    },
  });

  if (!business || !(await canManageBusiness({ businessId, userId: viewer.id }))) {
    return { error: formCopy[locale].notAllowed };
  }
  const hasApprovedClaim = business.claims.length > 0;

  const rawSubmission: SubmissionFormValues = {
    address: getStringValue(formData.get("address")),
    addressCountry: getStringValue(formData.get("addressCountry")),
    addressCountryCode: getStringValue(formData.get("addressCountryCode")),
    addressLatitude: getStringValue(formData.get("addressLatitude")),
    addressLocality: getStringValue(formData.get("addressLocality")),
    addressLongitude: getStringValue(formData.get("addressLongitude")),
    addressPlaceId: getStringValue(formData.get("addressPlaceId")),
    addressPostalCode: getStringValue(formData.get("addressPostalCode")),
    addressProvince: getStringValue(formData.get("addressProvince")),
    addressRegion: getStringValue(formData.get("addressRegion")),
    addressRoute: getStringValue(formData.get("addressRoute")),
    addressStreetNumber: getStringValue(formData.get("addressStreetNumber")),
    agreementAccepted: false,
    agreementSignature: getStringValue(formData.get("agreementSignature")),
    businessSummary: getStringValue(formData.get("businessSummary")),
    businessName: getStringValue(formData.get("businessName")),
    categoryId: getStringValue(formData.get("categoryId")),
    email: getStringValue(formData.get("email")),
    facebook: getStringValue(formData.get("facebook")),
    googleMapsUrl: getStringValue(formData.get("googleMapsUrl")),
    id: getStringValue(formData.get("submissionId")) || undefined,
    instagram: getStringValue(formData.get("instagram")),
    longDescription: getStringValue(formData.get("longDescription")),
    openingHours: getStringValue(formData.get("openingHours")),
    ownerEmail: getStringValue(formData.get("ownerEmail")),
    ownerHasNoEmail: getStringValue(formData.get("ownerHasNoEmail")) === "on",
    ownerName: getStringValue(formData.get("ownerName")),
    ownerPhone: getStringValue(formData.get("ownerPhone")),
    paymentMethod: getStringValue(formData.get("paymentMethod")) || undefined,
    phone: getStringValue(formData.get("phone")),
    photoUrls: getStringValue(formData.get("photoUrls")),
    shortDescription: getStringValue(formData.get("shortDescription")),
    signerFullName: getStringValue(formData.get("signerFullName")),
    signerRole: getStringValue(formData.get("signerRole")),
    signerRoleOther: getStringValue(formData.get("signerRoleOther")),
    townId: getStringValue(formData.get("townId")),
    website: getStringValue(formData.get("website")),
    whatsapp: getStringValue(formData.get("whatsapp")),
  };
  const parsed = businessSubmissionDraftSchema.safeParse({
    ...rawSubmission,
    signerRole: rawSubmission.signerRole || undefined,
  });

  if (!parsed.success) {
    const invalidFields = parsed.error.issues.map((issue) => String(issue.path[0] ?? "form"));

    return {
      error: formCopy[locale].invalidForm,
      fieldErrors: buildSubmissionFieldErrors(invalidFields, locale),
      invalidFields,
      submission: rawSubmission,
    };
  }

  const [town, category] = await Promise.all([
    prisma.town.findUnique({ where: { id: parsed.data.townId }, select: { id: true } }),
    prisma.category.findUnique({ where: { id: parsed.data.categoryId }, select: { id: true } }),
  ]);

  if (!town || !category) {
    return {
      error: formCopy[locale].unknownTown,
      fieldErrors: { categoryId: formCopy[locale].unknownTown, townId: formCopy[locale].unknownTown },
      invalidFields: ["categoryId", "townId"],
      submission: rawSubmission,
    };
  }

  const selectedAddress = buildSelectedAddressFromStoredFields({
    address: parsed.data.address,
    addressCountry: parsed.data.addressCountry,
    addressCountryCode: parsed.data.addressCountryCode,
    addressLatitude: parsed.data.addressLatitude,
    addressLocality: parsed.data.addressLocality,
    addressLongitude: parsed.data.addressLongitude,
    addressPlaceId: parsed.data.addressPlaceId,
    addressPostalCode: parsed.data.addressPostalCode,
    addressProvince: parsed.data.addressProvince,
    addressRegion: parsed.data.addressRegion,
    addressRoute: parsed.data.addressRoute,
    addressStreetNumber: parsed.data.addressStreetNumber,
  });
  const selectedAddressStorage = selectedAddress
    ? buildAddressSelectionStorage(selectedAddress)
    : {
        addressCountry: business.addressCountry,
        addressCountryCode: business.addressCountryCode,
        addressLatitude: business.latitude,
        addressLocality: business.addressLocality,
        addressLongitude: business.longitude,
        addressPlaceId: business.addressPlaceId,
        addressPostalCode: business.addressPostalCode,
        addressProvince: business.addressProvince,
        addressRegion: business.addressRegion,
        addressRoute: business.addressRoute,
        addressStreetNumber: business.addressStreetNumber,
      };
  const preservedPhotoUrls = getStringValue(formData.get("preservedPhotoUrls"))
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const submittedPhotoUrls = mergeBusinessPhotoUrls(
    parsed.data.photoUrls ?? [],
    preservedPhotoUrls,
  );
  let savedPhotoUrls = submittedPhotoUrls;
  const currentSocialLinks =
    business.socialLinks && typeof business.socialLinks === "object" && !Array.isArray(business.socialLinks)
      ? { ...business.socialLinks }
      : {};
  const facebook = normalizeFacebookUrl(parsed.data.facebook);
  const instagram = normalizeInstagramUrl(parsed.data.instagram);

  if (facebook) currentSocialLinks.facebook = facebook;
  else delete currentSocialLinks.facebook;
  if (instagram) currentSocialLinks.instagram = instagram;
  else delete currentSocialLinks.instagram;

  const mapsUrl = selectedAddress
    ? buildGoogleMapsSearchUrl(selectedAddress)
    : (parsed.data.googleMapsUrl ?? "").trim() || business.mapsUrl;

  await prisma.$transaction(async (tx) => {
    const existingImages = await tx.businessImage.findMany({
      where: { businessId: business.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, url: true },
    });
    // A save from an earlier edit step must not erase an established gallery
    // when photo fields are absent. The Photos step sends a non-empty list for
    // a real replacement or removal.
    const photoUrls = submittedPhotoUrls.length
      ? submittedPhotoUrls
      : existingImages.map((image) => image.url);
    savedPhotoUrls = photoUrls;
    const existingImagesByUrl = new Map<string, Array<{ id: string }>>();

    for (const image of existingImages) {
      const matches = existingImagesByUrl.get(image.url) ?? [];
      matches.push({ id: image.id });
      existingImagesByUrl.set(image.url, matches);
    }

    const imageUpdates = photoUrls.map((url, index) => ({
      existingImage: existingImagesByUrl.get(url)?.shift(),
      index,
      url,
    }));
    const imageIdsToDelete = [...existingImagesByUrl.values()].flat().map((image) => image.id);

    await tx.business.update({
      where: { id: business.id },
      data: {
        address: parsed.data.address,
        addressCountry: selectedAddressStorage.addressCountry,
        addressCountryCode: selectedAddressStorage.addressCountryCode,
        addressLocality: selectedAddressStorage.addressLocality,
        addressPlaceId: selectedAddressStorage.addressPlaceId,
        addressPostalCode: selectedAddressStorage.addressPostalCode,
        addressProvince: selectedAddressStorage.addressProvince,
        addressRegion: selectedAddressStorage.addressRegion,
        addressRoute: selectedAddressStorage.addressRoute,
        addressStreetNumber: selectedAddressStorage.addressStreetNumber,
        categoryId: category.id,
        description: buildBusinessDescription(parsed.data.shortDescription, parsed.data.longDescription),
        email: (parsed.data.email ?? "").trim() || null,
        latitude: selectedAddressStorage.addressLatitude ?? business.latitude,
        longitude: selectedAddressStorage.addressLongitude ?? business.longitude,
        mapsUrl: mapsUrl || null,
        name: parsed.data.businessName,
        openingHoursText: buildOpeningHoursSummary(parsed.data.openingHours, locale),
        phone: parsed.data.phone.trim() || null,
        shortDescription: parsed.data.shortDescription,
        socialLinks: Object.keys(currentSocialLinks).length ? currentSocialLinks : Prisma.JsonNull,
        townId: town.id,
        website: parsed.data.website?.trim() || null,
      },
    });

    if (imageIdsToDelete.length) {
      await tx.businessImage.deleteMany({ where: { id: { in: imageIdsToDelete } } });
    }

    await Promise.all(
      imageUpdates.map(({ existingImage, index, url }) =>
        existingImage
          ? tx.businessImage.update({
              where: { id: existingImage.id },
              data: {
                alt: `${parsed.data.businessName} photo ${index + 1}`,
                sortOrder: index,
              },
            })
          : tx.businessImage.create({
              data: {
                alt: `${parsed.data.businessName} photo ${index + 1}`,
                businessId: business.id,
                sortOrder: index,
                url,
              },
            }),
      ),
    );

    const latestSubmission = await tx.businessSubmission.findFirst({
      where: { createdBusinessId: business.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (latestSubmission) {
      await tx.businessSubmission.update({
        where: { id: latestSubmission.id },
        data: {
          address: parsed.data.address,
          addressCountry: selectedAddressStorage.addressCountry,
          addressCountryCode: selectedAddressStorage.addressCountryCode,
          addressLatitude: selectedAddressStorage.addressLatitude,
          addressLocality: selectedAddressStorage.addressLocality,
          addressLongitude: selectedAddressStorage.addressLongitude,
          addressPlaceId: selectedAddressStorage.addressPlaceId,
          addressPostalCode: selectedAddressStorage.addressPostalCode,
          addressProvince: selectedAddressStorage.addressProvince,
          addressRegion: selectedAddressStorage.addressRegion,
          addressRoute: selectedAddressStorage.addressRoute,
          addressStreetNumber: selectedAddressStorage.addressStreetNumber,
          businessName: parsed.data.businessName,
          categoryId: category.id,
          email: parsed.data.email,
          facebook: normalizeSubmissionSocialValue(parsed.data.facebook),
          googleMapsUrl: mapsUrl || "",
          instagram: normalizeSubmissionSocialValue(parsed.data.instagram),
          longDescription: parsed.data.longDescription,
          openingHours: parsed.data.openingHours,
          ...(hasApprovedClaim
            ? {}
            : {
                ownerEmail: parsed.data.ownerEmail,
                ownerHasNoEmail: parsed.data.ownerHasNoEmail,
                ownerName: parsed.data.ownerName,
                ownerPhone: parsed.data.ownerPhone,
              }),
          phone: parsed.data.phone,
          photoUrls: photoUrls.length ? photoUrls : Prisma.JsonNull,
          shortDescription: parsed.data.shortDescription,
          townId: town.id,
          website: parsed.data.website,
          whatsapp: parsed.data.whatsapp,
        },
      });
    }
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/businesses");
  revalidatePath("/directory");
  revalidatePath("/explore");
  revalidatePath(`/businesses/${business.slug}`);
  revalidatePath(`/towns/${business.town.slug}`);

  return {
    notice: locale === "it" ? "Modifiche salvate." : "Changes saved.",
    submission: {
      ...rawSubmission,
      photoUrls: savedPhotoUrls.join("\n"),
    },
  };
}

export async function verifyBusinessSubmissionCodeAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();
  const submissionId = getStringValue(formData.get("submissionId")).trim();
  const parsed = verificationCodeSchema.safeParse({
    code: getStringValue(formData.get("code")),
  });

  if (!parsed.success) {
    return {
      error: formCopy[locale].verificationCodeInvalid,
    };
  }

  const submission = await prisma.businessSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      paymentMethod: true,
      userId: true,
      verificationAttempts: true,
      verificationCodeExpiresAt: true,
      verificationCodeHash: true,
    },
  });

  if (!submission || submission.userId !== viewer.id) {
    return {
      error: formCopy[locale].notAllowed,
    };
  }

  if (!submission.verificationCodeHash || !submission.verificationCodeExpiresAt) {
    return {
      error: formCopy[locale].verificationCodeExpired,
    };
  }

  if (submission.verificationAttempts >= 5) {
    return {
      error: formCopy[locale].verificationTooManyAttempts,
    };
  }

  if (submission.verificationCodeExpiresAt.getTime() < Date.now()) {
    await prisma.businessSubmission.update({
      where: { id: submission.id },
      data: {
        status: "REJECTED",
      },
    });

    return {
      error: formCopy[locale].verificationCodeExpired,
    };
  }

  if (!isVerificationCodeValid(parsed.data.code, submission.verificationCodeHash)) {
    await prisma.businessSubmission.update({
      where: { id: submission.id },
      data: {
        verificationAttempts: {
          increment: 1,
        },
      },
    });

    return {
      error: formCopy[locale].verificationCodeInvalid,
    };
  }

  await prisma.businessSubmission.update({
    where: { id: submission.id },
    data: {
      paymentStatus: submission.paymentMethod
        ? buildPaymentStatusForMethod(submission.paymentMethod)
        : "NOT_REQUIRED",
      status: submission.paymentMethod ? getStatusAfterSubmit() : "DRAFT",
      verificationVerifiedAt: new Date(),
    },
  });

  revalidatePath("/dashboard");
  redirect(
    submission.paymentMethod
      ? `/publish/payment?submission=${encodeURIComponent(submission.id)}`
      : `/publish?submission=${encodeURIComponent(submission.id)}`,
  );
}

export async function resendBusinessSubmissionCodeAction(formData: FormData) {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireCompletedViewer();
  const submissionId = getStringValue(formData.get("submissionId")).trim();

  const submission = await prisma.businessSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      userId: true,
      verificationLastSentAt: true,
    },
  });

  if (!submission || submission.userId !== viewer.id) {
    redirect("/dashboard");
  }

  if (
    submission.verificationLastSentAt &&
    submission.verificationLastSentAt.getTime() > Date.now() - 2 * 60 * 1000
  ) {
    redirect(`/publish/verify?submission=${encodeURIComponent(submissionId)}`);
  }

  await issueSubmissionVerificationCode({
    locale,
    submissionId,
  });

  redirect(`/publish/verify?submission=${encodeURIComponent(submissionId)}`);
}

export async function confirmBankTransferReceivedAction(formData: FormData) {
  await requireAdminViewer();
  const submissionId = getStringValue(formData.get("submissionId")).trim();
  const returnPath =
    getSafeInternalRedirect(getStringValue(formData.get("returnPath")).trim()) ||
    "/dashboard/businesses?scope=all";

  if (!submissionId) {
    redirect(returnPath);
  }

  const submission = await prisma.businessSubmission.findUnique({
    where: { id: submissionId },
    select: {
      amountOwedCents: true,
      bankTransferReference: true,
      createdBusinessId: true,
      id: true,
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      user: {
        select: {
          id: true,
          role: true,
        },
      },
      userId: true,
    },
  });

  if (!submission || submission.paymentMethod !== "BANK_TRANSFER") {
    redirect(returnPath);
  }

  const reference = submission.bankTransferReference || getBankTransferReference(submission.id);
  let publishedBusinessSlug = "";
  let publishedTownSlug = "";
  const confirmedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const latestPayment = await tx.payment.findFirst({
      where: {
        businessSubmissionId: submission.id,
        method: "BANK_TRANSFER",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
      },
    });

    if (latestPayment) {
      await tx.payment.update({
        where: {
          id: latestPayment.id,
        },
        data: {
          bankTransferReference: reference,
          businessId: submission.createdBusinessId,
          paidAt: confirmedAt,
          status: "PAID",
        },
      });
    } else {
      await tx.payment.create({
        data: {
          amountCents: submission.amountOwedCents,
          bankTransferReference: reference,
          businessId: submission.createdBusinessId,
          businessSubmissionId: submission.id,
          method: "BANK_TRANSFER",
          paidAt: confirmedAt,
          partnerUserId: getPartnerUserIdForSubmission(submission.user),
          status: "PAID",
          userId: submission.userId,
        },
      });
    }

    await tx.businessSubmission.update({
      where: {
        id: submission.id,
      },
      data: {
        amountPaidCents: submission.amountOwedCents,
        bankTransferReference: reference,
        paymentStatus: "PAID",
        status: getStatusAfterPayment(),
      },
    });

    const publishedBusiness = await publishSubmissionAfterPayment({
      db: tx,
      submissionId: submission.id,
    });

    publishedBusinessSlug = publishedBusiness?.slug ?? "";
    publishedTownSlug = publishedBusiness?.town.slug ?? "";
    if (publishedBusiness) {
      await ensureInitialBusinessMembership({
        businessId: publishedBusiness.id,
        db: tx,
        paidAt: confirmedAt,
        submissionId: submission.id,
      });
    }
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/businesses");
  revalidatePath("/directory");
  revalidatePath("/explore");
  await ensurePendingPartnerCommissionForSubmission({
    businessSubmissionId: submission.id,
  });
  if (publishedBusinessSlug) {
    revalidatePath(`/businesses/${publishedBusinessSlug}`);
  }
  if (publishedTownSlug) {
    revalidatePath(`/towns/${publishedTownSlug}`);
  }
  redirect(returnPath);
}

export async function markPartnerCommissionPaidAction(formData: FormData) {
  await requireAdminViewer();
  const returnPath =
    getSafeInternalRedirect(getStringValue(formData.get("returnPath")).trim()) ||
    "/dashboard/earnings";

  try {
    const result = await runWeeklyPartnerPayouts({ force: true });
    const nextUrl = new URL(returnPath, "http://localhost");
    nextUrl.searchParams.set("payoutRun", result.runKey);
    nextUrl.searchParams.set("payoutStatus", result.status);
    redirect(`${nextUrl.pathname}${nextUrl.search}`);
  } catch (error) {
    console.error("[partner-payout:manual-run]", error);
    const nextUrl = new URL(returnPath, "http://localhost");
    nextUrl.searchParams.set("payoutStatus", "failed");
    redirect(`${nextUrl.pathname}${nextUrl.search}`);
  }
}

export async function runPartnerPayoutNowAction(
  _previousState: PartnerPayoutActionState,
  formData: FormData,
): Promise<PartnerPayoutActionState> {
  await requireAdminViewer();
  const locale = getLocaleFromForm(formData);

  try {
    const result = await runWeeklyPartnerPayouts({ force: true });
    const partnerSummaries =
      "partnerSummaries" in result ? (result.partnerSummaries ?? []) : [];
    const sentAmountCents = partnerSummaries.reduce(
      (sum, item) => sum + item.totalPaidCents,
      0,
    );

    if (result.status === "failed") {
      return {
        failedPartners: result.failedPartners ?? 0,
        message:
          locale === "it"
            ? "Nessun pagamento e partito. Controlla i partner che richiedono attenzione e riprova."
            : "No payouts were started. Review the partners that need attention and try again.",
        processedPartners: result.processedPartners ?? 0,
        sentAmountCents,
        status: "failed",
      };
    }

    if (result.status === "partial") {
      return {
        failedPartners: result.failedPartners ?? 0,
        message:
          locale === "it"
            ? `Pagamenti avviati per ${result.processedPartners} partner. ${result.failedPartners} partner richiedono ancora attenzione.`
            : `Payouts started for ${result.processedPartners} partners. ${result.failedPartners} partners still need attention.`,
        processedPartners: result.processedPartners ?? 0,
        sentAmountCents,
        status: "partial",
      };
    }

    if ((result.processedPartners ?? 0) === 0) {
      return {
        failedPartners: result.failedPartners ?? 0,
        message:
          locale === "it"
            ? "Non c'erano partner pronti da pagare in questo momento."
            : "There were no partners ready to pay right now.",
        processedPartners: result.processedPartners ?? 0,
        sentAmountCents,
        status: "success",
      };
    }

    return {
      failedPartners: result.failedPartners ?? 0,
      message:
        locale === "it"
          ? `Pagamenti avviati con successo per ${result.processedPartners} partner.`
          : `Payouts started successfully for ${result.processedPartners} partners.`,
      processedPartners: result.processedPartners ?? 0,
      sentAmountCents,
      status: "success",
    };
  } catch (error) {
    console.error("[partner-payout:manual-run:action-state]", error);

    return {
      message:
        locale === "it"
          ? "Il pagamento dei partner non e partito. Riprova tra un momento."
          : "The partner payout did not start. Please try again in a moment.",
      status: "error",
    };
  }
}

export async function publishSubmissionAction(formData: FormData) {
  await requireAdminViewer();
  const locale = getLocaleFromForm(formData);
  const submissionId = getStringValue(formData.get("submissionId")).trim();
  const returnPath =
    getStringValue(formData.get("returnPath")).trim() || "/dashboard/businesses?scope=all";

  if (!submissionId) {
    redirect(returnPath);
  }

  const submission = await prisma.businessSubmission.findUnique({
    where: { id: submissionId },
    select: {
      address: true,
      businessName: true,
      categoryId: true,
      createdBusinessId: true,
      email: true,
      facebook: true,
      googleMapsUrl: true,
      id: true,
      instagram: true,
      longDescription: true,
      openingHours: true,
      paymentStatus: true,
      phone: true,
      photoUrls: true,
      shortDescription: true,
      status: true,
      town: {
        select: {
          id: true,
          latitude: true,
          longitude: true,
          name: true,
          slug: true,
        },
      },
      townId: true,
      user: {
        select: {
          id: true,
          role: true,
        },
      },
      website: true,
    },
  });

  if (!submission) {
    redirect(returnPath);
  }

  if (!canPublishSubmission(submission.paymentStatus)) {
    redirect(appendReturnPathNotice(returnPath, "warning", "payment-required"));
  }

  const business = await publishSubmissionAfterPayment({
    locale,
    submissionId: submission.id,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/businesses");
  revalidatePath("/directory");
  revalidatePath("/explore");
  if (business) {
    revalidatePath(`/businesses/${business.slug}`);
    revalidatePath(`/towns/${business.town.slug}`);
  }

  redirect(returnPath);
}

export async function grantAdminRoleAction(formData: FormData) {
  await requireAdminViewer();
  const username = normalizeAdminUsername(getStringValue(formData.get("username")));

  if (!username) {
    redirect(buildAdminRedirect("missing-username"));
  }

  const user = await prisma.user.findUnique({
    where: {
      username,
    },
    select: {
      id: true,
      role: true,
      username: true,
    },
  });

  if (!user) {
    redirect(buildAdminRedirect("user-not-found"));
  }

  if (user.role !== "ADMIN") {
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        role: "ADMIN",
        sessionVersion: { increment: 1 },
      },
    });
  }

  revalidatePath("/settings");

  redirect(buildAdminRedirect(`added:${user.username}`));
}

export async function removeAdminRoleAction(formData: FormData) {
  await requireAdminViewer();
  const username = normalizeAdminUsername(getStringValue(formData.get("username")));

  if (!username) {
    redirect(buildAdminRedirect("missing-username"));
  }

  if (isPrimaryAdminUsername(username)) {
    redirect(buildAdminRedirect("primary-locked"));
  }

  const user = await prisma.user.findUnique({
    where: {
      username,
    },
    select: {
      id: true,
      username: true,
    },
  });

  if (!user) {
    redirect(buildAdminRedirect("user-not-found"));
  }

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      role: "USER",
      sessionVersion: { increment: 1 },
    },
  });

  revalidatePath("/settings");

  redirect(buildAdminRedirect(`removed:${user.username}`));
}

export async function deleteBusinessAction(formData: FormData) {
  await requireAdminViewer();
  const businessId = getStringValue(formData.get("businessId")).trim();

  if (!businessId) {
    redirect("/dashboard/businesses?scope=all");
  }

  const business = await prisma.business.findUnique({
    where: {
      id: businessId,
    },
    select: {
      locality: {
        select: {
          slug: true,
        },
      },
      slug: true,
      town: {
        select: {
          slug: true,
        },
      },
    },
  });

  if (!business) {
    redirect("/dashboard/businesses?scope=all");
  }

  await prisma.$transaction(async (tx) => {
    await tx.businessSubmission.updateMany({
      where: {
        createdBusinessId: businessId,
      },
      data: {
        createdBusinessId: null,
        status: "REJECTED",
      },
    });

    await tx.business.delete({
      where: {
        id: businessId,
      },
    });
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/businesses");
  revalidatePath("/directory");
  revalidatePath("/explore");
  revalidatePath(`/businesses/${business.slug}`);
  revalidatePath(`/towns/${business.town.slug}`);

  if (business.locality?.slug) {
    revalidatePath(`/localities/${business.locality.slug}`);
  }

  redirect("/dashboard/businesses?scope=all");
}
