import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PaymentPurpose, PaymentRecordMethod, PaymentStatus, UserRole } from "@prisma/client";

import { hasSmtpConfiguration } from "@/lib/claim-delivery";
import { formatCurrencyFromCents } from "@/lib/account";
import {
  hasResendConfiguration,
  sendTransactionalEmail,
} from "@/lib/email";
import type { Locale } from "@/lib/i18n";
import { LISTING_OFFER } from "@/lib/listing-offer";
import { addUtcDays, BUSINESS_MEMBERSHIP_PERIOD_DAYS } from "@/lib/business-membership";
import { LEGAL_ROUTES } from "@/lib/legal";
import { getAppUrl } from "@/lib/payment";
import {
  buildOwnerListingEmailCopy,
  canManageBusiness,
  sendOwnerAccessInvitationForSubmission,
} from "@/lib/business-owner-access";
import { prisma } from "@/lib/prisma";

type ReceiptSubmission = {
  address: string;
  agreementSignature: string | null;
  amountPaidCents: number;
  automaticRenewalAtAcceptance: boolean | null;
  businessName: string;
  businessTermsAcceptedAt: Date | null;
  businessTermsVersion: string | null;
  createdAt: Date;
  contractualEmail: string | null;
  email: string;
  firstYearPriceCentsAtAcceptance: number | null;
  id: string;
  listingTermMonthsAtAcceptance: number | null;
  ownerEmail: string;
  ownerHasNoEmail: boolean;
  paymentStatus: PaymentStatus;
  privacyPolicyVersionPresented: string | null;
  purchaseConfirmationSentAt: Date | null;
  renewalPriceCentsAtAcceptance: number | null;
  signedAt: Date | null;
  signerFullName: string | null;
  signerRole: string | null;
  signerRoleOther: string | null;
  townName: string;
};

type ReceiptPayment = {
  amountCents: number;
  bankTransferReference: string | null;
  businessId: string | null;
  currency: string;
  id: string;
  method: PaymentRecordMethod;
  paidAt: Date | null;
  partnerUserId: string | null;
  purpose: PaymentPurpose;
  stripeCheckoutSessionId: string | null;
  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
  status: PaymentStatus;
};

export type ReceiptData = {
  payment: ReceiptPayment;
  recipientEmail: string | null;
  receiptFileName: string;
  receiptNumber: string;
  receiptUrl: string;
  submission: ReceiptSubmission;
};

export type SignedAgreementData = {
  agreementFileName: string;
  agreementNumber: string;
  agreementUrl: string;
  submission: ReceiptSubmission;
};

type PurchaseConfirmationDependencies = {
  getReceiptData: typeof getReceiptData;
  markPurchaseConfirmationSent: (submissionId: string) => Promise<unknown>;
  sendOwnerAccessInvitationForSubmission: typeof sendOwnerAccessInvitationForSubmission;
  sendReceiptEmail: typeof sendReceiptEmail;
};

type SignaturePoint = {
  x: number;
  y: number;
};

type SignatureDrawing = {
  strokes: SignaturePoint[][];
  version: 1;
};

function trimValue(value: string | null | undefined) {
  return value?.trim() || "";
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

export function resolveReceiptRecipient(params: {
  businessEmail?: string | null;
  ownerEmail?: string | null;
}) {
  const ownerEmail = trimValue(params.ownerEmail);
  const businessEmail = trimValue(params.businessEmail);

  return ownerEmail || businessEmail || null;
}

export function canAccessSubmissionReceipt(params: {
  allowInternal?: boolean;
  paymentPartnerUserId?: string | null;
  submissionUserId: string;
  viewerId?: string | null;
  viewerRole?: UserRole | null;
}) {
  if (params.allowInternal || !params.viewerId) return Boolean(params.allowInternal);
  if (params.viewerRole === "ADMIN" || params.submissionUserId === params.viewerId) return true;

  return params.viewerRole === "GETTER" && params.paymentPartnerUserId === params.viewerId;
}

function buildReceiptNumber(params: { paymentId: string; submissionId: string }) {
  return `SLR-${params.submissionId.slice(-4).toUpperCase()}-${params.paymentId.slice(-6).toUpperCase()}`;
}

function buildReceiptFileName(businessName: string, receiptNumber: string) {
  const businessSlug = slugify(businessName) || "business";
  return `${businessSlug}-${receiptNumber.toLowerCase()}.pdf`;
}

export function buildReceiptUrl(
  submissionId: string,
  checkoutSessionId: string | null,
  appUrlOverride?: string | null,
) {
  const appUrl = (trimValue(appUrlOverride) || getAppUrl()).replace(/\/+$/, "");
  const query = checkoutSessionId
    ? `?session=${encodeURIComponent(checkoutSessionId)}`
    : "";

  return `${appUrl}/api/receipts/${encodeURIComponent(submissionId)}${query}`;
}

/** New receipt URLs always name the durable Payment that they represent. */
export function buildPaymentReceiptUrl(
  paymentId: string,
  checkoutSessionId?: string | null,
  appUrlOverride?: string | null,
) {
  const appUrl = (trimValue(appUrlOverride) || getAppUrl()).replace(/\/+$/, "");
  const query = checkoutSessionId ? `?session=${encodeURIComponent(checkoutSessionId)}` : "";
  return `${appUrl}/api/receipts/payment/${encodeURIComponent(paymentId)}${query}`;
}

export function buildPaymentReceiptPageUrl(
  paymentId: string,
  checkoutSessionId?: string | null,
) {
  const query = checkoutSessionId ? `?session=${encodeURIComponent(checkoutSessionId)}` : "";
  return `/receipts/payment/${encodeURIComponent(paymentId)}${query}`;
}

export function buildAgreementPageUrl(
  submissionId: string,
  checkoutSessionId?: string | null,
) {
  const query = checkoutSessionId ? `?session=${encodeURIComponent(checkoutSessionId)}` : "";
  return `/agreements/${encodeURIComponent(submissionId)}${query}`;
}

function getPaymentMethodReceiptLabel(method: PaymentRecordMethod, locale: Locale) {
  if (method === "BANK_TRANSFER") {
    return locale === "it" ? "Bonifico bancario" : "Bank transfer";
  }

  return locale === "it" ? "Carta / QR con Stripe" : "Stripe card / QR";
}

function getPaymentPurposeReceiptLabel(purpose: PaymentPurpose, locale: Locale) {
  const labels = locale === "it"
    ? { ANNUAL_RENEWAL: "Rinnovo annuale", INITIAL_MEMBERSHIP: "Membership iniziale", REACTIVATION: "Riattivazione della membership" }
    : { ANNUAL_RENEWAL: "Annual renewal", INITIAL_MEMBERSHIP: "Initial membership", REACTIVATION: "Membership reactivation" };
  return labels[purpose];
}

function parseSignatureDrawing(value: string | null | undefined): SignatureDrawing | null {
  if (!value?.trim().startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as SignatureDrawing;

    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.strokes) ||
      parsed.strokes.some(
        (stroke) =>
          !Array.isArray(stroke) ||
          stroke.some(
            (point) =>
              typeof point?.x !== "number" || typeof point?.y !== "number",
          ),
      )
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function getSignerRoleLabel(params: {
  locale: Locale;
  otherRole?: string | null;
  role?: string | null;
}) {
  switch (params.role) {
    case "OWNER":
      return params.locale === "it" ? "Titolare" : "Owner";
    case "LEGAL_REPRESENTATIVE":
      return params.locale === "it" ? "Legale rappresentante" : "Legal representative";
    case "MANAGER_AUTHORIZED_BY_OWNER":
      return params.locale === "it"
        ? "Manager autorizzato dal titolare"
        : "Manager authorized by owner";
    case "OTHER_AUTHORIZED_REPRESENTATIVE":
      return params.otherRole?.trim() ||
        (params.locale === "it"
          ? "Altro rappresentante autorizzato"
          : "Other authorized representative");
    default:
      return params.otherRole?.trim() || (params.locale === "it" ? "Non indicato" : "Not provided");
  }
}

function drawLabelValueRow(params: {
  bodyBold: PDFFont;
  bodyFont: PDFFont;
  label: string;
  page: PDFPage;
  value: string;
  x: number;
  y: number;
}) {
  params.page.drawText(params.label, {
    color: rgb(0.62, 0.41, 0.26),
    font: params.bodyBold,
    size: 11,
    x: params.x,
    y: params.y,
  });
  params.page.drawText(params.value, {
    font: params.bodyFont,
    size: 12,
    x: params.x + 172,
    y: params.y,
  });
}

function drawSignatureBox(params: {
  borderColor?: ReturnType<typeof rgb>;
  drawing: SignatureDrawing | null;
  font: PDFFont;
  locale: Locale;
  page: PDFPage;
  height?: number;
  width?: number;
  x: number;
  y: number;
}) {
  const boxWidth = params.width ?? 220;
  const boxHeight = params.height ?? 92;

  params.page.drawRectangle({
    borderColor: params.borderColor ?? rgb(0.84, 0.79, 0.74),
    borderWidth: 1,
    color: rgb(1, 1, 1),
    height: boxHeight,
    width: boxWidth,
    x: params.x,
    y: params.y,
  });

  if (!params.drawing?.strokes.length) {
    params.page.drawText(
      params.locale === "it" ? "Firma non disponibile" : "Signature unavailable",
      {
        color: rgb(0.45, 0.5, 0.55),
        font: params.font,
        size: 10,
        x: params.x + 16,
        y: params.y + boxHeight / 2 - 5,
      },
    );
    return;
  }

  const allPoints = params.drawing.strokes.flat();
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const sourceWidth = Math.max(maxX - minX, 1);
  const sourceHeight = Math.max(maxY - minY, 1);
  const padding = 10;
  const scale = Math.min(
    (boxWidth - padding * 2) / sourceWidth,
    (boxHeight - padding * 2) / sourceHeight,
  );
  const offsetX = params.x + (boxWidth - sourceWidth * scale) / 2;
  const offsetY = params.y + (boxHeight - sourceHeight * scale) / 2;

  for (const stroke of params.drawing.strokes) {
    if (!stroke.length) {
      continue;
    }

    if (stroke.length === 1) {
      const point = stroke[0];
      const px = offsetX + (point.x - minX) * scale;
      const py = offsetY + (maxY - point.y) * scale;
      params.page.drawLine({
        color: rgb(0.14, 0.2, 0.23),
        end: { x: px + 0.5, y: py + 0.5 },
        start: { x: px, y: py },
        thickness: 1.6,
      });
      continue;
    }

    for (let index = 1; index < stroke.length; index += 1) {
      const previous = stroke[index - 1];
      const current = stroke[index];
      params.page.drawLine({
        color: rgb(0.14, 0.2, 0.23),
        end: {
          x: offsetX + (current.x - minX) * scale,
          y: offsetY + (maxY - current.y) * scale,
        },
        start: {
          x: offsetX + (previous.x - minX) * scale,
          y: offsetY + (maxY - previous.y) * scale,
        },
        thickness: 1.6,
      });
    }
  }
}

const agreementColors = {
  green: rgb(0.12, 0.39, 0.34),
  label: rgb(0.31, 0.43, 0.46),
  navy: rgb(0.04, 0.12, 0.18),
  signatureBorder: rgb(0.88, 0.87, 0.84),
};

function drawTrackedText(params: {
  color: ReturnType<typeof rgb>;
  font: PDFFont;
  letterSpacing: number;
  page: PDFPage;
  size: number;
  text: string;
  x: number;
  y: number;
}) {
  let cursor = params.x;
  for (const character of params.text) {
    params.page.drawText(character, { color: params.color, font: params.font, size: params.size, x: cursor, y: params.y });
    cursor += params.font.widthOfTextAtSize(character, params.size) + params.letterSpacing;
  }
}

function wrapPdfText(params: { font: PDFFont; maxWidth: number; size: number; text: string }) {
  const words = params.text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ["—"];
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (params.font.widthOfTextAtSize(candidate, params.size) <= params.maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

function formatItalianAgreementDate(value: Date) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "long",
    timeZone: "Europe/Rome",
    year: "numeric",
  }).format(value).replace(" alle ore ", " alle ");
}

function formatItalianAgreementTermsDate(params: { acceptedAt: Date; version: string | null }) {
  const versionDate = params.version?.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const date = versionDate
    ? new Date(Date.UTC(Number(versionDate[1]), Number(versionDate[2]) - 1, Number(versionDate[3]), 12))
    : params.acceptedAt;
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatItalianMembershipPrice(amountCents: number) {
  const amount = amountCents / 100;
  const value = new Intl.NumberFormat("it-IT", {
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
  return `€${value} / anno`;
}

function getAgreementSignerRole(submission: Pick<ReceiptSubmission, "signerRole" | "signerRoleOther">) {
  if (submission.signerRole === "LEGAL_REPRESENTATIVE") return "Rappresentante legale";
  return getSignerRoleLabel({ locale: "it", otherRole: submission.signerRoleOther, role: submission.signerRole });
}

const receiptPaymentSelect = {
  amountCents: true,
  bankTransferReference: true,
  businessId: true,
  businessSubmission: {
    select: {
      address: true,
      agreementSignature: true,
      amountPaidCents: true,
      automaticRenewalAtAcceptance: true,
      businessName: true,
      businessTermsAcceptedAt: true,
      businessTermsVersion: true,
      createdBusinessId: true,
      createdAt: true,
      contractualEmail: true,
      email: true,
      firstYearPriceCentsAtAcceptance: true,
      id: true,
      listingTermMonthsAtAcceptance: true,
      ownerEmail: true,
      ownerHasNoEmail: true,
      paymentStatus: true,
      privacyPolicyVersionPresented: true,
      purchaseConfirmationSentAt: true,
      renewalPriceCentsAtAcceptance: true,
      signedAt: true,
      signerFullName: true,
      signerRole: true,
      signerRoleOther: true,
      town: { select: { name: true } },
      userId: true,
    },
  },
  currency: true,
  id: true,
  method: true,
  paidAt: true,
  partnerUserId: true,
  purpose: true,
  status: true,
  stripeCheckoutSessionId: true,
  stripeInvoiceId: true,
  stripePaymentIntentId: true,
} as const;

export function resolvePaymentBusinessId(payment: {
  businessId: string | null;
  businessSubmission: { createdBusinessId: string | null };
}) {
  const submissionBusinessId = payment.businessSubmission.createdBusinessId;
  // A corrupt or manually mismatched association must never grant an owner
  // access through either business. The financial record is safer unavailable
  // than silently attributed to another listing.
  if (payment.businessId && submissionBusinessId && payment.businessId !== submissionBusinessId) {
    return null;
  }
  return payment.businessId ?? submissionBusinessId;
}

export function selectLegacyInitialPayment<T extends { purpose: PaymentPurpose }>(payments: T[]) {
  const initialPayments = payments.filter((payment) => payment.purpose === "INITIAL_MEMBERSHIP");
  return initialPayments.length === 1 ? initialPayments[0] : null;
}

export async function getReceiptData(params: {
  allowInternal?: boolean;
  appUrl?: string | null;
  checkoutSessionId?: string | null;
  paymentId?: string | null;
  submissionId?: string | null;
  viewerId?: string | null;
  viewerRole?: UserRole | null;
}) {
  const paymentId = trimValue(params.paymentId);
  const submissionId = trimValue(params.submissionId);
  const checkoutSessionId = trimValue(params.checkoutSessionId);
  let payment = null;

  if (paymentId) {
    payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: receiptPaymentSelect,
    });
    if (payment && checkoutSessionId && payment.stripeCheckoutSessionId !== checkoutSessionId) return null;
  } else if (checkoutSessionId && submissionId) {
    payment = await prisma.payment.findFirst({
      where: { businessSubmissionId: submissionId, stripeCheckoutSessionId: checkoutSessionId },
      select: receiptPaymentSelect,
    });
  } else if (submissionId) {
    // Legacy submission-only links are intentionally limited to the one
    // original payment. They can never resolve a later renewal/reactivation.
    const initialPayments = await prisma.payment.findMany({
      where: { businessSubmissionId: submissionId, purpose: "INITIAL_MEMBERSHIP" },
      orderBy: { createdAt: "asc" },
      select: receiptPaymentSelect,
      take: 2,
    });
    payment = selectLegacyInitialPayment(initialPayments);
  }

  if (!payment || !["PAID", "REFUNDED"].includes(payment.status)) return null;
  if (params.allowInternal && checkoutSessionId && payment.stripeCheckoutSessionId !== checkoutSessionId) return null;

  const submission = payment.businessSubmission;
  const directAccess = canAccessSubmissionReceipt({
    allowInternal: params.allowInternal,
    paymentPartnerUserId: payment.partnerUserId,
    submissionUserId: submission.userId,
    viewerId: params.viewerId,
    viewerRole: params.viewerRole,
  });
  const businessId = resolvePaymentBusinessId(payment);
  const ownerAccess =
    !directAccess &&
    params.viewerRole === "BUSINESS_OWNER" &&
    Boolean(params.viewerId && businessId) &&
    (await canManageBusiness({ businessId: businessId!, userId: params.viewerId! }));

  if (!directAccess && !ownerAccess) return null;

  const receiptNumber = buildReceiptNumber({ paymentId: payment.id, submissionId: submission.id });
  return {
    payment: {
      amountCents: payment.amountCents,
      bankTransferReference: payment.bankTransferReference,
      businessId: payment.businessId,
      currency: payment.currency,
      id: payment.id,
      method: payment.method,
      paidAt: payment.paidAt,
      partnerUserId: payment.partnerUserId,
      purpose: payment.purpose,
      status: payment.status,
      stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
      stripeInvoiceId: payment.stripeInvoiceId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
    },
    recipientEmail: resolveReceiptRecipient({ businessEmail: submission.email, ownerEmail: submission.ownerEmail }),
    receiptFileName: buildReceiptFileName(submission.businessName, receiptNumber),
    receiptNumber,
    receiptUrl: buildPaymentReceiptUrl(payment.id, payment.stripeCheckoutSessionId, params.appUrl),
    submission: {
      address: submission.address,
      agreementSignature: submission.agreementSignature,
      amountPaidCents: submission.amountPaidCents,
      automaticRenewalAtAcceptance: submission.automaticRenewalAtAcceptance,
      businessName: submission.businessName,
      businessTermsAcceptedAt: submission.businessTermsAcceptedAt,
      businessTermsVersion: submission.businessTermsVersion,
      createdAt: submission.createdAt,
      contractualEmail: submission.contractualEmail,
      email: submission.email,
      firstYearPriceCentsAtAcceptance: submission.firstYearPriceCentsAtAcceptance,
      id: submission.id,
      listingTermMonthsAtAcceptance: submission.listingTermMonthsAtAcceptance,
      ownerEmail: submission.ownerEmail,
      ownerHasNoEmail: submission.ownerHasNoEmail,
      paymentStatus: submission.paymentStatus,
      privacyPolicyVersionPresented: submission.privacyPolicyVersionPresented,
      purchaseConfirmationSentAt: submission.purchaseConfirmationSentAt,
      renewalPriceCentsAtAcceptance: submission.renewalPriceCentsAtAcceptance,
      signedAt: submission.signedAt,
      signerFullName: submission.signerFullName,
      signerRole: submission.signerRole,
      signerRoleOther: submission.signerRoleOther,
      townName: submission.town.name,
    },
  } satisfies ReceiptData;
}

export async function getSignedAgreementData(params: {
  allowInternal?: boolean;
  appUrl?: string | null;
  checkoutSessionId?: string | null;
  submissionId: string;
  viewerId?: string | null;
  viewerRole?: UserRole | null;
}) {
  const submissionId = trimValue(params.submissionId);
  if (!submissionId) return null;

  if (params.checkoutSessionId) {
    const sessionReceipt = await getReceiptData({
      allowInternal: params.allowInternal,
      checkoutSessionId: params.checkoutSessionId,
      submissionId,
    });
    if (!sessionReceipt) return null;
  }

  const submission = await prisma.businessSubmission.findUnique({
    where: { id: submissionId },
    select: {
      address: true, agreementSignature: true, amountPaidCents: true, automaticRenewalAtAcceptance: true,
      businessName: true, businessTermsAcceptedAt: true, businessTermsVersion: true, createdBusinessId: true,
      createdAt: true, contractualEmail: true, email: true, firstYearPriceCentsAtAcceptance: true, id: true,
      listingTermMonthsAtAcceptance: true, ownerEmail: true, ownerHasNoEmail: true, paymentStatus: true,
      privacyPolicyVersionPresented: true, purchaseConfirmationSentAt: true, renewalPriceCentsAtAcceptance: true,
      signedAt: true, signerFullName: true, signerRole: true, signerRoleOther: true,
      town: { select: { name: true } }, userId: true,
    },
  });
  if (!submission || !submission.agreementSignature || (!submission.signedAt && !submission.businessTermsAcceptedAt)) return null;

  const directAccess = Boolean(params.allowInternal) ||
    params.viewerRole === "ADMIN" || submission.userId === params.viewerId;
  const ownerAccess = !directAccess && params.viewerRole === "BUSINESS_OWNER" && Boolean(
    params.viewerId && submission.createdBusinessId && await canManageBusiness({
      businessId: submission.createdBusinessId,
      userId: params.viewerId,
    }),
  );
  if (!directAccess && !ownerAccess) return null;

  const agreementNumber = `SLA-${submission.id.slice(-8).toUpperCase()}`;
  return {
    agreementFileName: `${slugify(submission.businessName) || "business"}-${agreementNumber.toLowerCase()}.pdf`,
    agreementNumber,
    agreementUrl: buildAgreementPageUrl(submission.id, params.checkoutSessionId),
    submission: { ...submission, townName: submission.town.name },
  } satisfies SignedAgreementData;
}

function buildTermsUrl(appUrl: string, version: string | null) {
  const url = new URL(`${appUrl}${LEGAL_ROUTES.terms}`);
  url.hash = "business-terms";

  if (version) {
    url.searchParams.set("version", version);
  }

  return url.toString();
}

export async function buildReceiptPdf(params: {
  locale: Locale;
  receipt: ReceiptData;
}) {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const serifFont = await document.embedFont(StandardFonts.TimesRomanBold);
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);
  const bodyBold = await document.embedFont(StandardFonts.HelveticaBold);

  const { locale, receipt } = params;
  const paidDate = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(receipt.payment.paidAt ?? receipt.submission.createdAt);
  const amountPaid = formatCurrencyFromCents(
    receipt.payment.amountCents || receipt.submission.amountPaidCents,
    locale,
  );

  page.drawText("Salento Local", {
    color: rgb(0.18, 0.42, 0.37),
    font: serifFont,
    size: 24,
    x: 48,
    y: 780,
  });

  page.drawText(locale === "it" ? "RICEVUTA DI PAGAMENTO" : "PAYMENT RECEIPT", {
    font: serifFont,
    size: 28,
    x: 48,
    y: 730,
  });

  const lines = [
    [locale === "it" ? "Ricevuta n." : "Receipt no.", receipt.receiptNumber],
    [locale === "it" ? "Attivita" : "Business", receipt.submission.businessName],
    [locale === "it" ? "Localita" : "Location", `${receipt.submission.townName} · ${receipt.submission.address}`],
    [locale === "it" ? "Importo pagato" : "Amount paid", amountPaid],
    [locale === "it" ? "Pagato il" : "Paid on", paidDate],
    [locale === "it" ? "Metodo" : "Method", getPaymentMethodReceiptLabel(receipt.payment.method, locale)],
    [locale === "it" ? "Tipo" : "Payment type", getPaymentPurposeReceiptLabel(receipt.payment.purpose, locale)],
    ...(receipt.payment.bankTransferReference
      ? [[locale === "it" ? "Riferimento bonifico" : "Bank transfer reference", receipt.payment.bankTransferReference] as [string, string]]
      : []),
    [locale === "it" ? "Email ricevuta" : "Receipt email", receipt.recipientEmail || (locale === "it" ? "Non disponibile" : "Not available")],
  ];

  let y = 670;
  for (const [label, value] of lines) {
    drawLabelValueRow({
      bodyBold,
      bodyFont,
      label,
      page,
      value,
      x: 48,
      y,
    });
    y -= 42;
  }

  page.drawText(
    locale === "it"
      ? "Questa ricevuta documenta esclusivamente il pagamento indicato sopra."
      : "This receipt documents only the payment identified above.",
    {
      font: bodyFont,
      size: 10,
      x: 48,
      y: 70,
    },
  );

  page.drawText("salentolocal.com", {
    font: bodyBold,
    size: 11,
    x: 48,
    y: 40,
  });

  return document.save();
}

export async function buildSignedAgreementPdf(params: {
  agreement: SignedAgreementData;
}) {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const serifFont = await document.embedFont(StandardFonts.TimesRomanBold);
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);
  const bodyBold = await document.embedFont(StandardFonts.HelveticaBold);
  const { agreement } = params;
  const submission = agreement.submission;
  const acceptedAt = submission.businessTermsAcceptedAt ?? submission.signedAt ?? submission.createdAt;
  const signedAt = submission.signedAt ?? acceptedAt;
  const firstYearPrice = formatItalianMembershipPrice(
    submission.firstYearPriceCentsAtAcceptance ?? submission.amountPaidCents ?? LISTING_OFFER.annualPriceCents,
  );
  const signatureDrawing = parseSignatureDrawing(submission.agreementSignature);

  const logoPng = await readFile(join(process.cwd(), "public", "brand", "salento-local-agreement-logo.png"));
  const logo = await document.embedPng(logoPng);
  page.drawImage(logo, { x: 35, y: 742, width: 203, height: (203 * logo.height) / logo.width });
  page.drawText("ACCORDO DI ADESIONE FIRMATO", {
    color: agreementColors.navy, font: serifFont, size: 25, x: 48, y: 691,
  });
  drawTrackedText({
    color: agreementColors.label,
    font: bodyBold,
    letterSpacing: 1.1,
    page,
    size: 8.5,
    text: `ACCORDO ${agreement.agreementNumber}`,
    x: 49,
    y: 660,
  });
  page.drawLine({ color: agreementColors.green, end: { x: 547, y: 628 }, start: { x: 48, y: 628 }, thickness: 1.25 });

  const signerRole = getAgreementSignerRole(submission);
  const details = [
    ["ATTIVITÀ", submission.businessName],
    ["INDIRIZZO", [submission.address, submission.townName].filter(Boolean).join(", ")],
    ["ADESIONE", firstYearPrice],
    ["FIRMATO DA", `${submission.signerFullName || "Non indicato"} · ${signerRole}`],
    ["DATA DELLA FIRMA", formatItalianAgreementDate(signedAt)],
    ["TERMINI ACCETTATI", `Termini per le attività · ${formatItalianAgreementTermsDate({ acceptedAt, version: submission.businessTermsVersion })}`],
  ] as const;

  let y = 584;
  for (const [label, value] of details) {
    const lines = wrapPdfText({ font: bodyFont, maxWidth: 348, size: 13.2, text: value });
    drawTrackedText({
      color: agreementColors.label,
      font: bodyBold,
      letterSpacing: 1.8,
      page,
      size: 8.4,
      text: label,
      x: 48,
      y: y + 3,
    });
    lines.forEach((line, index) => {
      page.drawText(line, {
        color: agreementColors.navy,
        font: bodyFont,
        size: 13.2,
        x: 184,
        y: y - index * 17,
      });
    });
    y -= Math.max(38, lines.length * 17 + 15);
  }

  drawTrackedText({ color: agreementColors.label, font: bodyBold, letterSpacing: 1.8, page, size: 8.4, text: "FIRMA", x: 48, y: 319 });
  drawSignatureBox({ borderColor: agreementColors.signatureBorder, drawing: signatureDrawing, font: bodyFont, height: 86, locale: "it", page, width: 250, x: 48, y: 207 });
  page.drawText(submission.signerFullName || "Non indicato", { color: agreementColors.navy, font: serifFont, size: 13, x: 49, y: 182 });
  page.drawText(signerRole, { color: agreementColors.label, font: bodyFont, size: 10.5, x: 49, y: 165 });

  page.drawLine({ color: agreementColors.label, end: { x: 547, y: 72 }, start: { x: 48, y: 72 }, thickness: 0.7 });
  page.drawText("Salento Local", { color: agreementColors.green, font: serifFont, size: 13.5, x: 49, y: 47 });
  page.drawText("salentolocal.com", { color: agreementColors.label, font: bodyFont, size: 9.5, x: 49, y: 31 });
  page.drawText(`Accordo ${agreement.agreementNumber}`, { color: agreementColors.label, font: bodyFont, size: 9.5, x: 417, y: 38 });
  return document.save();
}

function buildReceiptEmailCopy(params: {
  amountPaid: string;
  businessName: string;
  contactEmail: string | null;
  listingPeriod: string;
  locale: Locale;
  paidDate: string;
  receiptUrl: string;
  receiptNumber: string;
  renewalPrice: string;
  termsUrl: string;
  termsVersion: string;
  ownerActions?: {
    manageUrl: string;
    viewUrl: string;
  } | null;
}) {
  const ownerActions = params.ownerActions
    ? params.locale === "it"
      ? `<p style="margin-top:24px"><a href="${params.ownerActions.viewUrl}">Vedi la tua attività</a> · <a href="${params.ownerActions.manageUrl}">Gestisci la tua attività</a></p><p>Con il tuo account puoi aggiornare informazioni, foto e orari.</p>`
      : `<p style="margin-top:24px"><a href="${params.ownerActions.viewUrl}">View your business</a> · <a href="${params.ownerActions.manageUrl}">Manage your business</a></p><p>Use your account to update information, photos, and opening hours.</p>`
    : "";
  const ownerActionsText = params.ownerActions
    ? params.locale === "it"
      ? ` Vedi la tua attività: ${params.ownerActions.viewUrl}. Gestisci la tua attività: ${params.ownerActions.manageUrl}.`
      : ` View your business: ${params.ownerActions.viewUrl}. Manage your business: ${params.ownerActions.manageUrl}.`
    : "";
  if (params.locale === "it") {
    return {
      html: `<p>Grazie per aver completato il pagamento della scheda <strong>${params.businessName}</strong>.</p><p><strong>Importo pagato:</strong> ${params.amountPaid}<br /><strong>Data pagamento:</strong> ${params.paidDate}<br /><strong>Periodo membership:</strong> ${params.listingPeriod}<br /><strong>Rinnovo:</strong> ${params.renewalPrice}/anno per questa attivita</p><p>Il pagamento attiva questa specifica scheda per 365 giorni. Le opzioni e i dettagli di un eventuale rinnovo saranno mostrati prima di qualsiasi autorizzazione.</p><p><strong>Versione Termini:</strong> ${params.termsVersion}<br /><a href="${params.termsUrl}">Apri i Termini accettati</a></p><p><a href="${params.receiptUrl}">Apri la ricevuta PDF</a></p>${ownerActions}${params.contactEmail ? `<p>Email di conferma registrata: <strong>${params.contactEmail}</strong></p>` : ""}`,
      subject: `Ricevuta Salento Local ${params.receiptNumber}`,
      text: `Grazie per aver completato il pagamento della scheda ${params.businessName}. Importo pagato: ${params.amountPaid}. Data pagamento: ${params.paidDate}. Periodo membership: ${params.listingPeriod}. Rinnovo: ${params.renewalPrice}/anno per questa attivita. Il pagamento attiva questa specifica scheda per 365 giorni. Le opzioni e i dettagli di un eventuale rinnovo saranno mostrati prima di qualsiasi autorizzazione. Versione Termini: ${params.termsVersion}. Termini accettati: ${params.termsUrl}. Ricevuta PDF: ${params.receiptUrl}.${ownerActionsText}${params.contactEmail ? ` Email di conferma registrata: ${params.contactEmail}.` : ""}`,
    };
  }

  return {
      html: `<p>Thank you for completing the payment for <strong>${params.businessName}</strong>.</p><p><strong>Amount paid:</strong> ${params.amountPaid}<br /><strong>Payment date:</strong> ${params.paidDate}<br /><strong>Membership period:</strong> ${params.listingPeriod}<br /><strong>Renewal:</strong> ${params.renewalPrice}/year for this business</p><p>Your payment activates this specific Business Page for 365 days. Any renewal options and details will be shown before authorization.</p><p><strong>Terms version:</strong> ${params.termsVersion}<br /><a href="${params.termsUrl}">Open the accepted terms</a></p><p><a href="${params.receiptUrl}">Open the PDF receipt</a></p>${ownerActions}${params.contactEmail ? `<p>Confirmation email on file: <strong>${params.contactEmail}</strong></p>` : ""}`,
    subject: `Your Salento Local receipt ${params.receiptNumber}`,
      text: `Thank you for completing the payment for ${params.businessName}. Amount paid: ${params.amountPaid}. Payment date: ${params.paidDate}. Membership period: ${params.listingPeriod}. Renewal: ${params.renewalPrice}/year for this business. Your payment activates this specific Business Page for 365 days. Any renewal options and details will be shown before authorization. Terms version: ${params.termsVersion}. Accepted terms: ${params.termsUrl}. PDF receipt: ${params.receiptUrl}.${ownerActionsText}${params.contactEmail ? ` Confirmation email on file: ${params.contactEmail}.` : ""}`,
  };
}

export async function sendReceiptEmail(params: {
  locale: Locale;
  ownerActions?: {
    manageUrl: string;
    ownerName: string;
    viewUrl: string;
  } | null;
  recipientEmail?: string | null;
  receipt: ReceiptData;
}) {
  const recipientEmail = params.recipientEmail?.trim() || params.receipt.recipientEmail;
  if (
    !recipientEmail ||
    (!hasResendConfiguration() && !hasSmtpConfiguration())
  ) {
    return false;
  }

  const amountPaid = formatCurrencyFromCents(
    params.receipt.payment.amountCents || params.receipt.submission.amountPaidCents,
    params.locale,
  );
  const paidAt = params.receipt.payment.paidAt ?? params.receipt.submission.createdAt;
  const listingStartDate = paidAt;
  const listingEndDate = addUtcDays(listingStartDate, BUSINESS_MEMBERSHIP_PERIOD_DAYS);
  const listingPeriod = `${new Intl.DateTimeFormat(params.locale === "it" ? "it-IT" : "en-GB", {
    dateStyle: "medium",
  }).format(listingStartDate)} – ${new Intl.DateTimeFormat(params.locale === "it" ? "it-IT" : "en-GB", {
    dateStyle: "medium",
  }).format(listingEndDate)}`;
  const paidDate = new Intl.DateTimeFormat(params.locale === "it" ? "it-IT" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(paidAt);
  const renewalPrice = formatCurrencyFromCents(
    params.receipt.submission.renewalPriceCentsAtAcceptance ?? LISTING_OFFER.renewalPriceCents,
    params.locale,
  );
  const pdfBytes = await buildReceiptPdf({
    locale: params.locale,
    receipt: params.receipt,
  });
  const emailCopy = params.ownerActions
    ? buildOwnerListingEmailCopy({
        agreementUrl: params.receipt.payment.purpose === "INITIAL_MEMBERSHIP"
          ? `${getAppUrl().replace(/\/+$/, "")}${buildAgreementPageUrl(params.receipt.submission.id, params.receipt.payment.stripeCheckoutSessionId)}`
          : null,
        businessName: params.receipt.submission.businessName,
        locale: params.locale,
        manageUrl: params.ownerActions.manageUrl,
        ownerName: params.ownerActions.ownerName,
        receiptUrl: params.receipt.receiptUrl,
        viewUrl: params.ownerActions.viewUrl,
      })
    : buildReceiptEmailCopy({
        amountPaid,
        businessName: params.receipt.submission.businessName,
        contactEmail: params.receipt.submission.contractualEmail || recipientEmail,
        listingPeriod,
        locale: params.locale,
        paidDate,
        receiptUrl: params.receipt.receiptUrl,
        receiptNumber: params.receipt.receiptNumber,
        renewalPrice,
        termsUrl: buildTermsUrl(getAppUrl(), params.receipt.submission.businessTermsVersion),
        termsVersion: params.receipt.submission.businessTermsVersion || LISTING_OFFER.businessTermsVersion,
        ownerActions: null,
      });

  await sendTransactionalEmail({
    attachments: [
      {
        content: Buffer.from(pdfBytes),
        contentType: "application/pdf",
        filename: params.receipt.receiptFileName,
      },
    ],
    headers: {
      "X-Transactional-Message": "receipt",
    },
    html: emailCopy.html,
    idempotencyKey: params.ownerActions
      ? `owner-listing/${params.receipt.submission.id}`
      : undefined,
    subject: emailCopy.subject,
    text: emailCopy.text,
    to: recipientEmail,
  });

  return true;
}

export async function sendPurchaseConfirmationForSubmission(params: {
  appUrl?: string | null;
  locale: Locale;
  submissionId: string;
}, dependencies: Partial<PurchaseConfirmationDependencies> = {}) {
  const getReceipt = dependencies.getReceiptData ?? getReceiptData;
  const createOwnerAccess =
    dependencies.sendOwnerAccessInvitationForSubmission ??
    sendOwnerAccessInvitationForSubmission;
  const sendEmail = dependencies.sendReceiptEmail ?? sendReceiptEmail;
  const markPurchaseConfirmationSent =
    dependencies.markPurchaseConfirmationSent ??
    ((submissionId: string) => prisma.businessSubmission.update({
      where: { id: submissionId },
      data: { purchaseConfirmationSentAt: new Date() },
    }));

  const receipt = await getReceipt({
    allowInternal: true,
    appUrl: params.appUrl,
    submissionId: params.submissionId,
  });

  if (
    !receipt ||
    receipt.submission.purchaseConfirmationSentAt ||
    receipt.submission.ownerHasNoEmail ||
    !receipt.submission.ownerEmail.trim()
  ) {
    return false;
  }

  const ownerAccess = await createOwnerAccess({
    locale: params.locale,
    submissionId: params.submissionId,
  });
  if (!ownerAccess) {
    throw new Error("owner_listing_access_not_created");
  }

  const sent = await sendEmail({
    locale: params.locale,
    ownerActions: {
      manageUrl: ownerAccess.manageUrl,
      ownerName: ownerAccess.ownerName,
      viewUrl: ownerAccess.viewUrl,
    },
    recipientEmail: ownerAccess.recipient,
    receipt,
  });

  if (!sent) {
    // Returning success here would acknowledge the Stripe webhook despite no
    // delivery attempt. Throw so the webhook can retry after configuration is
    // restored; `purchaseConfirmationSentAt` remains unset until a send works.
    throw new Error("owner_listing_email_not_sent");
  }

  await markPurchaseConfirmationSent(params.submissionId);

  return true;
}
