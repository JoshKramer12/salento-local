import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAgreementPageUrl,
  buildPaymentReceiptPageUrl,
  buildPaymentReceiptUrl,
  resolvePaymentBusinessId,
  selectLegacyInitialPayment,
} from "@/lib/receipts";
import { getStripeHostedReceiptUrl } from "@/lib/stripe-receipts";

const receipts = readFileSync("src/lib/receipts.ts", "utf8");
const stripeReceipts = readFileSync("src/lib/stripe-receipts.ts", "utf8");
const paymentHistory = readFileSync("src/app/(account)/dashboard/payment-history/page.tsx", "utf8");
const dashboard = readFileSync("src/components/account/business-owner-dashboard-client.tsx", "utf8");
const successPage = readFileSync("src/app/(account)/publish/payment/success/page.tsx", "utf8");
const paymentReceiptPage = readFileSync("src/app/(account)/receipts/payment/[paymentId]/page.tsx", "utf8");
const agreementPage = readFileSync("src/app/(account)/agreements/[submissionId]/page.tsx", "utf8");
const receiptRoute = readFileSync("src/app/api/receipts/payment/[paymentId]/route.ts", "utf8");
const agreementRoute = readFileSync("src/app/api/agreements/[submissionId]/route.ts", "utf8");

test("historical payment selections keep their exact identity and legacy links cannot select a newer renewal", () => {
  const initial = { id: "payment-a", purpose: "INITIAL_MEMBERSHIP" as const };
  const renewal = { id: "payment-b", purpose: "ANNUAL_RENEWAL" as const };
  const reactivation = { id: "payment-c", purpose: "REACTIVATION" as const };
  assert.equal(selectLegacyInitialPayment([initial, renewal, reactivation]), initial);
  assert.equal(selectLegacyInitialPayment([renewal, reactivation]), null);
  assert.equal(selectLegacyInitialPayment([initial, { ...initial, id: "duplicate-initial" }]), null);
  assert.equal(buildPaymentReceiptPageUrl(initial.id), "/receipts/payment/payment-a");
  assert.equal(buildPaymentReceiptPageUrl(renewal.id), "/receipts/payment/payment-b");
  assert.equal(buildPaymentReceiptPageUrl(reactivation.id), "/receipts/payment/payment-c");
  assert.equal(buildPaymentReceiptUrl("payment-a", "cs_exact", "https://salentolocal.example"), "https://salentolocal.example/api/receipts/payment/payment-a?session=cs_exact");
});

test("payment business resolution prevents cross-business association leakage", () => {
  assert.equal(resolvePaymentBusinessId({ businessId: "business-a", businessSubmission: { createdBusinessId: "business-a" } }), "business-a");
  assert.equal(resolvePaymentBusinessId({ businessId: null, businessSubmission: { createdBusinessId: "business-a" } }), "business-a");
  assert.equal(resolvePaymentBusinessId({ businessId: "business-a", businessSubmission: { createdBusinessId: "business-b" } }), null);
});

test("receipt data is payment addressed and never chooses submission payments by recency", () => {
  const resolver = receipts.slice(receipts.indexOf("export async function getReceiptData"), receipts.indexOf("export async function getSignedAgreementData"));
  assert.match(resolver, /paymentId/);
  assert.match(resolver, /where: \{ id: paymentId \}/);
  assert.match(resolver, /stripeCheckoutSessionId: checkoutSessionId/);
  assert.match(resolver, /selectLegacyInitialPayment/);
  assert.doesNotMatch(resolver, /payments\[0\]/);
  assert.doesNotMatch(resolver, /orderBy:\s*\{\s*paidAt: "desc"/);
  assert.match(paymentHistory, /\/receipts\/payment\/\$\{encodeURIComponent\(payment\.id\)\}/);
});

test("Stripe resolution prefers the exact stored invoice before that payment's session and intent", () => {
  const invoice = stripeReceipts.indexOf("if (invoiceId)");
  const session = stripeReceipts.indexOf("if (sessionId)");
  const intent = stripeReceipts.indexOf("if (!paymentIntentId)");
  assert.ok(invoice >= 0 && invoice < session && session < intent);
  assert.match(stripeReceipts, /stripeInvoiceId\?: string \| null/);
  assert.match(stripeReceipts, /stripe\.invoices\.retrieve\(invoiceId\)/);
  assert.match(receipts, /bankTransferReference/);
});

test("exact Stripe documents remain bound to their initial and automatic-renewal Payments", async () => {
  const requests: string[] = [];
  const stripe = {
    invoices: { retrieve: async (id: string) => { requests.push(`invoice:${id}`); return { hosted_invoice_url: `https://stripe.test/invoice/${id}` }; } },
    checkout: { sessions: { retrieve: async (id: string) => { requests.push(`session:${id}`); return { invoice: { hosted_invoice_url: `https://stripe.test/session/${id}` }, payment_intent: null }; } } },
    paymentIntents: { retrieve: async (id: string) => { requests.push(`intent:${id}`); return { latest_charge: { receipt_url: `https://stripe.test/charge/${id}` } }; } },
    charges: { retrieve: async (id: string) => { requests.push(`charge:${id}`); return { receipt_url: `https://stripe.test/charge/${id}` }; } },
  } as never;
  assert.equal(await getStripeHostedReceiptUrl({ stripeCheckoutSessionId: "cs-year-1" }, { stripe }), "https://stripe.test/session/cs-year-1");
  assert.equal(await getStripeHostedReceiptUrl({ stripeInvoiceId: "in-year-2", stripePaymentIntentId: "pi-other" }, { stripe }), "https://stripe.test/invoice/in-year-2");
  assert.equal(await getStripeHostedReceiptUrl({ stripeInvoiceId: "in-year-3" }, { stripe }), "https://stripe.test/invoice/in-year-3");
  assert.equal(await getStripeHostedReceiptUrl({ stripePaymentIntentId: "pi-bank-transfer" }, { stripe }), "https://stripe.test/charge/pi-bank-transfer");
  assert.deepEqual(requests, ["session:cs-year-1", "invoice:in-year-2", "invoice:in-year-3", "intent:pi-bank-transfer"]);
});

test("payment receipt and signed agreement stay separate documents", () => {
  const paymentPdf = receipts.slice(receipts.indexOf("export async function buildReceiptPdf"), receipts.indexOf("export async function buildSignedAgreementPdf"));
  const agreementPdf = receipts.slice(receipts.indexOf("export async function buildSignedAgreementPdf"));
  assert.match(paymentPdf, /PAYMENT RECEIPT/);
  assert.doesNotMatch(paymentPdf, /Recorded signature|Firma registrata|drawSignatureBox/);
  assert.match(agreementPdf, /SIGNED MEMBERSHIP AGREEMENT/);
  assert.match(agreementPdf, /ACCORDO DI ADESIONE FIRMATO/);
  assert.match(agreementPdf, /drawSignatureBox/);
  assert.match(agreementPdf, /Renewals and reactivations do not create a new signature/);
  assert.equal(buildAgreementPageUrl("submission-a"), "/agreements/submission-a");
});

test("new routes enforce protected, exact payment and agreement retrieval", () => {
  assert.match(receiptRoute, /paymentId/);
  assert.match(receiptRoute, /checkoutSessionId/);
  assert.match(receiptRoute, /getReceiptData/);
  assert.match(receiptRoute, /download/);
  assert.match(agreementRoute, /getSignedAgreementData/);
  assert.match(agreementRoute, /checkoutSessionId/);
  assert.match(receipts, /payment\.businessId && submissionBusinessId && payment\.businessId !== submissionBusinessId/);
  assert.match(receipts, /canManageBusiness/);
  assert.match(receiptRoute, /Content-Disposition.*inline/);
  assert.match(agreementRoute, /Content-Disposition.*inline/);
});

test("protected document links bypass the action page and open their exact PDFs directly", () => {
  assert.match(paymentReceiptPage, /getReceiptData/);
  assert.match(paymentReceiptPage, /getStripeHostedReceiptUrl/);
  assert.match(paymentReceiptPage, /redirect\(stripeReceiptUrl \|\| apiUrl\)/);
  assert.doesNotMatch(paymentReceiptPage, /DocumentActions/);
  assert.match(agreementPage, /getSignedAgreementData/);
  assert.match(agreementPage, /redirect\(apiUrl\)/);
  assert.doesNotMatch(agreementPage, /DocumentActions/);
});

test("owner-facing success and payments surfaces expose distinct, payment-scoped documents without a desktop-only table", () => {
  assert.match(successPage, /YOUR DOCUMENTS/);
  assert.match(successPage, /Signed Membership Agreement/);
  assert.match(successPage, /DocumentActions/);
  assert.match(dashboard, /View payments & documents/);
  assert.match(dashboard, /Visualizza pagamenti e documenti/);
  assert.doesNotMatch(dashboard, /View receipt/);
  assert.match(paymentHistory, /Payments & Documents/);
  assert.match(paymentHistory, /MEMBERSHIP DOCUMENTS/);
  assert.match(paymentHistory, /Signed membership agreement/);
  assert.match(paymentHistory, /PAYMENT HISTORY/);
  assert.match(paymentHistory, /Payment receipt/);
  assert.match(paymentHistory, /payment\.purpose === "INITIAL_MEMBERSHIP"/);
  assert.match(paymentHistory, /payment\.status === "PAID" \|\| payment\.status === "REFUNDED"/);
  assert.match(paymentHistory, /sm:flex-row sm:items-center sm:justify-between/);
});
