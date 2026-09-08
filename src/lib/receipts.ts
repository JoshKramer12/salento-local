import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PaymentRecordMethod, UserRole } from "@prisma/client";

import { hasSmtpConfiguration } from "@/lib/claim-delivery";
import { formatCurrencyFromCents } from "@/lib/account";
import {
  hasResendConfiguration,
  sendTransactionalEmail,
} from "@/lib/email";
import type { Locale } from "@/lib/i18n";
import { LISTING_OFFER } from "@/lib/listing-offer";
import { LEGAL_ROUTES } from "@/lib/legal";
import { getAppUrl } from "@/lib/payment";
import {
  buildOwnerListingEmailCopy,
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
  paymentStatus: "PAID";
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
  currency: string;
  id: string;
  method: PaymentRecordMethod;
  paidAt: Date | null;
  partnerUserId: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
};

export type ReceiptData = {
  payment: ReceiptPayment;
  recipientEmail: string | null;
  receiptFileName: string;
  receiptNumber: string;
  receiptUrl: string;
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

function getPaymentMethodReceiptLabel(method: PaymentRecordMethod, locale: Locale) {
  if (method === "BANK_TRANSFER") {
    return locale === "it" ? "Bonifico bancario" : "Bank transfer";
  }

  return locale === "it" ? "Carta / QR con Stripe" : "Stripe card / QR";
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
    borderColor: rgb(0.84, 0.79, 0.74),
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

export async function getReceiptData(params: {
  allowInternal?: boolean;
  appUrl?: string | null;
  submissionId: string;
  viewerId?: string | null;
  viewerRole?: UserRole | null;
}) {
  const submission = await prisma.businessSubmission.findUnique({
    where: {
      id: params.submissionId,
    },
    select: {
      address: true,
      agreementSignature: true,
      amountPaidCents: true,
      automaticRenewalAtAcceptance: true,
      businessName: true,
      businessTermsAcceptedAt: true,
      businessTermsVersion: true,
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
      town: {
        select: {
          name: true,
        },
      },
      userId: true,
      payments: {
        where: {
          status: "PAID",
        },
        orderBy: {
          paidAt: "desc",
        },
        select: {
          amountCents: true,
          currency: true,
          id: true,
          method: true,
          paidAt: true,
          partnerUserId: true,
          stripeCheckoutSessionId: true,
          stripePaymentIntentId: true,
        },
        take: 5,
      },
    },
  });

  if (!submission || submission.paymentStatus !== "PAID") {
    return null;
  }

  const payment = submission.payments[0] ?? null;

  if (!payment) {
    return null;
  }

  if (!canAccessSubmissionReceipt({
    allowInternal: params.allowInternal,
    paymentPartnerUserId: payment.partnerUserId,
    submissionUserId: submission.userId,
    viewerId: params.viewerId,
    viewerRole: params.viewerRole,
  })) return null;

  const receiptNumber = buildReceiptNumber({
    paymentId: payment.id,
    submissionId: submission.id,
  });

  return {
    payment,
    recipientEmail: resolveReceiptRecipient({
      businessEmail: submission.email,
      ownerEmail: submission.ownerEmail,
    }),
    receiptFileName: buildReceiptFileName(submission.businessName, receiptNumber),
    receiptNumber,
    receiptUrl: buildReceiptUrl(
      submission.id,
      payment.stripeCheckoutSessionId,
      params.appUrl,
    ),
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

function addMonths(date: Date, months: number) {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
}

function subtractDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() - days);
  return nextDate;
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
  const acceptedAt = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(
    receipt.submission.businessTermsAcceptedAt ??
      receipt.submission.signedAt ??
      receipt.payment.paidAt ??
      receipt.submission.createdAt,
  );
  const amountPaid = formatCurrencyFromCents(
    receipt.payment.amountCents || receipt.submission.amountPaidCents,
    locale,
  );
  const firstYearPrice = formatCurrencyFromCents(
    receipt.submission.firstYearPriceCentsAtAcceptance ?? LISTING_OFFER.firstYearPriceCents,
    locale,
  );
  const renewalPrice = formatCurrencyFromCents(
    receipt.submission.renewalPriceCentsAtAcceptance ?? LISTING_OFFER.renewalPriceCents,
    locale,
  );
  const signerRole = getSignerRoleLabel({
    locale,
    otherRole: receipt.submission.signerRoleOther,
    role: receipt.submission.signerRole,
  });
  const signatureDrawing = parseSignatureDrawing(receipt.submission.agreementSignature);

  page.drawText("Salento Local", {
    color: rgb(0.18, 0.42, 0.37),
    font: serifFont,
    size: 24,
    x: 48,
    y: 780,
  });

  page.drawText(locale === "it" ? "Ricevuta di pagamento" : "Payment receipt", {
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

  page.drawText(locale === "it" ? "Dettagli accettazione" : "Acceptance details", {
    color: rgb(0.18, 0.42, 0.37),
    font: serifFont,
    size: 19,
    x: 48,
    y: 360,
  });

  const acceptanceLines = [
    [
      locale === "it" ? "Firmatario" : "Signer",
      receipt.submission.signerFullName || (locale === "it" ? "Non indicato" : "Not provided"),
    ],
    [locale === "it" ? "Ruolo" : "Role", signerRole],
    [locale === "it" ? "Accettato il" : "Accepted on", acceptedAt],
    [locale === "it" ? "Primo anno" : "First year", firstYearPrice],
    [
      locale === "it" ? "Rinnovo" : "Renewal",
      `${renewalPrice}${locale === "it" ? "/anno, non automatico" : "/year, not automatic"}`,
    ],
    [
      locale === "it" ? "Durata scheda" : "Listing term",
      `${receipt.submission.listingTermMonthsAtAcceptance ?? LISTING_OFFER.termMonths} ${locale === "it" ? "mesi" : "months"}`,
    ],
    [
      locale === "it" ? "Versione Termini" : "Terms version",
      receipt.submission.businessTermsVersion || LISTING_OFFER.businessTermsVersion,
    ],
    [
      locale === "it" ? "Versione Privacy" : "Privacy version",
      receipt.submission.privacyPolicyVersionPresented || LISTING_OFFER.privacyPolicyVersion,
    ],
  ];

  let acceptanceY = 328;
  for (const [label, value] of acceptanceLines) {
    drawLabelValueRow({
      bodyBold,
      bodyFont,
      label,
      page,
      value,
      x: 48,
      y: acceptanceY,
    });
    acceptanceY -= 24;
  }

  page.drawText(locale === "it" ? "Firma registrata" : "Recorded signature", {
    color: rgb(0.62, 0.41, 0.26),
    font: bodyBold,
    size: 11,
    x: 48,
    y: 122,
  });

  drawSignatureBox({
    drawing: signatureDrawing,
    font: bodyFont,
    height: 72,
    locale,
    page,
    width: 220,
    x: 180,
    y: 64,
  });

  page.drawText(
    locale === "it"
      ? "Ricevuta generata da Salento Local con prova di pagamento, dati firmatario e termini accettati."
      : "Receipt generated by Salento Local with payment proof, signer details, and accepted terms.",
    {
      font: bodyFont,
      size: 10,
      x: 48,
      y: 40,
    },
  );

  page.drawText("salentolocal.com", {
    font: bodyBold,
    size: 11,
    x: 48,
    y: 18,
  });

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
      html: `<p>Grazie per aver completato il pagamento della scheda <strong>${params.businessName}</strong>.</p><p><strong>Importo pagato:</strong> ${params.amountPaid}<br /><strong>Data pagamento:</strong> ${params.paidDate}<br /><strong>Periodo scheda:</strong> ${params.listingPeriod}<br /><strong>Rinnovo:</strong> ${params.renewalPrice}/anno, non automatico</p><p>La scheda resta attiva per 12 mesi. Prima della scadenza contatteremo l'attivita: nessun addebito automatico verra eseguito.</p><p><strong>Versione Termini:</strong> ${params.termsVersion}<br /><a href="${params.termsUrl}">Apri i Termini accettati</a></p><p><a href="${params.receiptUrl}">Apri la ricevuta PDF</a></p>${ownerActions}${params.contactEmail ? `<p>Email di conferma registrata: <strong>${params.contactEmail}</strong></p>` : ""}`,
      subject: `Ricevuta Salento Local ${params.receiptNumber}`,
      text: `Grazie per aver completato il pagamento della scheda ${params.businessName}. Importo pagato: ${params.amountPaid}. Data pagamento: ${params.paidDate}. Periodo scheda: ${params.listingPeriod}. Rinnovo: ${params.renewalPrice}/anno, non automatico. Versione Termini: ${params.termsVersion}. Termini accettati: ${params.termsUrl}. Ricevuta PDF: ${params.receiptUrl}.${ownerActionsText}${params.contactEmail ? ` Email di conferma registrata: ${params.contactEmail}.` : ""}`,
    };
  }

  return {
    html: `<p>Thank you for completing the payment for <strong>${params.businessName}</strong>.</p><p><strong>Amount paid:</strong> ${params.amountPaid}<br /><strong>Payment date:</strong> ${params.paidDate}<br /><strong>Listing period:</strong> ${params.listingPeriod}<br /><strong>Renewal:</strong> ${params.renewalPrice}/year, not automatic</p><p>Your listing stays active for 12 months. We will contact the business before expiry, and no automatic charge will be made.</p><p><strong>Terms version:</strong> ${params.termsVersion}<br /><a href="${params.termsUrl}">Open the accepted terms</a></p><p><a href="${params.receiptUrl}">Open the PDF receipt</a></p>${ownerActions}${params.contactEmail ? `<p>Confirmation email on file: <strong>${params.contactEmail}</strong></p>` : ""}`,
    subject: `Your Salento Local receipt ${params.receiptNumber}`,
    text: `Thank you for completing the payment for ${params.businessName}. Amount paid: ${params.amountPaid}. Payment date: ${params.paidDate}. Listing period: ${params.listingPeriod}. Renewal: ${params.renewalPrice}/year, not automatic. Terms version: ${params.termsVersion}. Accepted terms: ${params.termsUrl}. PDF receipt: ${params.receiptUrl}.${ownerActionsText}${params.contactEmail ? ` Confirmation email on file: ${params.contactEmail}.` : ""}`,
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
  const listingEndDate = subtractDays(
    addMonths(listingStartDate, params.receipt.submission.listingTermMonthsAtAcceptance ?? LISTING_OFFER.termMonths),
    1,
  );
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
