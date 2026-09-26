"use client";

import { useRouter } from "next/navigation";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import type { Category, PaymentMethod, Town } from "@prisma/client";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBuildingStore,
  IconCamera,
  IconCashBanknote,
  IconCheck,
  IconClock,
  IconCopy,
  IconCreditCard,
  IconDeviceFloppy,
  IconPhoto,
  IconPlus,
  IconQrcode,
  IconReceipt2,
  IconSignature,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import {
  startTransition,
  useActionState,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  saveBusinessSubmissionAction,
  updateOwnedBusinessWithWizardAction,
  type DuplicateBusinessMatch,
  type FormState,
  type SubmissionFormValues,
} from "@/app/(account)/actions";
import { usePaymentQrTransition } from "@/hooks/use-payment-qr-transition";
import { formatCurrencyFromCents } from "@/lib/account";
import { SignaturePad } from "@/components/account/signature-pad";
import { PaymentChoiceButton } from "@/components/account/payment-choice-button";
import { OwnerAgreementStep } from "@/components/account/owner-agreement-step";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { PhoneCountrySelector } from "@/components/phone-country-selector";
import {
  buildSelectedAddressFromStoredFields,
  buildStreetAddressLine,
  isValidSelectedAddress,
  type SelectedAddress,
} from "@/lib/address-selection";
import type { Locale } from "@/lib/i18n";
import { hasCredibleDuplicateMatches } from "@/lib/duplicate-business-matching";
import { getAudienceTermsLink, getLegalLinks } from "@/lib/legal";
import { LISTING_OFFER, LISTING_SIGNER_ROLE_VALUES } from "@/lib/listing-offer";
import type { PhoneCountryOption } from "@/lib/phone-country-options";
import { getCategoryLabel } from "@/lib/site";
import { normalizeSubmissionSocialInput } from "@/lib/business-links";
import { duplicateResponseMatchesSubmittedValues } from "@/lib/publish-flow";
import { requestPaymentQr } from "@/lib/payment-choice-client";
import { buildPhoneValue, getOwnerPhoneStepError, getOwnerStepError } from "@/lib/publish-owner-phone";
import {
  isPaymentApprovalReady,
  type PaymentQrMethod,
} from "@/lib/payment-qr-navigation";

const initialState: FormState = {};

const days = [
  { key: "monday", en: "Monday", it: "Lunedi", shortEn: "Mon", shortIt: "Lun" },
  { key: "tuesday", en: "Tuesday", it: "Martedi", shortEn: "Tue", shortIt: "Mar" },
  { key: "wednesday", en: "Wednesday", it: "Mercoledi", shortEn: "Wed", shortIt: "Mer" },
  { key: "thursday", en: "Thursday", it: "Giovedi", shortEn: "Thu", shortIt: "Gio" },
  { key: "friday", en: "Friday", it: "Venerdi", shortEn: "Fri", shortIt: "Ven" },
  { key: "saturday", en: "Saturday", it: "Sabato", shortEn: "Sat", shortIt: "Sab" },
  { key: "sunday", en: "Sunday", it: "Domenica", shortEn: "Sun", shortIt: "Dom" },
] as const;

type DayKey = (typeof days)[number]["key"];
type PhotoSlot = "exterior" | "interior" | "extra1" | "extra2" | "extra3";

type SubmissionDraft = {
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
  agreementSignature: string;
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
  paymentMethod?: PaymentMethod | null;
  phone: string;
  photoUrls: string;
  shortDescription: string;
  townId: string;
  website: string;
  whatsapp: string;
};

type PublishFormProps = {
  adminMode?: boolean;
  categories: Pick<Category, "id" | "name" | "slug">[];
  googlePlacesApiKey: string;
  locale: Locale;
  phoneCountryOptions: PhoneCountryOption[];
  previousSuccessfulSubmissionCount?: number;
  editMode?: {
    businessId: string;
    businessSlug: string;
    initialStep?: OwnerEditStep;
    preservedPhotoUrls?: string[];
  };
  role?: "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER";
  submission: SubmissionDraft;
  towns: Pick<Town, "id" | "latitude" | "longitude" | "name" | "province" | "region">[];
};

type OpeningHoursDay = {
  close1: string;
  close2: string;
  closed: boolean;
  day: DayKey;
  open1: string;
  open2: string;
  split: boolean;
};

type PhotoDraft = Record<PhotoSlot, string>;

type PhoneParts = {
  country: CountryCode;
  number: string;
};

type LocalDraftSnapshot = SubmissionFormValues & {
  id?: string;
  updatedAt?: string;
};

type WizardStep =
  | "business"
  | "contact"
  | "owner"
  | "about"
  | "hours"
  | "photos"
  | "review"
  | "duplicate-blocked"
  | "handoff"
  | "owner-review"
  | "agreement"
  | "signature"
  | "payment";

export type OwnerEditStep = Extract<
  WizardStep,
  "business" | "contact" | "owner" | "about" | "hours" | "photos"
>;

const optionalPhotoSlots = ["extra1", "extra2", "extra3"] as const satisfies readonly PhotoSlot[];

const defaultPhoneCountry: CountryCode = "IT";
const phoneNumberInputMaxLength = 24;
const supportedPhoneCountries = getCountries() as CountryCode[];
const dialCodeByCountry = new Map(
  supportedPhoneCountries.map((country) => [country, `+${getCountryCallingCode(country)}`]),
);
const localDraftStorageKeyPrefix = "salento-local:publish-draft";

function buildLocalDraftStorageKey(adminMode: boolean) {
  return `${localDraftStorageKeyPrefix}:${adminMode ? "admin" : "standard"}`;
}

function parseLocalDraftSnapshot(value: string | null): LocalDraftSnapshot | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as LocalDraftSnapshot | null;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}


function splitPhoneValue(
  value: string,
  fallbackCountry: CountryCode = defaultPhoneCountry,
): PhoneParts {
  const trimmed = value.trim();

  if (!trimmed) {
    return {
      country: fallbackCountry,
      number: "",
    };
  }

  const parsed = parsePhoneNumberFromString(trimmed);

  if (parsed?.country && dialCodeByCountry.has(parsed.country)) {
    return {
      country: parsed.country,
      number: parsed.nationalNumber,
    };
  }

  if (trimmed.startsWith("+")) {
    const matchingCountry = [...dialCodeByCountry.entries()]
      .sort((left, right) => right[1].length - left[1].length)
      .find(([, dialCode]) => trimmed.startsWith(dialCode));

    if (matchingCountry) {
      const [country, dialCode] = matchingCountry;

      return {
        country,
        number: trimmed.slice(dialCode.length).trim(),
      };
    }
  }

  return {
    country: fallbackCountry,
    number: trimmed,
  };
}

function normalizeEditablePhoneNumberInput(value: string) {
  return value.replace(/[^\d\s().-]+/g, "").slice(0, phoneNumberInputMaxLength);
}

function isPossiblePhoneNumber(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  const parsed =
    parsePhoneNumberFromString(trimmed) ??
    parsePhoneNumberFromString(trimmed, defaultPhoneCountry);

  return Boolean(parsed?.isPossible());
}

function getLivePhoneValidationMessage(value: string, locale: Locale) {
  if (!value.trim() || isPossiblePhoneNumber(value)) {
    return "";
  }

  return locale === "it"
    ? "Inserisci un numero di telefono valido."
    : "Enter a valid phone number.";
}

function isBlobPreviewUrl(value: string | undefined) {
  return Boolean(value && value.startsWith("blob:"));
}

function createDefaultHours(): OpeningHoursDay[] {
  return days.map((day) => ({
    close1: "",
    close2: "",
    closed: false,
    day: day.key,
    open1: "",
    open2: "",
    split: false,
  }));
}

function parseOpeningHours(value: string): OpeningHoursDay[] {
  if (!value.trim()) {
    return createDefaultHours();
  }

  try {
    const parsed = JSON.parse(value) as Partial<OpeningHoursDay>[];

    if (!Array.isArray(parsed) || parsed.length !== days.length) {
      return createDefaultHours();
    }

    return days.map((day, index) => {
      const current = parsed[index];

      return {
        close1: typeof current?.close1 === "string" ? current.close1 : "",
        close2: typeof current?.close2 === "string" ? current.close2 : "",
        closed: Boolean(current?.closed),
        day: day.key,
        open1: typeof current?.open1 === "string" ? current.open1 : "",
        open2: typeof current?.open2 === "string" ? current.open2 : "",
        split: Boolean(current?.split),
      };
    });
  } catch {
    return createDefaultHours();
  }
}

function serializeOpeningHours(value: OpeningHoursDay[]) {
  return JSON.stringify(value);
}

function parseOfferItems(longDescription: string) {
  const rawLines = longDescription
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^(notes collected on site|punti raccolti sul posto):$/i.test(line));

  return rawLines.length ? rawLines : [""];
}

function countOfferItems(items: string[]) {
  return items.map((entry) => entry.trim()).filter(Boolean).length;
}

function buildShortDescription(items: string[]) {
  return items
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(" • ")
    .slice(0, 220);
}

function buildLongDescription(items: string[], locale: Locale) {
  const cleanedItems = items.map((entry) => entry.trim()).filter(Boolean);
  const heading = locale === "it" ? "Punti raccolti sul posto:" : "Notes collected on site:";

  return [heading, ...cleanedItems.map((entry) => `- ${entry}`)].join("\n").trim();
}

function parsePhotos(value: string): PhotoDraft {
  const [exterior = "", interior = "", extra1 = "", extra2 = "", extra3 = ""] = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    exterior,
    extra1,
    extra2,
    extra3,
    interior,
  };
}

function serializePhotos(photos: PhotoDraft) {
  return [photos.exterior, photos.interior, photos.extra1, photos.extra2, photos.extra3]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("\n");
}

function replacePhotoExtension(filename: string, extension: string) {
  return filename.replace(/\.[^.]+$/, "") + extension;
}

async function loadImageFromFile(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new window.Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("image_load_failed"));
      nextImage.src = objectUrl;
    });

    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareSubmissionPhoto(file: File) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return file;
  }

  let image: HTMLImageElement;

  try {
    image = await loadImageFromFile(file);
  } catch {
    return file;
  }

  const maxDimension = 1600;
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const shouldResize = longestSide > maxDimension;
  const shouldCompress = file.size > 1.2 * 1024 * 1024 || file.type !== "image/jpeg";

  if (!shouldResize && !shouldCompress) {
    return file;
  }

  const scale = shouldResize ? maxDimension / longestSide : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return file;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.78);
  });

  if (!blob) {
    return file;
  }

  const compressedFile = new File(
    [blob],
    replacePhotoExtension(file.name || "submission-photo.jpg", ".jpg"),
    {
      lastModified: Date.now(),
      type: "image/jpeg",
    },
  );

  return compressedFile.size < file.size || shouldResize ? compressedFile : file;
}

function normalizeTownMatchValue(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase()
    .replace(/\b(provincia di|province of)\b/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findTownForSelectedAddress(
  towns: Pick<Town, "id" | "name" | "province" | "region">[],
  address: SelectedAddress | null,
) {
  if (!address) {
    return null;
  }

  const locality = normalizeTownMatchValue(address.locality);
  const province = normalizeTownMatchValue(address.administrativeAreaLevel2);

  if (!locality) {
    return null;
  }

  const exactMatches = towns.filter((town) => normalizeTownMatchValue(town.name) === locality);

  if (exactMatches.length === 1) {
    return exactMatches[0] ?? null;
  }

  if (exactMatches.length > 1 && province) {
    const provinceMatch =
      exactMatches.find((town) => normalizeTownMatchValue(town.province) === province) ?? null;

    if (provinceMatch) {
      return provinceMatch;
    }
  }

  return exactMatches[0] ?? null;
}

async function uploadSubmissionPhoto(file: File, slot: PhotoSlot) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("slot", slot);

  const response = await fetch("/api/submission-photos", {
    body: formData,
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("upload_failed");
  }

  return (await response.json()) as { url: string };
}

function CopyToggle({
  checked,
  className = "",
  disabled = false,
  inputClassName = "",
  label,
  name,
  onChange,
}: {
  checked: boolean;
  className?: string;
  disabled?: boolean;
  inputClassName?: string;
  label: string;
  name?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`inline-flex items-center gap-2 text-sm text-[var(--muted)] ${className}`}>
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className={`h-4 w-4 rounded border border-[var(--border)] accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50 ${inputClassName}`}
      />
      <span>{label}</span>
    </label>
  );
}

function HoursTimeInput({
  ariaLabel,
  disabled = false,
  onChange,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <span className="hours-time-control">
      <IconClock className="hours-time-icon" size={19} aria-hidden="true" />
      <input
        type="time"
        aria-label={ariaLabel}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="hours-time-input input-field"
      />
    </span>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p className="text-sm text-[var(--accent)]">{message}</p>;
}

function getFieldInputClass(hasError: boolean, extraClassName = "") {
  return [
    "input-field",
    hasError
      ? "!border-[rgba(191,91,42,0.48)] bg-[rgba(255,248,243,0.92)] ring-2 ring-[rgba(191,91,42,0.16)]"
      : "",
    extraClassName,
  ]
    .filter(Boolean)
    .join(" ");
}

function SocialHandleInput({
  hasError,
  name,
  onChange,
  value,
}: {
  hasError: boolean;
  name?: "facebook" | "instagram";
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[0.95rem] text-[var(--foreground)]"
      >
        @
      </span>
      <input
        name={name}
        value={value}
        onChange={(event) => onChange(normalizeSubmissionSocialInput(event.target.value))}
        className={getFieldInputClass(hasError, "!pl-8")}
      />
    </div>
  );
}

function FieldLabel({
  title,
  description,
  optional,
  required,
}: {
  description?: string;
  optional?: string;
  required?: string;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>{title}</span>
      {required ? (
        <span className="pill-accent !px-2.5 !py-1 !text-[0.68rem]">{required}</span>
      ) : null}
      {optional ? (
        <span className="pill-muted !px-2.5 !py-1 !text-[0.68rem]">{optional}</span>
      ) : null}
      {description ? (
        <p className="w-full text-sm font-normal text-[var(--muted)]">{description}</p>
      ) : null}
    </div>
  );
}

function buildSubmissionFormValues(submission: SubmissionDraft): SubmissionFormValues {
  const initialOfferItems = parseOfferItems(submission.longDescription);
  const generatedSummary = buildShortDescription(initialOfferItems);

  return {
    address: submission.address,
    addressCountry: submission.addressCountry,
    addressCountryCode: submission.addressCountryCode,
    addressLatitude: submission.addressLatitude,
    addressLocality: submission.addressLocality,
    addressLongitude: submission.addressLongitude,
    addressPlaceId: submission.addressPlaceId,
    addressPostalCode: submission.addressPostalCode,
    addressProvince: submission.addressProvince,
    addressRegion: submission.addressRegion,
    addressRoute: submission.addressRoute,
    addressStreetNumber: submission.addressStreetNumber,
    agreementAccepted: false,
    agreementSignature: submission.agreementSignature,
    businessSummary:
      submission.shortDescription.trim() &&
      submission.shortDescription.trim() !== generatedSummary
        ? submission.shortDescription.trim()
        : "",
    businessName: submission.businessName,
    categoryId: submission.categoryId,
    email: submission.email,
    facebook: normalizeSubmissionSocialInput(submission.facebook),
    googleMapsUrl: submission.googleMapsUrl,
    id: submission.id,
    instagram: normalizeSubmissionSocialInput(submission.instagram),
    longDescription: submission.longDescription,
    openingHours: submission.openingHours,
    ownerEmail: submission.ownerEmail,
    ownerHasNoEmail: submission.ownerHasNoEmail,
    ownerName: submission.ownerName,
    ownerPhone: submission.ownerPhone,
    signerFullName: submission.signerFullName,
    signerRole: submission.signerRole,
    signerRoleOther: submission.signerRoleOther,
    paymentMethod: submission.paymentMethod ?? undefined,
    phone: submission.phone,
    photoUrls: submission.photoUrls,
    shortDescription: submission.shortDescription,
    townId: submission.townId,
    website: submission.website,
    whatsapp: submission.whatsapp,
  };
}

function getResumeWizardStep(values: SubmissionFormValues): WizardStep {
  const hasBusiness = Boolean(values.businessName && values.categoryId && values.addressPlaceId && values.townId);
  if (!hasBusiness) return "business";
  if (!values.phone) return "contact";
  if (!values.ownerName || !values.ownerPhone || (!values.ownerEmail && !values.ownerHasNoEmail)) return "owner";
  if (countOfferItems(parseOfferItems(values.longDescription)) < 2) return "about";
  if (!parseOpeningHours(values.openingHours).some((day) => day.closed || Boolean(day.open1 && day.close1))) return "hours";
  const photos = parsePhotos(values.photoUrls);
  if (!photos.exterior || !photos.interior) return "photos";
  return "review";
}

export function PublishForm({
  adminMode = false,
  categories,
  editMode,
  googlePlacesApiKey,
  locale,
  phoneCountryOptions,
  previousSuccessfulSubmissionCount = 0,
  role = "USER",
  submission,
  towns,
}: PublishFormProps) {
  const router = useRouter();
  const isEditMode = Boolean(editMode);
  const initialSubmissionValues = buildSubmissionFormValues(submission);
  const initialSelectedAddress = buildSelectedAddressFromStoredFields(initialSubmissionValues);
  const initialOfferItems = parseOfferItems(initialSubmissionValues.longDescription);
  const generatedInitialSummary = buildShortDescription(initialOfferItems);
  const [state, action, actionPending] = useActionState(
    isEditMode ? updateOwnedBusinessWithWizardAction : saveBusinessSubmissionAction,
    initialState,
  );
  const [currentSubmissionId, setCurrentSubmissionId] = useState(submission.id ?? "");
  const [businessName, setBusinessName] = useState(initialSubmissionValues.businessName);
  const [categoryId, setCategoryId] = useState(initialSubmissionValues.categoryId);
  const [address, setAddress] = useState(() =>
    initialSelectedAddress ? buildStreetAddressLine(initialSelectedAddress) : initialSubmissionValues.address,
  );
  const [selectedAddress, setSelectedAddress] = useState<SelectedAddress | null>(() =>
    initialSelectedAddress,
  );
  const [selectedTownId, setSelectedTownId] = useState(() => {
    const matchedTown = findTownForSelectedAddress(towns, initialSelectedAddress);
    return matchedTown?.id ?? initialSubmissionValues.townId;
  });
  const [businessPhoneParts, setBusinessPhoneParts] = useState<PhoneParts>(() =>
    splitPhoneValue(initialSubmissionValues.phone),
  );
  const [businessWhatsappParts, setBusinessWhatsappParts] = useState<PhoneParts>(() =>
    splitPhoneValue(initialSubmissionValues.whatsapp),
  );
  const [ownerContactParts, setOwnerContactParts] = useState<PhoneParts>(() =>
    splitPhoneValue(initialSubmissionValues.ownerPhone),
  );
  const [addressSelectionError, setAddressSelectionError] = useState("");
  const [businessEmail, setBusinessEmail] = useState(initialSubmissionValues.email);
  const [website, setWebsite] = useState(initialSubmissionValues.website);
  const [instagram, setInstagram] = useState(initialSubmissionValues.instagram);
  const [facebook, setFacebook] = useState(initialSubmissionValues.facebook);
  const [ownerName, setOwnerName] = useState(initialSubmissionValues.ownerName);
  const [ownerEmail, setOwnerEmail] = useState(initialSubmissionValues.ownerEmail);
  const [ownerHasNoEmail, setOwnerHasNoEmail] = useState(initialSubmissionValues.ownerHasNoEmail);
  const [ownerStepAttempted, setOwnerStepAttempted] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [ownerInformationConfirmed, setOwnerInformationConfirmed] = useState(false);
  const [signerFullName, setSignerFullName] = useState(initialSubmissionValues.signerFullName);
  const [signerRole, setSignerRole] = useState(initialSubmissionValues.signerRole);
  const [signerRoleOther, setSignerRoleOther] = useState(initialSubmissionValues.signerRoleOther);
  const [signature, setSignature] = useState(initialSubmissionValues.agreementSignature);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(
    (initialSubmissionValues.paymentMethod as PaymentMethod | undefined) ?? "",
  );
  // Card authority is never inferred from the terms: the Partner and owner
  // choose this visibly before the QR Checkout handoff is opened.
  const [renewalPreference, setRenewalPreference] = useState<"AUTO" | "MANUAL">("AUTO");
  const effectiveRenewalPreference = !ownerEmail.trim()
    ? "MANUAL"
    : renewalPreference;
  const [ownerMatchesBusinessWhatsapp, setOwnerMatchesBusinessWhatsapp] = useState(
    Boolean(initialSubmissionValues.ownerPhone) &&
      initialSubmissionValues.ownerPhone ===
        (initialSubmissionValues.whatsapp || initialSubmissionValues.phone),
  );
  const [hours, setHours] = useState(() => parseOpeningHours(initialSubmissionValues.openingHours));
  const [businessSummary, setBusinessSummary] = useState(() =>
    initialSubmissionValues.businessSummary.trim() ||
      (initialSubmissionValues.shortDescription.trim() &&
      initialSubmissionValues.shortDescription.trim() !== generatedInitialSummary
        ? initialSubmissionValues.shortDescription.trim()
        : ""),
  );
  const [offerItems, setOfferItems] = useState(() => initialOfferItems);
  const [photos, setPhotos] = useState(() => parsePhotos(initialSubmissionValues.photoUrls));
  const [visibleExtraPhotoCount, setVisibleExtraPhotoCount] = useState(() =>
    optionalPhotoSlots.filter((slot) => Boolean(parsePhotos(initialSubmissionValues.photoUrls)[slot])).length,
  );
  const [previewUrls, setPreviewUrls] = useState<Partial<Record<PhotoSlot, string>>>({});
  const [uploadingSlots, setUploadingSlots] = useState<Partial<Record<PhotoSlot, boolean>>>({});
  const [uploadError, setUploadError] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const [draftSavePending, setDraftSavePending] = useState(false);
  const [ownerDetailsExpanded, setOwnerDetailsExpanded] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(() =>
    editMode ? editMode.initialStep ?? "business" : getResumeWizardStep(initialSubmissionValues),
  );
  const offerInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const photoInputRefs = useRef<Partial<Record<PhotoSlot, HTMLInputElement | null>>>({});
  const formRef = useRef<HTMLFormElement | null>(null);
  const intentInputRef = useRef<HTMLInputElement | null>(null);
  const paymentMethodInputRef = useRef<HTMLInputElement | null>(null);
  const exitAfterDraftSaveInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlsRef = useRef<Partial<Record<PhotoSlot, string>>>({});
  const duplicateNoticeRef = useRef<HTMLElement | null>(null);
  const errorNoticeRef = useRef<HTMLParagraphElement | null>(null);
  const awaitingDraftResponseRef = useRef(false);
  const awaitingDuplicateCheckRef = useRef(false);
  const pendingDraftPayloadRef = useRef<string | null>(null);
  const pendingDraftNextStepRef = useRef<WizardStep | null>(null);
  const pendingDraftExitRef = useRef(false);
  const pendingEditExitDestinationRef = useRef<"dashboard" | "listing">("dashboard");
  const lastServerSavedPayloadRef = useRef<string | null>(null);
  const initialDraftRestoreCheckedRef = useRef(false);
  const storageKey = useMemo(() => buildLocalDraftStorageKey(adminMode), [adminMode]);
  const {
    error: paymentOpeningError,
    openPaymentQr,
    pendingMethod: paymentOpeningMethod,
  } = usePaymentQrTransition({
    action: requestPaymentQr,
    locale,
    navigate: router.push,
  });
  const highlightedFields = useMemo(
    () => new Set(state.invalidFields ?? Object.keys(state.fieldErrors ?? {})),
    [state.fieldErrors, state.invalidFields],
  );
  const hasFieldError = (field: string) => highlightedFields.has(field);
  const businessPhone = buildPhoneValue(businessPhoneParts);
  const businessWhatsapp = buildPhoneValue(businessWhatsappParts);
  const ownerContact = buildPhoneValue(ownerContactParts);
  const businessPhoneErrorMessage =
    state.fieldErrors?.phone || getLivePhoneValidationMessage(businessPhone, locale);
  const businessWhatsappErrorMessage =
    state.fieldErrors?.whatsapp || getLivePhoneValidationMessage(businessWhatsapp, locale);
  const ownerStepPhoneError = getOwnerPhoneStepError({
    locale,
    ownerHasNoEmail,
    ownerPhone: ownerContact,
    submitterRole: role,
  });
  const ownerPhoneErrorMessage =
    state.fieldErrors?.ownerPhone || (ownerContact || ownerStepAttempted ? ownerStepPhoneError : "");
  const termsLink = useMemo(() => getAudienceTermsLink(locale, "business"), [locale]);
  const privacyLink = useMemo(() => getLegalLinks(locale).privacy, [locale]);
  const annualPriceLabel = useMemo(
    () => formatCurrencyFromCents(LISTING_OFFER.annualPriceCents, locale),
    [locale],
  );
  // Kept as a local alias while historical acceptance snapshots retain their
  // first-year field name; the visible offer is annual throughout the flow.
  const firstYearPriceLabel = annualPriceLabel;
  const renewalPriceLabel = useMemo(
    () => formatCurrencyFromCents(LISTING_OFFER.renewalPriceCents, locale),
    [locale],
  );
  const hasBusinessPhoneError = hasFieldError("phone") || Boolean(businessPhoneErrorMessage);
  const hasBusinessWhatsappError =
    hasFieldError("whatsapp") || Boolean(businessWhatsappErrorMessage);
  const hasOwnerPhoneError = hasFieldError("ownerPhone") || Boolean(ownerPhoneErrorMessage);
  const copy = useMemo(
    () =>
      locale === "it"
        ? {
          addBullet: "Aggiungi punto",
          adminBadge: "Admin",
          adminBody:
            "Questa versione salta il pagamento e pubblica direttamente la scheda live.",
          adminSend: "Pubblica subito",
          adminTitle: "Conferma admin",
          address: "Indirizzo",
          addressHelp:
            "Cerca la via e seleziona dal menu l'indirizzo verificato corretto. Comune, CAP e provincia si compilano da soli.",
          addressReady: "Inizia a scrivere per vedere i suggerimenti dell'indirizzo.",
          addressSelected: "Indirizzo verificato e selezionato.",
          addressSelectRequired:
            "Scegli l'indirizzo corretto dal menu prima di continuare.",
          addressSearching: "Sto cercando indirizzi reali...",
          addressTypeMore:
            "Scrivi almeno 2 lettere oppure un numero civico per cercare l'indirizzo.",
          addressUnsupportedTown:
            "Questo indirizzo non corrisponde a un comune supportato del sito. Scegli un indirizzo nel Salento.",
          agreement:
            "Confermo che il proprietario o responsabile dell'attività ha autorizzato la creazione di questa scheda su Salento Directory e comprende che la membership annuale costa €100.",
          agreementTitle: "Accettazione chiara del cliente",
          legalTitle: "Termini legali business",
          bankTransfer: "Bonifico bancario",
          bankTransferBody:
            "L'attività riceve le istruzioni per il bonifico. La commissione del getter viene riconosciuta solo dopo conferma del pagamento.",
          businessEmail: "Email dell'attività",
          businessEmailHelp: "Facoltativa. Se c'e, salvala per la scheda pubblica.",
          businessName: "Nome attività",
          businessPhone: "Telefono attività",
          cardHint: "Consigliato",
          category: "Categoria",
          categoryHelp: "Le voci cambiano lingua automaticamente con il sito.",
          closeSelected: "Chiudi i giorni selezionati",
          clearSignature: "Cancella firma",
          country: "Paese",
          contactBody:
            "Questi dati restano privati e servono solo per il follow-up interno con il proprietario.",
          contactPerson: "Contatto privato",
          copyMonday: "Copia il lunedi a tutti",
          dayClosed: "Chiuso",
          details: "Dettagli attività",
          detailsBody:
            "Raccogli cosa offrono con punti rapidi. Premi invio per creare il punto successivo.",
          businessSummary: "Breve descrizione attività",
          businessSummaryHelp:
            "Facoltativa. Qui possono raccontare in poche righe la storia del posto o spiegare meglio cosa vendono.",
          businessSummaryPlaceholder:
            "Una breve descrizione del posto, della sua storia o di quello che vende",
          draft: "Salva bozza",
          draftPending: "Salvataggio...",
          duplicateAddress: "Indirizzo",
          duplicateCategory: "Categoria",
          duplicateExistsBody:
            "Abbiamo trovato una scheda simile. Aprila per controllare i dettagli.",
          duplicateExistsTitle: "Scheda simile trovata",
          duplicateMatchAddress: "Stesso indirizzo",
          duplicateMatchName: "Stesso nome",
          duplicateMatchPhone: "Stesso numero di telefono",
          duplicateOpenListing: "Apri scheda",
          duplicateTown: "Comune",
          exteriorPhoto: "Foto esterna",
          helper:
            "Completa nome, categoria, indirizzo, telefono, contatto privato, orari e almeno 2 foto.",
          hoursBody:
            "Imposta gli orari di apertura giorno per giorno. Se il lunedi e un buon modello, puoi copiarlo a tutti gli altri giorni.",
          hoursClose: "Chiusura",
          hoursOpen: "Apertura",
          hoursTitle: "Orari attività",
          identity: "Identità attività",
          identityBody:
            "Inserisci i dati base che identificano il posto in modo veloce e senza ambiguita.",
          interiorPhoto: "Foto interna",
          noAddress:
            "Nessun indirizzo verificato trovato ancora. Continua con nome via e numero civico esatti.",
          typeMoreAddress: "Scrivi almeno 2 lettere per cercare l'indirizzo.",
          noEmail: "Il proprietario non ha email",
          optional: "Facoltativo",
          ownerEmail: "Email del proprietario o manager",
          ownerName: "Nome del proprietario o manager",
          ownerSignature: "Firma del proprietario o manager",
          ownerSignatureHelp:
            "Fai firmare qui direttamente sullo schermo davanti al cliente.",
          signatureDrawHint: "Firma con il dito o con il mouse nel riquadro qui sotto.",
          signatureLegacyNotice:
            "Esiste una firma precedente salvata. Disegnane una nuova qui per sostituirla.",
          ownerWhatsapp: "WhatsApp privato del proprietario o manager",
          payment: "Pagamento",
          paymentBody:
            "Scegli il metodo senza segnare il pagamento come già verificato.",
          paymentPlaceholder:
            "Il link o QR definitivo potra essere collegato qui in una fase successiva.",
          paymentReference: "Riferimento pagamento",
          photoError: "Caricamento non riuscito. Riprova con un'altra foto.",
          photoChoose: "Tocca per caricare una foto",
          photoChooseHint: "Scegli dalla libreria foto o dalla fotocamera.",
          photoHint:
            "Tocca per scegliere una foto dal telefono. Salviamo il file e poi lo colleghiamo alla scheda.",
          photoOptional: "Foto extra",
          photoAdd: "Aggiungi un'altra foto",
          photoRemove: "Rimuovi",
          photoReplace: "Sostituisci foto",
          photos: "Foto",
          photosBody:
            "Servono almeno una foto esterna e una interna. Ora il getter può caricarle direttamente dal telefono.",
          photoUploading: "Caricamento...",
          phoneCode: "Prefisso",
          phoneNumber: "Numero",
          progress: "Progresso",
          progressDone: "sezioni pronte",
          publishPending: "Invio...",
          qrCard: "QR / pagamento con carta",
          qrCardBody:
            "Opzione consigliata. Il cliente paga direttamente Salento Directory. Lo stato resta in attesa finche il pagamento non viene verificato.",
          listingConfirmation: "Conferma la tua scheda",
          listingConfirmationBody:
            "Controlla i dettagli qui sotto con il titolare dell'attività prima di continuare.",
          handDevice:
            "Consegna il telefono o tablet al titolare dell'attività o a un rappresentante autorizzato per questo passaggio.",
          listingFor: "Scheda per",
          listingIncludes:
            "La scheda include una pagina dedicata su Salento Local con le informazioni e le foto raccolte durante la registrazione.",
          yourListing: "La tua scheda Salento Local",
          firstYear: "Membership annuale",
          afterFirstYear: "Ogni anno",
          renewalLine: "€100/anno per questa attivita.",
          renewalNotAutomatic: "Dettagli di rinnovo prima di ogni autorizzazione.",
          beforeYouSign: "Prima di firmare",
          beforeYouSignIntro:
            "Questi punti riassumono in modo semplice quello che stai autorizzando.",
          summaryAuthorized:
            "Sei il titolare dell'attività oppure sei autorizzato ad agire per suo conto.",
          summaryPublish:
            "Autorizzi Salento Local a creare e pubblicare questa scheda usando informazioni e foto fornite durante la registrazione.",
          summaryPrice:
            "Confermi che questa membership costa €100 per 365 giorni.",
          summaryRenewal:
            "Confermi che ogni rinnovo per questa attivita costa €100/anno; i dettagli del rinnovo saranno mostrati prima dell'eventuale autorizzazione.",
          legalLinksTitle: "Documenti utili",
          signerDetails: "I tuoi dati",
          signerName: "Nome completo",
          signerNamePlaceholder: "Mario Rossi",
          signerRole: "Il tuo ruolo",
          signerRolePlaceholder: "Seleziona il tuo ruolo",
          signerRoleOther: "Specifica il ruolo",
          signerRoleOtherPlaceholder: "Per esempio: procuratore autorizzato",
          signerRoleOwner: "Titolare",
          signerRoleLegalRepresentative: "Legale rappresentante",
          signerRoleManagerAuthorizedByOwner: "Manager autorizzato dal titolare",
          signerRoleOtherAuthorizedRepresentative: "Altro rappresentante autorizzato",
          signatureTitle: "Firma",
          signatureIntro: "Firma qui sotto per confermare le informazioni sopra.",
          termsAcceptancePrefix: "Ho letto e accetto i",
          termsAcceptanceSuffix: ".",
          confirmationEmailNote: "La conferma dell'acquisto e i Termini applicabili saranno inviati a",
          continueToPayment: `Continua al pagamento — ${formatCurrencyFromCents(LISTING_OFFER.annualPriceCents, "it")}`,
          continueToPublish: "Conferma e pubblica subito",
          removeBullet: "Rimuovi punto",
          required: "Richiesto",
          postalCode: "CAP",
          province: "Provincia",
          sectionInProgress: "Da completare",
          sectionReady: "Pronto",
          send: "Invia per pagamento e revisione",
          signTitle: "Firma e conferma",
          sameAsBusinessPhone: "Uguale al telefono attività",
          sameAsBusinessWhatsapp: "Uguale al WhatsApp attività",
          sameHours: "Stessi orari tutti i giorni",
          saveHint:
            "Puoi salvare in bozza in qualsiasi momento e tornare piu tardi.",
          sellOrOffer: "Cosa vendono o offrono",
          sellOrOfferPlaceholder: "Scrivi un punto e premi invio",
          splitHours: "Fascia serale",
          termsLead:
            "Leggi e conferma con il cliente prima di inviare. Questo testo deve essere chiaro e visibile durante la firma.",
          termsHelp:
            "Apri i documenti legali in una nuova scheda per non perdere i dati già inseriti.",
          town: "Comune",
          uploadPhoto: "Carica foto",
          verification: "Verifica proprieta",
          verificationBody:
            "Prima del pagamento verifichiamo che questa attività sia davvero tua con un codice inviato al contatto che scegli qui.",
          verificationEmailBody:
            "Invia un codice all'email privata del proprietario o manager inserita sopra.",
          verificationWhatsappBody:
            "Invia un codice al WhatsApp privato del proprietario o manager inserito sopra.",
          verifyByEmail: "Verifica via email",
          verifyByWhatsapp: "Verifica via WhatsApp",
          whatsapp: "WhatsApp attività",
          }
        : {
          addBullet: "Add bullet",
          adminBadge: "Admin",
          adminBody:
            "This version skips payment and publishes the live business directly.",
          adminSend: "Publish now",
          adminTitle: "Admin confirmation",
          address: "Street address",
          addressHelp:
            "Search the street and choose the correct verified address from the dropdown. Town, postal code, and province will fill automatically.",
          addressReady: "Start typing to see address suggestions.",
          addressSelected: "Verified address selected.",
          addressSelectRequired:
            "Choose the correct address from the dropdown before continuing.",
          addressSearching: "Searching real addresses...",
          addressTypeMore: "Type at least 2 letters or a house number to search the address.",
          addressUnsupportedTown:
            "This address does not match a supported town on the site. Choose an address in Salento.",
          agreement:
            "I confirm that the business owner or manager gave permission to create this Salento Directory listing and understands that the annual membership price is €100.",
          agreementTitle: "Clear owner approval",
          legalTitle: "Business legal terms",
          bankTransfer: "Bank transfer",
          bankTransferBody:
            "The business receives bank transfer instructions. Getter commission is released only after payment is confirmed.",
          businessEmail: "Business email",
          businessEmailHelp: "Optional. If they have one, save it for the public listing.",
          businessName: "Business name",
          businessPhone: "Business phone",
          cardHint: "Recommended",
          category: "Category",
          categoryHelp: "These options localize automatically with the site language.",
          closeSelected: "Close selected days",
          clearSignature: "Clear signature",
          country: "Country",
          contactBody:
            "These details stay private and are only used for internal follow-up with the owner.",
          contactPerson: "Private contact",
          copyMonday: "Copy Monday to all",
          dayClosed: "Closed",
          details: "Business details",
          detailsBody:
            "Capture what they offer with quick bullets. Press Enter to create the next bullet.",
          businessSummary: "Short business description",
          businessSummaryHelp:
            "Optional. Use this space for a short description, a bit of history, or a clearer explanation of what they sell.",
          businessSummaryPlaceholder:
            "A short description of the business, its story, or what it sells",
          draft: "Save draft",
          draftPending: "Saving...",
          duplicateAddress: "Address",
          duplicateCategory: "Category",
          duplicateExistsBody:
            "We found a similar listing. Open it to review the details.",
          duplicateExistsTitle: "Similar listing found",
          duplicateMatchAddress: "Same address",
          duplicateMatchName: "Same name",
          duplicateMatchPhone: "Same phone number",
          duplicateOpenListing: "Open listing",
          duplicateTown: "Town",
          exteriorPhoto: "Exterior photo",
          helper:
            "Complete the name, category, address, phone, private contact, hours, and at least 2 photos.",
          hoursBody:
            "Set the opening hours day by day. If Monday is a good template, you can copy it across the week.",
          hoursClose: "Close",
          hoursOpen: "Open",
          hoursTitle: "Business hours",
          identity: "Business identity",
          identityBody:
            "Capture the basic information that identifies the place clearly and quickly.",
          interiorPhoto: "Interior photo",
          noAddress:
            "No verified address found yet. Keep typing the street name and exact house number.",
          typeMoreAddress: "Type at least 2 letters to search the address.",
          noEmail: "Owner does not have email",
          optional: "Optional",
          ownerEmail: "Owner or manager email",
          ownerName: "Owner or manager name",
          ownerSignature: "Owner or manager signature",
          ownerSignatureHelp:
            "Ask the owner to sign directly on the screen here.",
          signatureDrawHint: "Sign with a finger or mouse inside the box below.",
          signatureLegacyNotice:
            "A previous signature is saved here. Draw a new one below to replace it.",
          ownerWhatsapp: "Owner or manager private WhatsApp",
          payment: "Payment",
          paymentBody:
            "Choose the payment method without marking the payment as already verified.",
          paymentPlaceholder:
            "The final payment link or QR code can connect here in a later step.",
          paymentReference: "Payment reference",
          photoError: "Upload failed. Please try another photo.",
          photoChoose: "Tap to upload a photo",
          photoChooseHint: "Choose from your photo library or camera.",
          photoHint:
            "Tap to choose a photo from the phone. We upload it first, then attach it to the submission.",
          photoOptional: "Extra photo",
          photoAdd: "Add another photo",
          photoRemove: "Remove",
          photoReplace: "Replace photo",
          photos: "Photos",
          photosBody:
            "At least one exterior and one interior photo are required. The getter can upload them directly from the phone here.",
          photoUploading: "Uploading...",
          phoneCode: "Country code",
          phoneNumber: "Number",
          progress: "Progress",
          progressDone: "sections ready",
          publishPending: "Submitting...",
          qrCard: "QR / card payment",
          qrCardBody:
            "Recommended. The business pays Salento Directory directly. Status stays pending until payment is verified.",
          listingConfirmation: "Confirm your listing",
          listingConfirmationBody:
            "Please check the details below with the business owner before continuing.",
          handDevice:
            "Please hand the phone or tablet to the business owner or authorized representative for this step.",
          listingFor: "Listing for",
          listingIncludes:
            "Your listing includes a dedicated business page on Salento Local using the information and photos provided during registration.",
          yourListing: "Your Salento Local listing",
          firstYear: "Annual membership",
          afterFirstYear: "Each year",
          renewalLine: "€100/year for this business.",
          renewalNotAutomatic: "Renewal details before any authorization.",
          beforeYouSign: "Before you sign",
          beforeYouSignIntro:
            "These points summarize in plain language what you are approving.",
          summaryAuthorized:
            "You are the business owner or are authorized to act on behalf of the business.",
          summaryPublish:
            "You authorize Salento Local to create and publish this listing using the information and photos provided during registration.",
          summaryPrice:
            "You understand that this membership costs €100 for 365 days.",
          summaryRenewal:
            "You understand that each renewal for this business costs €100/year; renewal details will be shown before any authorization.",
          legalLinksTitle: "Useful documents",
          signerDetails: "Your details",
          signerName: "Full name",
          signerNamePlaceholder: "Mario Rossi",
          signerRole: "Your role",
          signerRolePlaceholder: "Select your role",
          signerRoleOther: "Please specify your role",
          signerRoleOtherPlaceholder: "For example: authorized proxy",
          signerRoleOwner: "Owner",
          signerRoleLegalRepresentative: "Legal representative",
          signerRoleManagerAuthorizedByOwner: "Manager authorized by owner",
          signerRoleOtherAuthorizedRepresentative: "Other authorized representative",
          signatureTitle: "Signature",
          signatureIntro: "Sign below to confirm the information above.",
          termsAcceptancePrefix: "I have read and accept the",
          termsAcceptanceSuffix: ".",
          confirmationEmailNote: "Confirmation will be sent to",
          continueToPayment: `Continue to payment — ${formatCurrencyFromCents(LISTING_OFFER.annualPriceCents, "en")}`,
          continueToPublish: "Confirm and publish now",
          removeBullet: "Remove bullet",
          required: "Required",
          postalCode: "Postal code",
          province: "Province",
          sectionInProgress: "In progress",
          sectionReady: "Ready",
          send: "Send for payment and review",
          signTitle: "Signature and confirmation",
          sameAsBusinessPhone: "Same as business phone",
          sameAsBusinessWhatsapp: "Same as business WhatsApp",
          sameHours: "Same hours every day",
          saveHint: "You can save a draft at any time and come back later.",
          sellOrOffer: "What do they sell or offer",
          sellOrOfferPlaceholder: "Write one bullet and press Enter",
          splitHours: "Evening split",
          termsLead:
            "Read and confirm this clearly with the owner before submitting. The wording should stay large and easy to understand.",
          termsHelp:
            "Open the legal documents in a new tab so you do not lose the information you already entered.",
          town: "Town",
          uploadPhoto: "Upload photo",
          verification: "Ownership verification",
          verificationBody:
            "Before payment we verify that this business is really yours with a code sent to the contact method you choose here.",
          verificationEmailBody:
            "Send a code to the private owner or manager email entered above.",
          verificationWhatsappBody:
            "Send a code to the private owner or manager WhatsApp entered above.",
          verifyByEmail: "Verify by email",
          verifyByWhatsapp: "Verify by WhatsApp",
          whatsapp: "Business WhatsApp",
          },
    [locale],
  );

  function setPreviewUrlForSlot(slot: PhotoSlot, nextUrl: string | null) {
    setPreviewUrls((current) => {
      const previousUrl = current[slot];

      if (previousUrl && previousUrl !== nextUrl && isBlobPreviewUrl(previousUrl)) {
        URL.revokeObjectURL(previousUrl);
      }

      const nextPreviews = { ...current };

      if (nextUrl) nextPreviews[slot] = nextUrl;
      else delete nextPreviews[slot];

      previewUrlsRef.current = nextPreviews;
      return nextPreviews;
    });
  }

  function clearPreviewUrls() {
    setPreviewUrls((current) => {
      for (const url of Object.values(current)) {
        if (isBlobPreviewUrl(url)) URL.revokeObjectURL(url);
      }

      previewUrlsRef.current = {};
      return {};
    });
  }

  const restoreSubmission = useEffectEvent((nextSubmission: SubmissionFormValues) => {
    const nextOfferItems = parseOfferItems(nextSubmission.longDescription);
    const nextGeneratedSummary = buildShortDescription(nextOfferItems);
    const nextPhotos = parsePhotos(nextSubmission.photoUrls);
    const nextSelectedAddress = buildSelectedAddressFromStoredFields(nextSubmission);
    const matchedTown = findTownForSelectedAddress(towns, nextSelectedAddress);

    setCurrentSubmissionId(nextSubmission.id ?? "");
    setBusinessName(nextSubmission.businessName);
    setCategoryId(nextSubmission.categoryId);
    setAddress(nextSelectedAddress ? buildStreetAddressLine(nextSelectedAddress) : nextSubmission.address);
    setSelectedAddress(nextSelectedAddress);
    setSelectedTownId(matchedTown?.id ?? nextSubmission.townId);
    setBusinessPhoneParts(splitPhoneValue(nextSubmission.phone));
    setBusinessWhatsappParts(splitPhoneValue(nextSubmission.whatsapp));
    setOwnerContactParts(splitPhoneValue(nextSubmission.ownerPhone));
    setBusinessEmail(nextSubmission.email);
    setWebsite(nextSubmission.website);
    setInstagram(normalizeSubmissionSocialInput(nextSubmission.instagram));
    setFacebook(normalizeSubmissionSocialInput(nextSubmission.facebook));
    setOwnerName(nextSubmission.ownerName);
    setOwnerEmail(nextSubmission.ownerEmail);
    setOwnerHasNoEmail(nextSubmission.ownerHasNoEmail);
    setSignerFullName(nextSubmission.signerFullName);
    setSignerRole(nextSubmission.signerRole);
    setSignerRoleOther(nextSubmission.signerRoleOther);
    setAgreementAccepted(Boolean(nextSubmission.agreementAccepted));
    setSignature(nextSubmission.agreementSignature);
    setPaymentMethod((nextSubmission.paymentMethod as PaymentMethod | undefined) ?? "");
    setOwnerMatchesBusinessWhatsapp(
      Boolean(nextSubmission.ownerPhone) &&
        nextSubmission.ownerPhone === (nextSubmission.whatsapp || nextSubmission.phone),
    );
    setHours(parseOpeningHours(nextSubmission.openingHours));
    setBusinessSummary(
      nextSubmission.businessSummary.trim() ||
        (nextSubmission.shortDescription.trim() &&
        nextSubmission.shortDescription.trim() !== nextGeneratedSummary
          ? nextSubmission.shortDescription.trim()
          : ""),
    );
    setOfferItems(nextOfferItems);
    clearPreviewUrls();
    setPhotos(nextPhotos);
    setVisibleExtraPhotoCount(
      optionalPhotoSlots.filter((slot) => Boolean(nextPhotos[slot])).length,
    );
    setAddressSelectionError("");
  });

  function duplicateResponseMatchesCurrentValues(nextSubmission: SubmissionFormValues) {
    return duplicateResponseMatchesSubmittedValues(nextSubmission, {
      address,
      businessName,
      phone: businessPhone,
    });
  }

  function getPostDuplicateCheckStep(): WizardStep {
    return role === "GETTER" && !adminMode ? "handoff" : "owner-review";
  }

  useEffect(() => {
    if (!state.submission) {
      return;
    }

    // Validation failures also return the attempted values so the form can keep
    // them visible. They are not a confirmed database save and must never move
    // the guided flow forward or exit it.
    if (awaitingDraftResponseRef.current && state.error) {
      return;
    }

    const submission = state.submission;

    if (awaitingDuplicateCheckRef.current) {
      awaitingDuplicateCheckRef.current = false;

      if (state.error) {
        const duplicateCheckError = state.error;
        startTransition(() => setDraftNotice(duplicateCheckError));
        return;
      }

      moveToWizardStep(
        hasCredibleDuplicateMatches(state.duplicateMatches) &&
        duplicateResponseMatchesCurrentValues(submission)
          ? "duplicate-blocked"
          : getPostDuplicateCheckStep(),
      );
      return;
    }

    if (awaitingDraftResponseRef.current) {
      if (pendingDraftPayloadRef.current) {
        lastServerSavedPayloadRef.current = pendingDraftPayloadRef.current;
      }

      const nextStep = pendingDraftNextStepRef.current;
      const exitAfterSave = pendingDraftExitRef.current;
      const editExitDestination = pendingEditExitDestinationRef.current;

      awaitingDraftResponseRef.current = false;
      pendingDraftPayloadRef.current = null;
      pendingDraftNextStepRef.current = null;
      pendingDraftExitRef.current = false;
      pendingEditExitDestinationRef.current = "dashboard";
      startTransition(() => {
        setCurrentSubmissionId(submission.id ?? "");
        setDraftSavePending(false);
      });

      if (exitAfterSave) {
        router.push(
          isEditMode && editExitDestination === "listing"
            ? `/businesses/${editMode?.businessSlug}`
            : isEditMode
              ? "/dashboard"
              : "/dashboard/businesses",
        );
        return;
      }

      if (nextStep) {
        moveToWizardStep(nextStep);
      }

      return;
    }

    startTransition(() => {
      restoreSubmission(submission);
    });
  }, [adminMode, editMode?.businessSlug, isEditMode, role, router, state.duplicateMatches, state.error, state.submission]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(previewUrlsRef.current)) {
        if (isBlobPreviewUrl(url)) {
          URL.revokeObjectURL(url);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedAddress) {
      if (isEditMode) {
        startTransition(() => setSelectedTownId(initialSubmissionValues.townId));
        return;
      }

      startTransition(() => setSelectedTownId(""));

      return;
    }

    const matchedTown = findTownForSelectedAddress(towns, selectedAddress);

    if (!matchedTown) {
      startTransition(() => {
        setSelectedTownId("");
        setAddressSelectionError((current) =>
          current === copy.addressSelectRequired ? current : copy.addressUnsupportedTown,
        );
      });
      return;
    }

    startTransition(() => {
      setSelectedTownId(matchedTown.id);
      setAddressSelectionError((current) =>
        current === copy.addressUnsupportedTown ? "" : current,
      );
    });
  }, [
    address,
    copy.addressSelectRequired,
    copy.addressUnsupportedTown,
    initialSubmissionValues.townId,
    isEditMode,
    selectedAddress,
    towns,
  ]);

  const generatedOfferSummary = useMemo(() => buildShortDescription(offerItems), [offerItems]);
  const offerItemsCount = useMemo(() => countOfferItems(offerItems), [offerItems]);
  const normalizedBusinessSummary = useMemo(() => businessSummary.trim(), [businessSummary]);
  const shortDescriptionValue = useMemo(
    () => normalizedBusinessSummary.slice(0, 220) || generatedOfferSummary,
    [generatedOfferSummary, normalizedBusinessSummary],
  );
  const longDescriptionValue = useMemo(
    () => buildLongDescription(offerItems, locale),
    [locale, offerItems],
  );
  const openingHoursValue = useMemo(() => serializeOpeningHours(hours), [hours]);
  const photoUrlsValue = useMemo(() => serializePhotos(photos), [photos]);
  const currentDraftSnapshot = useMemo<LocalDraftSnapshot>(
    () => ({
      address,
      addressCountry: selectedAddress?.country?.trim() ?? "",
      addressCountryCode: selectedAddress?.countryCode?.trim() ?? "",
      addressLatitude:
        selectedAddress && Number.isFinite(selectedAddress.latitude)
          ? String(selectedAddress.latitude)
          : "",
      addressLocality: selectedAddress?.locality?.trim() ?? "",
      addressLongitude:
        selectedAddress && Number.isFinite(selectedAddress.longitude)
          ? String(selectedAddress.longitude)
          : "",
      addressPlaceId: selectedAddress?.placeId?.trim() ?? "",
      addressPostalCode: selectedAddress?.postalCode?.trim() ?? "",
      addressProvince: selectedAddress?.administrativeAreaLevel2?.trim() ?? "",
      addressRegion: selectedAddress?.administrativeAreaLevel1?.trim() ?? "",
      addressRoute: selectedAddress?.route?.trim() ?? "",
      addressStreetNumber: selectedAddress?.streetNumber?.trim() ?? "",
      agreementAccepted,
      agreementSignature: signature,
      businessSummary,
      businessName,
      categoryId,
      email: businessEmail,
      facebook,
      googleMapsUrl: "",
      id: currentSubmissionId || undefined,
      instagram,
      longDescription: longDescriptionValue,
      openingHours: openingHoursValue,
      ownerEmail,
      ownerHasNoEmail,
      ownerName,
      ownerPhone: ownerContact,
      signerFullName,
      signerRole,
      signerRoleOther,
      paymentMethod: paymentMethod || undefined,
      phone: businessPhone,
      photoUrls: photoUrlsValue,
      shortDescription: shortDescriptionValue,
      townId: selectedTownId,
      website,
      whatsapp: businessWhatsapp,
    }),
    [
      address,
      agreementAccepted,
      businessEmail,
      businessName,
      businessPhone,
      businessSummary,
      businessWhatsapp,
      categoryId,
      currentSubmissionId,
      facebook,
      instagram,
      longDescriptionValue,
      openingHoursValue,
      ownerContact,
      ownerEmail,
      ownerHasNoEmail,
      ownerName,
      signerFullName,
      signerRole,
      signerRoleOther,
      paymentMethod,
      photoUrlsValue,
      selectedAddress,
      selectedTownId,
      shortDescriptionValue,
      signature,
      website,
    ],
  );
  const currentDraftPayload = useMemo(
    () => JSON.stringify(currentDraftSnapshot),
    [currentDraftSnapshot],
  );
  const canPersistServerDraft = Boolean(categoryId && selectedTownId);
  const duplicateReviewMatchesCurrentValues = useMemo(() => {
    if (!state.duplicateMatches?.length || !state.submission) {
      return false;
    }

    return duplicateResponseMatchesCurrentValues(state.submission);
  }, [
    address,
    businessName,
    businessPhone,
    selectedAddress,
    state.duplicateMatches,
    state.submission,
  ]);
  const activeDuplicateMatches = useMemo<DuplicateBusinessMatch[]>(
    () => (duplicateReviewMatchesCurrentValues ? state.duplicateMatches ?? [] : []),
    [duplicateReviewMatchesCurrentValues, state.duplicateMatches],
  );
  const duplicateCheckMessage =
    duplicateReviewMatchesCurrentValues ? state.duplicateCheckMessage ?? "" : "";
  const signerRoleRequiresOther = signerRole === "OTHER_AUTHORIZED_REPRESENTATIVE";
  const signerRoleOptions = useMemo(
    () =>
      LISTING_SIGNER_ROLE_VALUES.map((value) => ({
        label:
          value === "OWNER"
            ? copy.signerRoleOwner
            : value === "LEGAL_REPRESENTATIVE"
              ? copy.signerRoleLegalRepresentative
              : value === "MANAGER_AUTHORIZED_BY_OWNER"
                ? copy.signerRoleManagerAuthorizedByOwner
                : copy.signerRoleOtherAuthorizedRepresentative,
        value,
      })),
    [copy],
  );
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const hoursSummary = hours
    .filter((day) => day.closed || Boolean(day.open1 && day.close1))
    .map((day) => ({
      label: locale === "it"
        ? days.find((entry) => entry.key === day.day)?.shortIt
        : days.find((entry) => entry.key === day.day)?.shortEn,
      value: day.closed
        ? locale === "it" ? "Chiuso" : "Closed"
        : [
            day.open1 && day.close1 ? `${day.open1}–${day.close1}` : "",
            day.split && day.open2 && day.close2 ? `${day.open2}–${day.close2}` : "",
          ].filter(Boolean).join(" · "),
    }));
  const ownerFlowCopy = locale === "it"
    ? {
      agree: "Accetta i termini",
      agreeShort: "Accetta",
      category: "Categoria",
      confirm: "Conferma dati",
      confirmShort: "Conferma",
      contact: "Contatti",
      details: "Vedi tutti i dettagli",
      detailsHide: "Nascondi tutti i dettagli",
      hours: "Orari",
      ownerConfirmation: "Conferma del titolare",
      ownerPrepared: "La tua scheda è pronta. Controlla che i dettagli principali qui sotto siano corretti.",
      payment: "Pagamento",
      photos: "Foto",
      sign: "Firma",
    }
    : {
      agree: "Agree to terms",
      agreeShort: "Agree",
      category: "Category",
      confirm: "Confirm details",
      confirmShort: "Confirm",
      contact: "Contact",
      details: "View all details",
      detailsHide: "Hide all details",
      hours: "Opening hours",
      ownerConfirmation: "Owner confirmation",
      ownerPrepared: "Your listing has been prepared. Please make sure the key details below are correct.",
      payment: "Payment",
      photos: "Photos",
      sign: "Signature",
    };
  const renderBusinessSummary = (photoSize: "compact" | "partner-review" | "owner" = "compact") => (
    <div className="grid gap-4">
      <div>
        <h2 className="font-serif text-3xl text-[var(--foreground)]">{businessName}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{selectedAddress?.formattedAddress || address}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {selectedCategory ? <div><p className="summary-label">{locale === "it" ? "Categoria" : "Category"}</p><p className="mt-1 text-sm text-[var(--foreground)]">{getCategoryLabel(selectedCategory.slug, selectedCategory.name, locale)}</p></div> : null}
        {businessSummary ? <div className="sm:col-span-2"><p className="summary-label">{locale === "it" ? "Descrizione attività" : "Business description"}</p><p className="mt-1 whitespace-pre-line text-sm leading-6 text-[var(--foreground)]">{businessSummary}</p></div> : null}
        {shortDescriptionValue ? <div className="sm:col-span-2"><p className="summary-label">{locale === "it" ? "Informazioni" : "About"}</p><p className="mt-1 text-sm leading-6 text-[var(--foreground)]">{shortDescriptionValue}</p></div> : null}
        {offerItems.filter(Boolean).length ? <div className="sm:col-span-2"><p className="summary-label">{locale === "it" ? "Cosa offrono" : "What they offer"}</p><div className="mt-2 flex flex-wrap gap-2">{offerItems.filter(Boolean).map((item) => <span key={item} className="pill-muted">{item}</span>)}</div></div> : null}
        {hoursSummary.length ? <div className="sm:col-span-2"><p className="summary-label">{locale === "it" ? "Orari" : "Opening hours"}</p><div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-[var(--foreground)] sm:grid-cols-3">{hoursSummary.map((entry) => <span key={entry.label}>{entry.label}: {entry.value}</span>)}</div></div> : null}
        <div><p className="summary-label">{locale === "it" ? "Contatti" : "Contact"}</p><div className="mt-1 grid gap-1 text-sm text-[var(--foreground)]"><span>{businessPhone}</span>{businessWhatsapp ? <span>WhatsApp: {businessWhatsapp}</span> : null}{businessEmail ? <span>{businessEmail}</span> : null}</div></div>
        {website || instagram || facebook ? <div><p className="summary-label">{locale === "it" ? "Online" : "Online"}</p><div className="mt-1 grid gap-1 break-words text-sm text-[var(--foreground)]">{website ? <span>{website}</span> : null}{instagram ? <span>Instagram: {instagram}</span> : null}{facebook ? <span>Facebook: {facebook}</span> : null}</div></div> : null}
      </div>
      {Object.entries(photos).some(([, url]) => Boolean(url)) ? <div><p className="summary-label">{locale === "it" ? "Foto" : "Photos"}</p><div className={`mt-2 flex gap-3 overflow-x-auto ${photoSize === "partner-review" ? "partner-review-photos" : ""}`}>{Object.entries(photos).filter(([, url]) => Boolean(url)).map(([slot, url]) => <img key={slot} src={url} alt={`${businessName} ${slot}`} className={photoSize === "owner" ? "h-28 w-28 shrink-0 rounded-2xl object-cover sm:h-32 sm:w-32" : photoSize === "partner-review" ? "h-36 w-36 shrink-0 rounded-2xl object-cover sm:h-40 sm:w-40" : "h-16 w-16 shrink-0 rounded-xl object-cover"} />)}</div></div> : null}
    </div>
  );
  const renderOwnerConfirmationSummary = () => {
    const photoEntries = Object.entries(photos).filter(([, url]) => Boolean(url));
    const primaryPhoto = photoEntries[0]?.[1];
    const categoryLabel = selectedCategory
      ? getCategoryLabel(selectedCategory.slug, selectedCategory.name, locale)
      : "";
    const compactHours = hoursSummary
      .reduce<Array<{ start: string; end: string; value: string }>>((groups, entry) => {
        const label = entry.label || "";
        const previousGroup = groups[groups.length - 1];

        if (previousGroup?.value === entry.value) {
          previousGroup.end = label;
        } else {
          groups.push({ start: label, end: label, value: entry.value });
        }

        return groups;
      }, [])
      .map((group) => `${group.start === group.end ? group.start : `${group.start}–${group.end}`}: ${group.value}`)
      .join(" · ");

    return (
      <section className="owner-confirmation-card">
        <div className="owner-confirmation-card__heading">
          <div className="owner-confirmation-card__identity">
            {primaryPhoto ? (
              <img src={primaryPhoto} alt="" className="owner-confirmation-card__image" />
            ) : (
              <span className="owner-confirmation-card__image owner-confirmation-card__image--placeholder" aria-hidden="true">
                <IconBuildingStore size={28} />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="break-words font-serif text-2xl text-[var(--foreground)] sm:text-3xl">{businessName}</h2>
              {categoryLabel ? <p className="mt-1 text-sm text-[var(--foreground)]">{categoryLabel}</p> : null}
              <p className="mt-1 break-words text-sm leading-5 text-[var(--muted)]">{selectedAddress?.formattedAddress || address}</p>
            </div>
          </div>
          <button
            type="button"
            aria-expanded={ownerDetailsExpanded}
            aria-controls="owner-full-business-details"
            onClick={() => setOwnerDetailsExpanded((expanded) => !expanded)}
            className="owner-confirmation-card__details-toggle"
          >
            {ownerDetailsExpanded ? ownerFlowCopy.detailsHide : ownerFlowCopy.details}
          </button>
        </div>
        <dl className="owner-confirmation-card__rows">
          <div>
            <dt>{ownerFlowCopy.contact}</dt>
            <dd className="break-words">{businessPhone || businessWhatsapp || businessEmail || "—"}</dd>
          </div>
          <div>
            <dt>{ownerFlowCopy.hours}</dt>
            <dd>{compactHours || "—"}</dd>
          </div>
          <div>
            <dt>{ownerFlowCopy.category}</dt>
            <dd>{categoryLabel || "—"}</dd>
          </div>
          <div>
            <dt>{ownerFlowCopy.photos}</dt>
            <dd className="owner-confirmation-card__photos">
              <span>{photoEntries.length}</span>
              {photoEntries.slice(0, 2).map(([slot, url]) => (
                <img key={slot} src={url} alt="" />
              ))}
            </dd>
          </div>
        </dl>
        {ownerDetailsExpanded ? (
          <div id="owner-full-business-details" className="owner-confirmation-card__full-details">
            {renderBusinessSummary("owner")}
          </div>
        ) : null}
      </section>
    );
  };

  function requestDraftSave(
    mode: "autosave" | "manual",
    exitAfterSave = false,
    nextStep: WizardStep | null = null,
    editExitDestination: "dashboard" | "listing" = "dashboard",
  ) {
    if (!formRef.current) {
      return;
    }

    if (intentInputRef.current) {
      intentInputRef.current.value = isEditMode ? "edit" : "draft";
    }

    if (exitAfterDraftSaveInputRef.current) {
      // Guided-flow navigation happens only after this client receives a confirmed save.
      exitAfterDraftSaveInputRef.current.value = "";
    }

    if (!canPersistServerDraft) {
      if (mode === "manual") {
        setDraftNotice(
          locale === "it"
            ? "Completa nome, categoria e indirizzo verificato prima di salvare e uscire."
            : "Complete the name, category, and verified address before saving and exiting.",
        );
      }

      return;
    }

    if (awaitingDraftResponseRef.current) {
      return;
    }

    awaitingDraftResponseRef.current = true;
    pendingDraftPayloadRef.current = currentDraftPayload;
    pendingDraftNextStepRef.current = nextStep;
    pendingDraftExitRef.current = exitAfterSave;
    pendingEditExitDestinationRef.current = editExitDestination;
    setDraftNotice("");
    setDraftSavePending(true);
    formRef.current.requestSubmit();
  }

  useEffect(() => {
    if (isEditMode) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...currentDraftSnapshot,
        updatedAt: new Date().toISOString(),
      }),
    );
  }, [currentDraftSnapshot, isEditMode, storageKey]);

  useEffect(() => {
    if (isEditMode) {
      lastServerSavedPayloadRef.current = currentDraftPayload;
      return;
    }

    if (typeof window === "undefined" || initialDraftRestoreCheckedRef.current) {
      return;
    }

    initialDraftRestoreCheckedRef.current = true;
    const storedDraft = parseLocalDraftSnapshot(window.localStorage.getItem(storageKey));

    if (!storedDraft) {
      lastServerSavedPayloadRef.current = currentDraftPayload;
      return;
    }

    const { updatedAt: _updatedAt, ...storedSnapshot } = storedDraft;
    const matchesCurrentSubmission = currentSubmissionId
      ? storedSnapshot.id === currentSubmissionId
      : true;

    if (!matchesCurrentSubmission) {
      lastServerSavedPayloadRef.current = currentDraftPayload;
      return;
    }

    if (JSON.stringify(storedSnapshot) === currentDraftPayload) {
      lastServerSavedPayloadRef.current = currentDraftPayload;
      return;
    }

    startTransition(() => {
      restoreSubmission(storedDraft);
      setDraftNotice(
        locale === "it"
          ? "Bozza recuperata da questo browser. Puoi continuare subito."
          : "Draft recovered from this browser. You can continue right away.",
      );
    });
  }, [currentDraftPayload, currentSubmissionId, isEditMode, locale, storageKey]);

  useEffect(() => {
    if (!state.notice) {
      return;
    }

    const actionNotice = state.notice;
    startTransition(() => setDraftNotice(actionNotice));
  }, [state.notice]);

  useEffect(() => {
    if (!state.error || !awaitingDraftResponseRef.current) {
      return;
    }

    const draftSaveError = state.error;

    awaitingDraftResponseRef.current = false;
    pendingDraftPayloadRef.current = null;
    pendingDraftNextStepRef.current = null;
    pendingDraftExitRef.current = false;
    startTransition(() => {
      setDraftSavePending(false);
      setDraftNotice(draftSaveError);
    });
  }, [state.error]);

  useEffect(() => {
    if (activeDuplicateMatches.length) {
      duplicateNoticeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      duplicateNoticeRef.current?.focus();
      return;
    }

    if (state.error) {
      errorNoticeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      errorNoticeRef.current?.focus();
    }
  }, [activeDuplicateMatches.length, state.error]);

  function setHourValue(
    day: DayKey,
    key: keyof Omit<OpeningHoursDay, "day">,
    value: string | boolean,
  ) {
    setHours((current) =>
      current.map((entry) =>
        entry.day === day
          ? {
              ...entry,
              [key]: value,
            }
          : entry,
      ),
    );
  }

  function applyMondayToAll() {
    setHours((current) =>
      {
        const monday = current.find((entry) => entry.day === "monday");

        if (!monday) return current;

        return current.map((entry) => ({
          ...entry,
          close1: monday.close1,
          close2: monday.close2,
          closed: monday.closed,
          open1: monday.open1,
          open2: monday.open2,
          split: monday.split,
        }));
      },
    );
  }

  // Keep the older, inactive form shell compatible with the shared hours helper.
  function applyTemplateToAll(_source: OpeningHoursDay) {
    applyMondayToAll();
  }

  function updateOfferItem(index: number, value: string) {
    setOfferItems((current) => current.map((entry, itemIndex) => (itemIndex === index ? value : entry)));
  }

  function addOfferItem(afterIndex?: number) {
    const insertAt = typeof afterIndex === "number" ? afterIndex + 1 : offerItems.length;

    setOfferItems((current) => {
      const next = [...current];
      next.splice(insertAt, 0, "");

      return next;
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const input = offerInputRefs.current[insertAt];
        input?.focus();
        input?.select();
      });
    });
  }

  function removeOfferItem(index: number) {
    setOfferItems((current) => {
      if (current.length === 1) {
        return [""];
      }

      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function handlePhotoChange(slot: PhotoSlot, file: File | undefined) {
    if (!file) {
      return;
    }

    setUploadError("");
    setUploadingSlots((current) => ({ ...current, [slot]: true }));
    const previewUrl = URL.createObjectURL(file);

    try {
      setPreviewUrlForSlot(slot, previewUrl);
      const preparedFile = await prepareSubmissionPhoto(file);
      const payload = await uploadSubmissionPhoto(preparedFile, slot);
      setPhotos((current) => ({ ...current, [slot]: payload.url }));
      setPreviewUrlForSlot(slot, null);
    } catch {
      setUploadError(copy.photoError);
      setPreviewUrlForSlot(slot, null);
    } finally {
      setUploadingSlots((current) => ({ ...current, [slot]: false }));
    }
  }

  function removePhoto(slot: PhotoSlot) {
    setUploadError("");
    setPreviewUrlForSlot(slot, null);
    setPhotos((current) => ({ ...current, [slot]: "" }));

    if (photoInputRefs.current[slot]) {
      photoInputRefs.current[slot].value = "";
    }
  }

  function validateAddressSelection() {
    if (!address.trim()) {
      return false;
    }

    if (isValidSelectedAddress(selectedAddress)) {
      if (selectedTownId) {
        return false;
      }

      setAddressSelectionError(copy.addressUnsupportedTown);
      return true;
    }

    if (
      isEditMode &&
      selectedTownId &&
      address.trim() === initialSubmissionValues.address.trim()
    ) {
      return false;
    }

    setAddressSelectionError(copy.addressSelectRequired);
    return true;
  }

  const duplicateReviewSection = activeDuplicateMatches.length ? (
    <section
      ref={duplicateNoticeRef}
      tabIndex={-1}
      className="rounded-[1.6rem] border border-[rgba(191,91,42,0.18)] bg-[rgba(255,248,243,0.96)] px-5 py-5 shadow-[var(--shadow-card)]"
    >
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
        {copy.duplicateExistsTitle}
      </p>
      <p className="mt-2 text-sm text-[var(--accent)]">
        {duplicateCheckMessage || copy.duplicateExistsBody}
      </p>
      <div className="mt-5 grid gap-4">
        {activeDuplicateMatches.map((business) => (
          <article
            key={business.id}
            className="rounded-[1.4rem] border border-[rgba(191,91,42,0.16)] bg-white p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-serif text-2xl text-[var(--foreground)]">{business.name}</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {business.categoryName} · {copy.duplicateTown}: {business.townName}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {business.matchReasons.map((reason) => (
                  <span key={`${business.id}-${reason}`} className="pill-warning">
                    {reason === "name"
                      ? copy.duplicateMatchName
                      : reason === "address"
                        ? copy.duplicateMatchAddress
                        : copy.duplicateMatchPhone}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-[var(--muted)] sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  {copy.duplicateAddress}
                </p>
                <p className="mt-1 font-medium text-[var(--foreground)]">{business.address}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  {copy.duplicateMatchPhone}
                </p>
                <p className="mt-1 font-medium text-[var(--foreground)]">{business.phone || "—"}</p>
              </div>
            </div>
            <div className="mt-4">
              <HardNavigationLink
                href={`/businesses/${business.slug}`}
                className="btn-secondary w-full sm:w-auto"
              >
                {copy.duplicateOpenListing}
              </HardNavigationLink>
            </div>
          </article>
        ))}
      </div>
    </section>
  ) : null;

  const firstSubmission = previousSuccessfulSubmissionCount === 0;
  const isPartnerFlow = role === "GETTER" && !adminMode;
  const collectionSteps: Array<{ key: WizardStep; label: string }> = [
    { key: "business", label: locale === "it" ? "Attività" : "Business" },
    { key: "contact", label: locale === "it" ? "Contatti" : "Contact" },
    { key: "owner", label: locale === "it" ? "Titolare" : "Owner" },
    { key: "about", label: locale === "it" ? "Descrizione" : "About" },
    { key: "hours", label: locale === "it" ? "Orari" : "Hours" },
    { key: "photos", label: locale === "it" ? "Foto" : "Photos" },
  ];
  const collectionIndex = collectionSteps.findIndex((step) => step.key === wizardStep);
  const ownerSteps = [
    { key: "owner-review", label: ownerFlowCopy.confirm, shortLabel: ownerFlowCopy.confirmShort, Icon: IconUser },
    { key: "agreement", label: ownerFlowCopy.agree, shortLabel: ownerFlowCopy.agreeShort, Icon: IconCheck },
    { key: "signature", label: ownerFlowCopy.sign, shortLabel: ownerFlowCopy.sign, Icon: IconSignature },
    { key: "payment", label: ownerFlowCopy.payment, shortLabel: ownerFlowCopy.payment, Icon: IconCreditCard },
  ] as const;
  const ownerProgressIndex = ownerSteps.findIndex((step) => step.key === wizardStep);
  const visiblePhotoSlots: PhotoSlot[] = [
    "exterior",
    "interior",
    ...optionalPhotoSlots.slice(0, visibleExtraPhotoCount),
  ];

  function goToNextStep(next: WizardStep) {
    let error = "";
    if (wizardStep === "business") {
      const hasUsableAddress =
        isValidSelectedAddress(selectedAddress) ||
        (isEditMode &&
          Boolean(selectedTownId) &&
          address.trim() === initialSubmissionValues.address.trim());

      if (!businessName.trim() || !categoryId || !hasUsableAddress || !selectedTownId) {
        error = locale === "it" ? "Inserisci nome e categoria e scegli un indirizzo dai suggerimenti." : "Add the name and category, then choose an address from the suggestions.";
      }
    } else if (wizardStep === "contact" && (!businessPhone || !isPossiblePhoneNumber(businessPhone))) {
      error = locale === "it" ? "Inserisci un numero di telefono valido dell'attività." : "Enter a valid business phone number.";
    } else if (wizardStep === "owner") {
      setOwnerStepAttempted(true);
      error = getOwnerStepError({ locale, ownerEmail, ownerHasNoEmail, ownerName, ownerPhone: ownerContact, submitterRole: role });
    } else if (wizardStep === "about" && offerItemsCount < 2) {
      error = locale === "it" ? "Aggiungi almeno due punti su cosa offre l'attività." : "Add at least two points about what the business offers.";
    } else if (wizardStep === "hours" && !hours.some((day) => day.closed || Boolean(day.open1 && day.close1))) {
      error = locale === "it" ? "Indica almeno un orario di apertura o un giorno chiuso." : "Add at least one opening time or mark a day closed.";
    } else if (wizardStep === "photos" && (!photos.exterior || !photos.interior)) {
      error = locale === "it" ? "Aggiungi una foto esterna e una interna prima di continuare." : "Add one exterior and one interior photo before continuing.";
    }

    if (error) {
      setDraftNotice(error);
      return;
    }

    setDraftNotice("");
    if (isEditMode) {
      moveToWizardStep(next);
      return;
    }

    requestDraftSave("autosave", false, next);
  }

  function moveToWizardStep(next: WizardStep) {
    startTransition(() => setWizardStep(next));
  }

  useLayoutEffect(() => {
    window.scrollTo({ top: 0 });
  }, [wizardStep]);

  function checkForExistingBusinesses() {
    if (!businessName.trim() || !categoryId || !isValidSelectedAddress(selectedAddress) || !selectedTownId) {
      setDraftNotice(
        locale === "it"
          ? "Completa prima nome, categoria e indirizzo verificato."
          : "Complete the name, category, and verified address first.",
      );
      return;
    }

    if (!formRef.current || !intentInputRef.current) {
      return;
    }

    intentInputRef.current.value = "check";
    if (exitAfterDraftSaveInputRef.current) {
      exitAfterDraftSaveInputRef.current.value = "";
    }
    setDraftNotice("");
    awaitingDuplicateCheckRef.current = true;
    formRef.current.requestSubmit();
  }

  function continueWithPaymentMethod(method: PaymentQrMethod) {
    if (!formRef.current || actionPending || paymentOpeningMethod) {
      return;
    }

    const selectedRenewalPreference = method === "BANK_TRANSFER" || !ownerEmail.trim() ? "MANUAL" : renewalPreference;

    setPaymentMethod(method);
    if (method === "BANK_TRANSFER" || !ownerEmail.trim()) {
      setRenewalPreference("MANUAL");
    }
    setDraftNotice("");

    // Avoid depending on React flushing controlled hidden inputs before a
    // programmatic submit. This action receives the method and intent in the
    // exact payload created by the clicked payment choice.
    const formData = new FormData(formRef.current);
    formData.set("intent", "submit");
    formData.set("paymentMethod", method);
    formData.set("renewalPreference", selectedRenewalPreference);
    formData.set("exitAfterDraftSave", "");

    openPaymentQr(method, formData);
  }

  function continueAdminPublication() {
    if (intentInputRef.current) {
      intentInputRef.current.value = "submit";
    }
    formRef.current?.requestSubmit();
  }

  const showWizardFooter = wizardStep !== "duplicate-blocked" && wizardStep !== "payment";
  const specialFooterStep = wizardStep === "agreement" || wizardStep === "signature";
  const showFooterButtonIcons = collectionIndex >= 0 || specialFooterStep;

  function getPreviousWizardStep(): WizardStep | null {
    switch (wizardStep) {
      case "contact":
        return "business";
      case "owner":
        return "contact";
      case "about":
        return "owner";
      case "hours":
        return "about";
      case "photos":
        return "hours";
      case "review":
        return "photos";
      case "handoff":
        return "review";
      case "owner-review":
        return isPartnerFlow ? "handoff" : "review";
      case "agreement":
        return "owner-review";
      case "signature":
        return "agreement";
      default:
        return null;
    }
  }

  function goToPreviousStep() {
    const previousStep = getPreviousWizardStep();

    if (!previousStep) {
      return;
    }

    setDraftNotice("");
    moveToWizardStep(previousStep);
  }

  const previousWizardStep = getPreviousWizardStep();


  return (
    <form
      ref={formRef}
      action={action}
      className={`publish-form-shell mx-auto grid w-full max-w-3xl gap-6 ${wizardStep === "hours" ? "publish-form-shell-hours" : ""} ${wizardStep === "agreement" ? "publish-form-shell--agreement" : ""}`}
      onSubmitCapture={(event) => {
        const intent = intentInputRef.current?.value;
        if ((intent === "submit" || intent === "edit") && validateAddressSelection()) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="adminMode" value={adminMode ? "true" : ""} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="businessId" value={editMode?.businessId ?? ""} />
      <input ref={intentInputRef} type="hidden" name="intent" defaultValue="draft" />
      <input ref={exitAfterDraftSaveInputRef} type="hidden" name="exitAfterDraftSave" defaultValue="" />
      <input type="hidden" name="submissionId" value={currentSubmissionId} />
      <input type="hidden" name="businessName" value={businessName} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="address" value={address} />
      <input type="hidden" name="addressCountry" value={selectedAddress?.country ?? initialSubmissionValues.addressCountry} />
      <input type="hidden" name="addressCountryCode" value={selectedAddress?.countryCode ?? initialSubmissionValues.addressCountryCode} />
      <input type="hidden" name="addressLatitude" value={selectedAddress?.latitude ?? initialSubmissionValues.addressLatitude} />
      <input type="hidden" name="addressLongitude" value={selectedAddress?.longitude ?? initialSubmissionValues.addressLongitude} />
      <input type="hidden" name="addressLocality" value={selectedAddress?.locality ?? initialSubmissionValues.addressLocality} />
      <input type="hidden" name="addressPlaceId" value={selectedAddress?.placeId ?? initialSubmissionValues.addressPlaceId} />
      <input type="hidden" name="addressPostalCode" value={selectedAddress?.postalCode ?? initialSubmissionValues.addressPostalCode} />
      <input type="hidden" name="addressProvince" value={selectedAddress?.administrativeAreaLevel2 ?? initialSubmissionValues.addressProvince} />
      <input type="hidden" name="addressRegion" value={selectedAddress?.administrativeAreaLevel1 ?? initialSubmissionValues.addressRegion} />
      <input type="hidden" name="addressRoute" value={selectedAddress?.route ?? initialSubmissionValues.addressRoute} />
      <input type="hidden" name="addressStreetNumber" value={selectedAddress?.streetNumber ?? initialSubmissionValues.addressStreetNumber} />
      <input type="hidden" name="townId" value={selectedTownId} />
      <input type="hidden" name="phone" value={businessPhone} />
      <input type="hidden" name="whatsapp" value={businessWhatsapp} />
      <input type="hidden" name="email" value={businessEmail} />
      <input type="hidden" name="website" value={website} />
      <input type="hidden" name="instagram" value={instagram} />
      <input type="hidden" name="facebook" value={facebook} />
      <input type="hidden" name="ownerName" value={ownerName} />
      <input type="hidden" name="ownerPhone" value={ownerContact} />
      <input type="hidden" name="ownerEmail" value={ownerEmail} />
      <input type="hidden" name="ownerHasNoEmail" value={ownerHasNoEmail ? "on" : ""} />
      <input type="hidden" name="businessSummary" value={businessSummary} />
      <input type="hidden" name="shortDescription" value={shortDescriptionValue} />
      <input type="hidden" name="longDescription" value={longDescriptionValue} />
      <input type="hidden" name="openingHours" value={openingHoursValue} />
      <input type="hidden" name="photoUrls" value={photoUrlsValue} />
      <input type="hidden" name="preservedPhotoUrls" value={editMode?.preservedPhotoUrls?.join("\n") ?? ""} />
      <input type="hidden" name="signerFullName" value={signerFullName} />
      <input type="hidden" name="signerRole" value={signerRole} />
      <input type="hidden" name="signerRoleOther" value={signerRoleOther} />
      <input type="hidden" name="agreementSignature" value={signature} />
      <input type="hidden" name="agreement" value={agreementAccepted ? "on" : ""} />
      <input ref={paymentMethodInputRef} type="hidden" name="paymentMethod" value={paymentMethod} readOnly />
      <input type="hidden" name="renewalPreference" value={effectiveRenewalPreference} readOnly />

      {wizardStep === "business" || isEditMode ? (
        <header className="publish-form-intro">
          <p className="section-kicker mb-2">
            {isEditMode
              ? locale === "it"
                ? "MODIFICA ATTIVITÀ"
                : "EDIT BUSINESS"
              : locale === "it"
                ? "Nuova attività"
                : "New business"}
          </p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">
            {isEditMode
              ? locale === "it"
                ? "Modifica la mia attività"
                : "Edit my business"
              : locale === "it"
                ? "Aggiungi un'attività"
                : "Add a business"}
          </h1>
          <p className="mt-4 max-w-2xl text-[var(--muted)]">
            {isEditMode
              ? locale === "it"
                ? "Aggiorna le informazioni della tua attività su Salento Local."
                : "Update your business information on Salento Local."
              : locale === "it"
                ? "Ti guideremo passo dopo passo per pubblicare questa attività su Salento Local."
                : "We'll guide you through everything you need to get this business listed on Salento Local."}
          </p>
        </header>
      ) : null}

      {collectionIndex >= 0 ? (
        <nav aria-label={locale === "it" ? "Avanzamento raccolta dati" : "Collection progress"} className="publish-step-progress">
          <ol className="publish-step-progress__list">
            {collectionSteps.map((step, index) => (
              <li key={step.key} className="publish-step-progress__item">
                <button
                  type="button"
                  onClick={() => moveToWizardStep(step.key)}
                  aria-current={index === collectionIndex ? "step" : undefined}
                  className={`publish-step-progress__button ${index === collectionIndex ? "publish-step-progress__button--active" : ""}`}
                >
                  <span className="publish-step-progress__number" aria-hidden="true">{index + 1}</span>
                  <span className="publish-step-progress__label">{step.label}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      {ownerProgressIndex >= 0 ? (
        <nav aria-label={locale === "it" ? "Avanzamento conferma del titolare" : "Owner confirmation progress"} className="owner-flow-progress">
          <ol className="owner-flow-progress__list">
            {ownerSteps.map((step, index) => {
              const StepIcon = step.Icon;
              const isCurrent = index === ownerProgressIndex;
              const isComplete = index < ownerProgressIndex;

              return (
                <li key={step.key} className="owner-flow-progress__item">
                  <span
                    aria-current={isCurrent ? "step" : undefined}
                    className={`owner-flow-progress__step ${isCurrent ? "owner-flow-progress__step--active" : ""} ${isComplete ? "owner-flow-progress__step--complete" : ""}`}
                  >
                    <span className="owner-flow-progress__icon" aria-hidden="true">
                      {isComplete ? <IconCheck size={17} /> : <StepIcon size={18} />}
                    </span>
                    <span className="owner-flow-progress__label">
                      <span className="owner-flow-progress__label-full">{step.label}</span>
                      <span className="owner-flow-progress__label-short">{step.shortLabel}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      {draftNotice && (state.error || !["Draft saved. You can keep working here or find it again in your drafts.", "Bozza salvata. Puoi continuare da qui oppure ritrovarla nelle tue bozze."].includes(draftNotice) || wizardStep !== "agreement") ? <p ref={errorNoticeRef} role="status" className="rounded-2xl border border-[rgba(191,91,42,0.2)] bg-[rgba(255,248,243,0.9)] px-4 py-3 text-sm text-[var(--foreground)]">{draftNotice}</p> : null}

      {adminMode && wizardStep === "payment" ? <button type="button" onClick={continueAdminPublication} className="btn-primary mx-auto w-full max-w-3xl">{copy.continueToPublish}</button> : null}

      <div className={`publish-form-card card overflow-visible sm:overflow-hidden ${wizardStep === "hours" ? "publish-form-card-hours" : ""} ${wizardStep === "agreement" ? "publish-form-card--agreement" : ""}`}>
      <section className="publish-form-content p-5 sm:p-7">
        {wizardStep === "business" ? <div className="grid gap-5">
          <div><p className="section-kicker">1. {locale === "it" ? "Attività" : "Business"}</p><h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">{isEditMode ? (locale === "it" ? "Modifica la mia attività" : "Edit my business") : (locale === "it" ? "Quale attività stai aggiungendo?" : "Which business are you adding?")}</h1><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{isEditMode ? (locale === "it" ? "Aggiorna il nome, la categoria o l'indirizzo e scegli un nuovo indirizzo verificato se lo modifichi." : "Update the name, category, or address. If you change the address, select a new verified result.") : (locale === "it" ? "Chiedi il nome esatto, poi cerca e seleziona l'indirizzo verificato." : "Ask for the exact name, then search and select the verified address.")}</p></div>
          <label className="field-label"><FieldLabel title={copy.businessName} required={copy.required} /><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} className={getFieldInputClass(hasFieldError("businessName"))} /></label>
          <label className="field-label"><FieldLabel title={copy.category} required={copy.required} /><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={getFieldInputClass(hasFieldError("categoryId"))}><option value="">{locale === "it" ? "Seleziona" : "Select"}</option>{categories.map((category) => <option key={category.id} value={category.id}>{getCategoryLabel(category.slug, category.name, locale)}</option>)}</select></label>
          <div className="field-label"><FieldLabel title={copy.address} description={copy.addressHelp} required={copy.required} /><AddressAutocomplete initialGooglePlacesApiKey={googlePlacesApiKey} locale={locale} query={address} selectedAddress={selectedAddress} onQueryChange={setAddress} onSelectedAddressChange={setSelectedAddress} clientError={addressSelectionError} emphasizeError={addressSelectionError === copy.addressUnsupportedTown} onClientErrorChange={setAddressSelectionError} serverError={state.fieldErrors?.address} />{selectedAddress ? <p className="rounded-2xl bg-[rgba(42,98,87,0.08)] px-4 py-3 text-sm text-[var(--foreground)]">✓ {buildStreetAddressLine(selectedAddress)}<br />{selectedAddress.locality}, {selectedAddress.administrativeAreaLevel2} {selectedAddress.postalCode}</p> : null}</div>
        </div> : null}

        {wizardStep === "contact" ? <div className="grid gap-5">
          <div><p className="section-kicker">2. {locale === "it" ? "Contatti pubblici" : "Public contact"}</p><h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">{locale === "it" ? "Come possono contattarli i clienti?" : "How can customers contact them?"}</h1>{firstSubmission ? <p className="mt-3 rounded-2xl bg-[rgba(42,98,87,0.08)] p-4 text-sm text-[var(--foreground)]">{locale === "it" ? "Chiedi al titolare: Qual e il numero migliore per contattarti?" : "Ask the owner: What's the best number customers should use to contact you?"}</p> : null}<p className="mt-3 text-sm text-[var(--muted)]">{locale === "it" ? "Questi dati possono comparire pubblicamente nella scheda." : "These details may appear publicly on the listing."}</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><label className="field-label"><FieldLabel title={copy.businessPhone} required={copy.required} /><div className="grid grid-cols-[7.25rem_minmax(0,1fr)] gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]"><PhoneCountrySelector value={businessPhoneParts.country} onChange={(country) => setBusinessPhoneParts({ ...businessPhoneParts, country })} options={phoneCountryOptions} aria-label={copy.phoneCode} aria-invalid={hasBusinessPhoneError} /><input value={businessPhoneParts.number} onChange={(event) => setBusinessPhoneParts({ ...businessPhoneParts, number: normalizeEditablePhoneNumberInput(event.target.value) })} inputMode="tel" className="input-field" /></div><FieldError message={businessPhoneErrorMessage} /></label><label className="field-label"><FieldLabel title={copy.whatsapp} optional={copy.optional} /><div className="grid grid-cols-[7.25rem_minmax(0,1fr)] gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]"><PhoneCountrySelector value={businessWhatsappParts.country} onChange={(country) => setBusinessWhatsappParts({ ...businessWhatsappParts, country })} options={phoneCountryOptions} aria-label={copy.phoneCode} aria-invalid={hasBusinessWhatsappError} /><input value={businessWhatsappParts.number} onChange={(event) => setBusinessWhatsappParts({ ...businessWhatsappParts, number: normalizeEditablePhoneNumberInput(event.target.value) })} inputMode="tel" className="input-field" /></div></label><label className="field-label"><FieldLabel title={copy.businessEmail} optional={copy.optional} /><input type="email" value={businessEmail} onChange={(event) => setBusinessEmail(event.target.value)} className="input-field" /></label><label className="field-label"><FieldLabel title="Website" optional={copy.optional} /><input value={website} onChange={(event) => setWebsite(event.target.value)} className="input-field" placeholder="https://" /></label><label className="field-label"><FieldLabel title="Instagram" optional={copy.optional} /><SocialHandleInput hasError={hasFieldError("instagram")} value={instagram} onChange={setInstagram} /></label><label className="field-label"><FieldLabel title="Facebook" optional={copy.optional} /><SocialHandleInput hasError={hasFieldError("facebook")} value={facebook} onChange={setFacebook} /></label></div>
        </div> : null}

        {wizardStep === "owner" ? <div className="grid gap-5"><div><p className="section-kicker">3. {locale === "it" ? "Titolare" : "Owner"}</p><h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">{locale === "it" ? "Con chi stai parlando?" : "Who are you speaking with?"}</h1><p className="mt-3 rounded-2xl border border-[rgba(42,98,87,0.16)] bg-[rgba(247,244,239,0.7)] p-4 text-sm leading-6 text-[var(--foreground)]"><strong>{locale === "it" ? "Informazioni private." : "Private information."}</strong> {locale === "it" ? "Servono per approvazione e comunicazioni: non compariranno nella scheda pubblica." : "These are used for approval and communication and will not appear on the public listing."}</p></div><div className="grid gap-4 sm:grid-cols-2"><label className="field-label self-start"><FieldLabel title={copy.ownerName} required={copy.required} /><input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} className="input-field" /></label><label className="field-label"><FieldLabel title={copy.ownerWhatsapp} required={copy.required} /><div className="grid grid-cols-[7.25rem_minmax(0,1fr)] gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]"><PhoneCountrySelector value={ownerContactParts.country} onChange={(country) => { setOwnerMatchesBusinessWhatsapp(false); setOwnerContactParts({ ...ownerContactParts, country }); }} options={phoneCountryOptions} aria-label={copy.phoneCode} aria-invalid={hasOwnerPhoneError} /><input value={ownerContactParts.number} onChange={(event) => { setOwnerMatchesBusinessWhatsapp(false); setOwnerContactParts({ ...ownerContactParts, number: normalizeEditablePhoneNumberInput(event.target.value) }); }} inputMode="tel" className="input-field" aria-invalid={hasOwnerPhoneError} /></div><FieldError message={ownerPhoneErrorMessage} /><CopyToggle checked={ownerMatchesBusinessWhatsapp} onChange={(checked) => { setOwnerMatchesBusinessWhatsapp(checked); if (checked) setOwnerContactParts(businessPhoneParts); }} label={copy.sameAsBusinessPhone} /></label><label className="field-label sm:col-span-2"><FieldLabel title={copy.ownerEmail} required={ownerHasNoEmail ? undefined : copy.required} /><input type="email" value={ownerEmail} disabled={ownerHasNoEmail} onChange={(event) => setOwnerEmail(event.target.value)} className="input-field disabled:opacity-60" /><CopyToggle checked={ownerHasNoEmail} onChange={(checked) => { setOwnerHasNoEmail(checked); if (checked) { setOwnerEmail(""); setRenewalPreference("MANUAL"); } }} label={copy.noEmail} /></label></div></div> : null}

        {wizardStep === "about" ? <div className="grid gap-5"><div><p className="section-kicker">4. {locale === "it" ? "Descrizione" : "About"}</p><h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">{locale === "it" ? "Raccontaci dell'attività" : "Tell us about the business"}</h1>{firstSubmission ? <p className="mt-3 rounded-2xl bg-[rgba(42,98,87,0.08)] p-4 text-sm">{locale === "it" ? "Chiedi: Cosa vorresti che chi visita il Salento sapesse della tua attività?" : "Ask: What would you like people visiting Salento to know about your business?"}</p> : null}</div><div className="grid gap-3"><FieldLabel title={copy.sellOrOffer} description={locale === "it" ? "Aggiungi almeno due punti." : "Add at least two points."} required={copy.required} />{offerItems.map((item, index) => <div key={index} className="flex gap-2"><input ref={(node) => { offerInputRefs.current[index] = node; }} value={item} onChange={(event) => updateOfferItem(index, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addOfferItem(index); } }} className="input-field" placeholder={copy.sellOrOfferPlaceholder} /><button type="button" onClick={() => removeOfferItem(index)} className="btn-secondary px-3" aria-label={copy.removeBullet}><IconTrash size={18} /></button></div>)}<button type="button" onClick={() => addOfferItem()} className="btn-secondary w-fit"><IconPlus size={18} /> {locale === "it" ? "Aggiungi un altro" : "Add another"}</button></div><label className="field-label"><FieldLabel title={copy.businessSummary} optional={copy.optional} /><textarea value={businessSummary} onChange={(event) => setBusinessSummary(event.target.value)} className="input-field min-h-28" placeholder={copy.businessSummaryPlaceholder} /></label></div> : null}

        {wizardStep === "hours" ? (
          <div className="hours-step grid gap-4">
            <div>
              <p className="section-kicker">5. {locale === "it" ? "Orari" : "Hours"}</p>
              <h1 className="mt-2 font-serif text-[2rem] leading-[1.1] text-[var(--foreground)] sm:text-3xl">
                {locale === "it" ? "Quando sono aperti?" : "When are they open?"}
              </h1>
            </div>

            <button
              type="button"
              onClick={() => applyTemplateToAll(hours[0])}
              className="btn-secondary w-fit"
            >
              <IconCopy size={18} aria-hidden="true" />
              {copy.copyMonday}
            </button>

              <div className="hours-mobile-days grid gap-2.5 md:hidden">
              {hours.map((day) => {
                const dayName = locale === "it"
                  ? days.find((entry) => entry.key === day.day)?.it
                  : days.find((entry) => entry.key === day.day)?.en;
                const openLabel = copy.hoursOpen;
                const closeLabel = copy.hoursClose;

                return (
                  <article
                    key={day.day}
                    className="hours-mobile-day-card grid gap-3 rounded-[1.25rem] border border-[var(--border)] bg-[rgba(247,244,239,0.56)] p-4"
                    aria-label={dayName}
                  >
                    <div className="flex items-center justify-between gap-3">
                        <strong className="text-[1.05rem] leading-6 text-[var(--foreground)]">{dayName}</strong>
                        <CopyToggle
                          checked={day.closed}
                          onChange={(checked) => setHourValue(day.day, "closed", checked)}
                          label={copy.dayClosed}
                          className="shrink-0"
                          inputClassName="hours-checkbox"
                        />
                    </div>

                    <div className="hours-time-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
                        <label className="grid min-w-0 gap-1">
                          <span className="text-sm leading-5 text-[var(--muted)]">{openLabel}</span>
                          <HoursTimeInput
                            ariaLabel={`${dayName}: ${locale === "it" ? "apertura" : "opening"}`}
                            disabled={day.closed}
                            value={day.open1}
                            onChange={(value) => setHourValue(day.day, "open1", value)}
                          />
                        </label>
                        <span className="hours-time-separator pb-3 text-lg text-[var(--muted)]" aria-hidden="true">–</span>
                        <label className="grid min-w-0 gap-1">
                          <span className="text-sm leading-5 text-[var(--muted)]">{closeLabel}</span>
                          <HoursTimeInput
                            ariaLabel={`${dayName}: ${locale === "it" ? "chiusura" : "closing"}`}
                            disabled={day.closed}
                            value={day.close1}
                            onChange={(value) => setHourValue(day.day, "close1", value)}
                          />
                        </label>
                    </div>

                    <div className="grid gap-2">
                      <CopyToggle
                        checked={day.split}
                        disabled={day.closed}
                        onChange={(checked) => setHourValue(day.day, "split", checked)}
                        label={copy.splitHours}
                        className="w-fit"
                        inputClassName="hours-checkbox"
                      />

                      {day.split && !day.closed ? (
                        <div className="hours-time-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
                          <label className="grid min-w-0 gap-1">
                            <span className="text-sm leading-5 text-[var(--muted)]">{openLabel}</span>
                            <HoursTimeInput
                              ariaLabel={`${dayName}: ${locale === "it" ? "apertura serale" : "evening opening"}`}
                              value={day.open2}
                              onChange={(value) => setHourValue(day.day, "open2", value)}
                            />
                          </label>
                          <span className="hours-time-separator pb-3 text-lg text-[var(--muted)]" aria-hidden="true">–</span>
                          <label className="grid min-w-0 gap-1">
                            <span className="text-sm leading-5 text-[var(--muted)]">{closeLabel}</span>
                            <HoursTimeInput
                              ariaLabel={`${dayName}: ${locale === "it" ? "chiusura serale" : "evening closing"}`}
                              value={day.close2}
                              onChange={(value) => setHourValue(day.day, "close2", value)}
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

              <div className="hours-desktop-days hidden gap-3 md:grid">
              {hours.map((day) => {
                const dayName = locale === "it"
                  ? days.find((entry) => entry.key === day.day)?.it
                  : days.find((entry) => entry.key === day.day)?.en;

                return (
                  <div
                    key={day.day}
                    className="rounded-2xl border border-[var(--border)] bg-[rgba(247,244,239,0.56)] p-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr_auto]">
                      <div className="flex items-center justify-between gap-2">
                        <strong>{dayName}</strong>
                        <CopyToggle
                          checked={day.closed}
                          onChange={(checked) => setHourValue(day.day, "closed", checked)}
                          label={copy.dayClosed}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="time"
                          aria-label={`${dayName}: ${locale === "it" ? "apertura" : "opening"}`}
                          disabled={day.closed}
                          value={day.open1}
                          onChange={(event) => setHourValue(day.day, "open1", event.target.value)}
                          className="input-field"
                        />
                        <input
                          type="time"
                          aria-label={`${dayName}: ${locale === "it" ? "chiusura" : "closing"}`}
                          disabled={day.closed}
                          value={day.close1}
                          onChange={(event) => setHourValue(day.day, "close1", event.target.value)}
                          className="input-field"
                        />
                      </div>
                      <div className="grid gap-3">
                        <CopyToggle
                          checked={day.split}
                          disabled={day.closed}
                          onChange={(checked) => setHourValue(day.day, "split", checked)}
                          label={copy.splitHours}
                        />
                        {day.split && !day.closed ? (
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="time"
                              aria-label={`${dayName}: ${locale === "it" ? "apertura serale" : "evening opening"}`}
                              value={day.open2}
                              onChange={(event) => setHourValue(day.day, "open2", event.target.value)}
                              className="input-field"
                            />
                            <input
                              type="time"
                              aria-label={`${dayName}: ${locale === "it" ? "chiusura serale" : "evening closing"}`}
                              value={day.close2}
                              onChange={(event) => setHourValue(day.day, "close2", event.target.value)}
                              className="input-field"
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {wizardStep === "photos" ? (
          <div className="grid gap-5">
            <div>
              <p className="section-kicker">6. {locale === "it" ? "Foto" : "Photos"}</p>
              <h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">
                {locale === "it" ? "Aggiungi qualche foto" : "Add some photos"}
              </h1>
              <p className="mt-3 text-sm text-[var(--muted)]">
                {locale === "it"
                  ? "Buone foto aiutano le persone a capire il posto prima di visitarlo."
                  : "Good photos help people understand the business before they visit."}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {visiblePhotoSlots.map((slot) => {
                const required = slot === "exterior" || slot === "interior";
                const label = slot === "exterior"
                  ? copy.exteriorPhoto
                  : slot === "interior"
                    ? copy.interiorPhoto
                    : `${copy.photoOptional} ${slot.replace("extra", "")}`;
                const description = slot === "exterior"
                  ? locale === "it"
                    ? "Mostra l'ingresso o la facciata."
                    : "Show the entrance or storefront."
                  : slot === "interior"
                    ? locale === "it"
                      ? "Mostra l'atmosfera del locale."
                      : "Show what the space feels like."
                    : copy.photoHint;
                const image = previewUrls[slot] || photos[slot];
                const inputId = `submission-photo-${slot}`;
                const isUploading = Boolean(uploadingSlots[slot]);

                return (
                  <article key={slot} className="photo-upload-card">
                    <div>
                      <p className="photo-upload-card__title">{label}{required ? " *" : ""}</p>
                      <p className="photo-upload-card__description">{description}</p>
                    </div>
                    <input
                      ref={(node) => { photoInputRefs.current[slot] = node; }}
                      id={inputId}
                      type="file"
                      accept="image/*"
                      disabled={isUploading}
                      aria-label={`${label}${required ? " (required)" : ""}`}
                      className="peer sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        void handlePhotoChange(slot, file);
                      }}
                    />
                    {image ? (
                      <>
                        <div className="photo-upload-card__preview">
                          <img src={image} alt={label} />
                        </div>
                        <div className="photo-upload-card__actions">
                          <label htmlFor={inputId} className="photo-upload-card__replace" aria-disabled={isUploading}>
                            <IconCamera size={18} aria-hidden="true" />
                            {copy.photoReplace}
                          </label>
                          <button
                            type="button"
                            onClick={() => removePhoto(slot)}
                            disabled={isUploading}
                            className="photo-upload-card__remove"
                          >
                            <IconTrash size={17} aria-hidden="true" />
                            {copy.photoRemove}
                          </button>
                        </div>
                      </>
                    ) : (
                      <label htmlFor={inputId} className="photo-upload-card__empty" aria-disabled={isUploading}>
                        <span className="photo-upload-card__empty-icon" aria-hidden="true">
                          <IconPhoto size={30} strokeWidth={1.8} />
                          <IconPlus size={16} />
                        </span>
                        <span className="photo-upload-card__empty-title">
                          {isUploading ? copy.photoUploading : copy.photoChoose}
                        </span>
                        <span className="photo-upload-card__empty-hint">{copy.photoChooseHint}</span>
                      </label>
                    )}
                    {isUploading ? <span className="photo-upload-card__uploading" role="status">{copy.photoUploading}</span> : null}
                  </article>
                );
              })}
            </div>
            {visibleExtraPhotoCount < optionalPhotoSlots.length ? (
              <button
                type="button"
                onClick={() => setVisibleExtraPhotoCount((count) => count + 1)}
                className="photo-upload-card__add btn-secondary w-full"
              >
                <IconPlus size={18} aria-hidden="true" /> {copy.photoAdd}
              </button>
            ) : null}
            <FieldError message={uploadError} />
          </div>
        ) : null}

        {wizardStep === "review" ? (
          <div className="grid gap-6">
            <div>
              <p className="section-kicker">{locale === "it" ? "Controlla il tuo lavoro" : "Check your work"}</p>
              <h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">
                {locale === "it" ? "È tutto corretto?" : "Everything look right?"}
              </h1>
              <p className="mt-3 text-[var(--muted)]">
                {locale === "it"
                  ? "Dai un'ultima occhiata prima di consegnare il telefono al titolare."
                  : "Take a quick look before handing the phone to the owner."}
              </p>
            </div>
            <div className="rounded-[1.6rem] border border-[rgba(42,98,87,0.14)] bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
              {renderBusinessSummary("partner-review")}
            </div>
            <div className="review-section-edits" aria-label={locale === "it" ? "Modifica una sezione" : "Edit a section"}>
              {[
                ["business", locale === "it" ? "Attività" : "Business"],
                ["contact", locale === "it" ? "Contatti" : "Contact"],
                ["about", locale === "it" ? "Descrizione" : "About"],
                ["hours", locale === "it" ? "Orari" : "Opening hours"],
                ["photos", locale === "it" ? "Foto" : "Photos"],
              ].map(([step, label]) => (
                <button key={step} type="button" onClick={() => moveToWizardStep(step as WizardStep)} className="review-section-edits__button">
                  <span>{label}</span>
                  <span>{locale === "it" ? "Modifica" : "Edit"}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" disabled={actionPending} onClick={checkForExistingBusinesses} className="btn-primary disabled:cursor-wait disabled:opacity-50">
                {actionPending ? (locale === "it" ? "Controllo..." : "Checking...") : isPartnerFlow ? <>{locale === "it" ? "Consegna il telefono al titolare" : "Hand phone to owner"}<IconArrowRight size={18} aria-hidden="true" /></> : <>{locale === "it" ? "Continua" : "Continue"}<IconArrowRight size={18} aria-hidden="true" /></>}
              </button>
            </div>
          </div>
        ) : null}

        {wizardStep === "duplicate-blocked" ? (
          <div className="grid gap-5">
            <div>
              <p className="section-kicker">{locale === "it" ? "Scheda già presente" : "Listing already found"}</p>
              <h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">
                {locale === "it" ? "Questa attività potrebbe già essere su Salento Local" : "This business may already be on Salento Local"}
              </h1>
              <p className="mt-3 text-[var(--muted)]">
                {locale === "it"
                  ? "Per evitare una seconda scheda e un altro pagamento, apri la scheda esistente. Se non è ancora gestita, il titolare può usare Rivendica attività. Se è già gestita, usa l'accesso del titolare dalla dashboard Partner."
                  : "To avoid a second listing and payment, open the existing listing. If it is unclaimed, the owner can use Claim Business. If it is already managed, use Owner access from the Partner dashboard."}
              </p>
            </div>
            {duplicateReviewSection}
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => moveToWizardStep("review")} className="btn-secondary">
                <IconArrowLeft size={18} aria-hidden="true" />{locale === "it" ? "Rivedi i dati" : "Review details"}
              </button>
              <HardNavigationLink href="/dashboard/businesses" className="btn-secondary">
                {locale === "it" ? "Vai alla dashboard" : "Go to dashboard"}
              </HardNavigationLink>
            </div>
          </div>
        ) : null}

        {wizardStep === "handoff" ? <div className="mx-auto grid max-w-xl gap-6 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(42,98,87,0.1)] text-[var(--primary)]"><IconCheck size={28} aria-hidden="true" /></div><div><p className="section-kicker">{locale === "it" ? "Parte del partner completata" : "Partner section complete"}</p><h1 className="mt-3 font-serif text-4xl text-[var(--foreground)]">{locale === "it" ? "Ora consegna il telefono al titolare." : "Now hand the phone to the business owner."}</h1><p className="mx-auto mt-4 max-w-lg text-[var(--muted)]">{locale === "it" ? "Controllerà la scheda e completerà gli ultimi passaggi." : "They’ll confirm the listing and complete the final steps."}</p></div><button type="button" onClick={() => moveToWizardStep("owner-review")} className="btn-primary mx-auto">{locale === "it" ? "Sono il titolare" : "I'm the business owner"}<IconArrowRight size={18} aria-hidden="true" /></button></div> : null}

        {wizardStep === "owner-review" ? <div className="grid gap-6"><div><p className="section-kicker">{ownerFlowCopy.ownerConfirmation}</p><h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">{ownerName ? `${locale === "it" ? "Ciao" : "Hi"} ${ownerName.split(" ")[0]}` : locale === "it" ? "Ciao" : "Hi"}</h1><p className="mt-3 max-w-xl text-[var(--muted)]">{ownerFlowCopy.ownerPrepared}</p></div>{renderOwnerConfirmationSummary()}<label className="owner-confirmation-checkbox"><input type="checkbox" checked={ownerInformationConfirmed} onChange={(event) => setOwnerInformationConfirmed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--primary)]" /><span>{locale === "it" ? "Confermo che questi dati dell'attività sono corretti." : "I confirm that these business details are correct."}</span></label><button type="button" onClick={() => moveToWizardStep("review")} className="owner-confirmation-help">{locale === "it" ? "Qualcosa non va? Chiedi al partner di modificare" : "Something looks wrong? Ask the partner to edit"}</button></div> : null}

        {wizardStep === "agreement" ? (
          <OwnerAgreementStep
            accepted={agreementAccepted}
            businessName={businessName}
            firstYearPriceLabel={firstYearPriceLabel}
            keyTerms={[copy.summaryAuthorized, copy.summaryPublish, copy.summaryPrice, copy.summaryRenewal]}
            locale={locale}
            onAcceptedChange={setAgreementAccepted}
            photoUrl={photos.exterior || photos.interior || undefined}
            privacyLink={privacyLink}
            renewalPriceLabel={renewalPriceLabel}
            termsLink={termsLink}
            townName={towns.find((town) => town.id === selectedTownId)?.name ?? ""}
          />
        ) : null}

        {wizardStep === "signature" ? <div className="grid gap-5"><div><p className="section-kicker">{locale === "it" ? "Firma" : "Sign"}</p><h1 className="font-serif text-3xl text-[var(--foreground)]">{locale === "it" ? "Firma per continuare" : "Sign to continue"}</h1><p className="mt-3 text-[var(--muted)]">{locale === "it" ? "Inserisci i tuoi dati e firma per confermare l'autorizzazione." : "Enter your details and sign to confirm your authorisation."}</p></div><div className="grid gap-4 sm:grid-cols-2"><label className="field-label"><FieldLabel title={copy.signerName} required={copy.required} /><input value={signerFullName} onChange={(event) => setSignerFullName(event.target.value)} className="input-field" /></label><label className="field-label"><FieldLabel title={copy.signerRole} required={copy.required} /><select value={signerRole} onChange={(event) => setSignerRole(event.target.value)} className="input-field"><option value="">{copy.signerRolePlaceholder}</option>{signerRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>{signerRoleRequiresOther ? <label className="field-label"><FieldLabel title={copy.signerRoleOther} required={copy.required} /><input value={signerRoleOther} onChange={(event) => setSignerRoleOther(event.target.value)} className="input-field" /></label> : null}<div className="field-label"><FieldLabel title={copy.signatureTitle} description={copy.signatureIntro} required={copy.required} /><SignaturePad clearLabel={copy.clearSignature} drawHint={copy.signatureDrawHint} hasError={hasFieldError("agreementSignature")} legacyValueNotice={copy.signatureLegacyNotice} value={signature} onChange={setSignature} /></div></div> : null}

        {wizardStep === "payment" ? <div className="grid gap-6"><div><p className="section-kicker">{locale === "it" ? "Pagamento" : "Payment"}</p><h1 className="mt-2 font-serif text-4xl text-[var(--foreground)]">{locale === "it" ? "Come preferiscono pagare?" : "How would they like to pay?"}</h1><p className="mt-3 text-[var(--muted)]">{locale === "it" ? "Chiedi al titolare quale opzione preferisce." : "Ask the business owner which option they prefer."}</p></div>{!adminMode ? <section className="rounded-[1.6rem] border border-[rgba(42,98,87,0.28)] bg-[rgba(237,248,242,0.52)] p-5 sm:p-6"><p className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--primary)]">{locale === "it" ? "Rinnovo" : "Renewal"}</p><div className="mt-4 grid gap-3">{ownerEmail.trim() ? <label className={effectiveRenewalPreference === "AUTO" ? "block cursor-pointer rounded-[1.3rem] border border-[var(--primary)] bg-white p-4 shadow-[0_0_0_2px_rgba(42,98,87,0.12)] transition-colors sm:p-5" : "block cursor-pointer rounded-[1.3rem] border border-[var(--border)] bg-white p-4 transition-colors hover:border-[rgba(42,98,87,0.48)] sm:p-5"}><span className="flex items-start gap-3"><input type="radio" name="renewalChoice" value="AUTO" checked={renewalPreference === "AUTO"} onChange={() => setRenewalPreference("AUTO")} className="mt-1 h-5 w-5 shrink-0 accent-[var(--primary)]" /><span><span className="font-semibold text-[var(--foreground)]">{locale === "it" ? "Rinnovo automatico — Consigliato" : "Automatic renewal — Recommended"}</span><span className="mt-2 block text-sm leading-6 text-[var(--muted)]">{locale === "it" ? "€100/anno. Si rinnova automaticamente ogni anno. Puoi disattivare il rinnovo automatico in qualsiasi momento dal tuo account." : "€100/year. Renews automatically every year. Cancel automatic renewal anytime from your account."}</span></span></span></label> : null}<label className={effectiveRenewalPreference === "MANUAL" ? "block cursor-pointer rounded-[1.3rem] border border-[var(--primary)] bg-white p-4 shadow-[0_0_0_2px_rgba(42,98,87,0.12)] transition-colors sm:p-5" : "block cursor-pointer rounded-[1.3rem] border border-[var(--border)] bg-white p-4 transition-colors hover:border-[rgba(42,98,87,0.48)] sm:p-5"}><span className="flex items-start gap-3"><input type="radio" name="renewalChoice" value="MANUAL" checked={effectiveRenewalPreference === "MANUAL"} onChange={() => setRenewalPreference("MANUAL")} className="mt-1 h-5 w-5 shrink-0 accent-[var(--primary)]" /><span><span className="font-semibold text-[var(--foreground)]">{locale === "it" ? "Rinnovo manuale" : "Manual renewal"}</span><span className="mt-2 block text-sm leading-6 text-[var(--muted)]">{locale === "it" ? "€100/anno. Ti ricorderemo prima della scadenza. Dovrai rinnovare manualmente ogni anno." : "€100/year. We’ll remind you before your membership expires. You’ll need to renew manually each year."}</span></span></span></label></div></section> : null}{paymentOpeningError ? <p role="alert" className="rounded-2xl border border-[rgba(191,91,42,0.25)] bg-[rgba(255,248,243,0.96)] px-4 py-3 text-sm font-medium text-[var(--accent)]">{paymentOpeningError}</p> : null}{adminMode ? <div className="rounded-2xl bg-[rgba(42,98,87,0.08)] p-4 text-sm">{locale === "it" ? "Modalita admin: la pubblicazione non richiede il pagamento." : "Admin mode: publication does not require payment."}</div> : <div className="grid gap-5 lg:grid-cols-2"><article className="flex flex-col rounded-[1.6rem] border-[1.5px] border-[rgba(42,98,87,0.42)] bg-white p-5 shadow-[0_12px_30px_rgba(42,98,87,0.08)] sm:p-6"><div className="flex items-center justify-between gap-3"><span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(42,98,87,0.1)] text-[var(--primary)]"><IconQrcode size={23} /></span><span className="rounded-full bg-[rgba(42,98,87,0.1)] px-3 py-1.5 text-[0.68rem] font-bold tracking-[0.12em] text-[var(--primary)]">{locale === "it" ? "CONSIGLIATO" : "RECOMMENDED"}</span></div><h2 className="mt-5 font-serif text-2xl text-[var(--foreground)]">{locale === "it" ? "Paga ora dal telefono" : "Pay now by phone"}</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{locale === "it" ? "Il titolare paga in sicurezza dal proprio telefono." : "The owner pays securely on their own phone."}</p><div className="mt-5 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1 rounded-2xl bg-[rgba(247,244,239,0.65)] p-3 text-center text-[0.7rem] font-semibold text-[var(--foreground)] sm:gap-2 sm:p-4"><span><b className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full border border-[var(--border)] bg-white text-[var(--primary)]">1</b>{locale === "it" ? "Mostra QR" : "Show QR"}</span><span className="text-[var(--muted)]">→</span><span><b className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full border border-[var(--border)] bg-white text-[var(--primary)]">2</b>{locale === "it" ? "Scansiona" : "Owner scans"}</span><span className="text-[var(--muted)]">→</span><span><b className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full border border-[var(--border)] bg-white text-[var(--primary)]">3</b>{locale === "it" ? "Paga" : "Owner pays"}</span></div><p className="mt-4 text-center text-xs text-[var(--muted)]">Card <span className="mx-1 text-[var(--border)]">•</span> Apple Pay <span className="mx-1 text-[var(--border)]">•</span> Google Pay</p><PaymentChoiceButton method="ONLINE" disabled={actionPending || Boolean(paymentOpeningMethod)} onSelect={continueWithPaymentMethod} className="btn-primary mt-5 min-h-12 w-full disabled:cursor-wait disabled:opacity-60"><IconQrcode size={18} />{paymentOpeningMethod === "ONLINE" ? (locale === "it" ? "Apertura..." : "Opening...") : locale === "it" ? "Mostra QR di pagamento" : "Show payment QR"}</PaymentChoiceButton></article><article className="flex flex-col rounded-[1.6rem] border border-[var(--border)] bg-white p-5 sm:p-6"><div className="flex items-center justify-between"><span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(128,110,85,0.1)] text-[#806e55]"><IconCashBanknote size={23} /></span></div><h2 className="mt-5 font-serif text-2xl text-[var(--foreground)]">{locale === "it" ? "Paga con bonifico" : "Pay by bank transfer"}</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{locale === "it" ? "Usa questa opzione se il titolare preferisce fare un bonifico." : "Use this if the owner prefers to make a transfer."}</p><div className="mt-5 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1 rounded-2xl bg-[rgba(247,244,239,0.65)] p-3 text-center text-[0.7rem] font-semibold text-[var(--foreground)] sm:gap-2 sm:p-4"><span><b className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full border border-[var(--border)] bg-white text-[#806e55]">1</b>{locale === "it" ? "Mostra QR" : "Show QR"}</span><span className="text-[var(--muted)]">→</span><span><b className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full border border-[var(--border)] bg-white text-[#806e55]">2</b>{locale === "it" ? "Scansiona" : "Owner scans"}</span><span className="text-[var(--muted)]">→</span><span><b className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full border border-[var(--border)] bg-white text-[#806e55]">3</b>{locale === "it" ? "Segui le istruzioni" : "Follow instructions"}</span></div><div className="mt-4 flex items-start gap-2 text-xs leading-5 text-[var(--muted)]"><IconReceipt2 size={17} className="mt-0.5 shrink-0 text-[var(--accent)]" />{locale === "it" ? "La scheda va online dopo la ricezione del bonifico." : "The listing goes live after the transfer is received."}</div><PaymentChoiceButton method="BANK_TRANSFER" disabled={actionPending || Boolean(paymentOpeningMethod)} onSelect={continueWithPaymentMethod} className="btn-secondary mt-5 min-h-12 w-full disabled:cursor-wait disabled:opacity-60"><IconQrcode size={18} />{paymentOpeningMethod === "BANK_TRANSFER" ? (locale === "it" ? "Apertura..." : "Opening...") : locale === "it" ? "Mostra QR del bonifico" : "Show bank transfer QR"}</PaymentChoiceButton></article></div>}</div> : null}
      </section>

      {showWizardFooter ? <div className={`publish-form-footer flex flex-wrap justify-end gap-3 border-t border-[rgba(42,98,87,0.12)] bg-[rgba(255,255,255,0.72)] p-3 sm:p-4 ${collectionIndex >= 0 ? `collection-wizard-footer ${previousWizardStep ? "collection-wizard-footer--with-back" : "collection-wizard-footer--without-back"}` : ""} ${specialFooterStep ? "special-wizard-footer" : ""}`}>
        {specialFooterStep ? <>
        {wizardStep === "agreement" ? <button type="button" disabled={!agreementAccepted || draftSavePending || actionPending} onClick={() => requestDraftSave("autosave", false, "signature")} className="special-wizard-footer__primary btn-primary min-h-12 w-full disabled:cursor-wait disabled:opacity-50">{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : locale === "it" ? "Continua alla firma" : "Continue to signature"}</button> : null}
        {wizardStep === "signature" ? <button type="button" disabled={draftSavePending || actionPending} onClick={() => { if (!isPaymentApprovalReady({ signature, signerFullName, signerRole, signerRoleOther })) { setDraftNotice(locale === "it" ? "Completa il nome completo, il ruolo e la firma." : "Complete the full name, role, and signature."); return; } requestDraftSave("autosave", false, "payment"); }} className="special-wizard-footer__primary btn-primary min-h-12 w-full disabled:cursor-wait disabled:opacity-50">{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : locale === "it" ? "Continua al pagamento →" : "Continue to payment →"}</button> : null}
        <div className="special-wizard-footer__navigation flex w-full flex-nowrap items-center justify-between gap-3">
          {previousWizardStep ? <button type="button" disabled={draftSavePending || actionPending} onClick={goToPreviousStep} className="btn-secondary min-w-0 disabled:cursor-wait disabled:opacity-50"><IconArrowLeft size={18} aria-hidden="true" />{locale === "it" ? "Indietro" : "Back"}</button> : <span />}
          <button type="button" disabled={draftSavePending || actionPending} onClick={() => requestDraftSave("manual", true)} className="btn-secondary min-w-0 disabled:cursor-wait disabled:opacity-50"><IconDeviceFloppy size={18} aria-hidden="true" />{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : locale === "it" ? "Salva ed esci" : "Save & exit"}</button>
        </div>
        </> : <>
        {previousWizardStep ? <button type="button" disabled={draftSavePending || actionPending} onClick={goToPreviousStep} className="btn-secondary disabled:cursor-wait disabled:opacity-50">{showFooterButtonIcons ? <IconArrowLeft size={18} aria-hidden="true" /> : null}{locale === "it" ? "Indietro" : "Back"}</button> : null}
        {!(isEditMode && wizardStep === "photos") ? <button type="button" disabled={draftSavePending || actionPending} onClick={() => requestDraftSave("manual", true)} className="btn-secondary disabled:cursor-wait disabled:opacity-50">{showFooterButtonIcons && !(draftSavePending || actionPending) ? <IconDeviceFloppy size={18} aria-hidden="true" /> : null}{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : locale === "it" ? "Salva ed esci" : "Save & exit"}</button> : null}
        {wizardStep === "business" ? <button type="button" disabled={draftSavePending || actionPending} onClick={() => goToNextStep("contact")} className="btn-primary disabled:cursor-wait disabled:opacity-50">{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : <>{locale === "it" ? "Continua" : "Continue"}<IconArrowRight size={18} aria-hidden="true" /></>}</button> : null}
        {wizardStep === "contact" ? <button type="button" disabled={draftSavePending || actionPending} onClick={() => goToNextStep("owner")} className="btn-primary disabled:cursor-wait disabled:opacity-50">{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : <>{locale === "it" ? "Continua" : "Continue"}<IconArrowRight size={18} aria-hidden="true" /></>}</button> : null}
        {wizardStep === "owner" ? <button type="button" disabled={draftSavePending || actionPending} onClick={() => goToNextStep("about")} className="btn-primary disabled:cursor-wait disabled:opacity-50">{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : <>{locale === "it" ? "Continua" : "Continue"}<IconArrowRight size={18} aria-hidden="true" /></>}</button> : null}
        {wizardStep === "about" ? <button type="button" disabled={draftSavePending || actionPending} onClick={() => goToNextStep("hours")} className="btn-primary disabled:cursor-wait disabled:opacity-50">{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : <>{locale === "it" ? "Continua" : "Continue"}<IconArrowRight size={18} aria-hidden="true" /></>}</button> : null}
        {wizardStep === "hours" ? <button type="button" disabled={draftSavePending || actionPending} onClick={() => goToNextStep("photos")} className="btn-primary disabled:cursor-wait disabled:opacity-50">{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : <>{locale === "it" ? "Continua" : "Continue"}<IconArrowRight size={18} aria-hidden="true" /></>}</button> : null}
        {wizardStep === "photos" ? <button type="button" disabled={draftSavePending || actionPending} onClick={() => isEditMode ? requestDraftSave("manual", true, null, "listing") : goToNextStep("review")} className="btn-primary disabled:cursor-wait disabled:opacity-50">{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : isEditMode ? (locale === "it" ? "Salva e visualizza la mia scheda" : "Save & view my listing") : <>{locale === "it" ? "Rivedi l'attività" : "Review business"}<IconArrowRight size={18} aria-hidden="true" /></>}</button> : null}
        {wizardStep === "owner-review" ? <button type="button" disabled={!ownerInformationConfirmed || draftSavePending || actionPending} onClick={() => requestDraftSave("autosave", false, "agreement")} className="btn-primary disabled:cursor-wait disabled:opacity-50">{draftSavePending || actionPending ? (locale === "it" ? "Salvataggio..." : "Saving...") : locale === "it" ? "Continua" : "Continue"}</button> : null}
        </>}
      </div> : null}
      </div>
    </form>
  );

}
