import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paymentPage = readFileSync("src/app/(account)/publish/payment/page.tsx", "utf8");
const qrView = readFileSync("src/components/account/initial-payment-qr-view.tsx", "utf8");

test("the redesigned view receives the original QR, payment URL, and status watcher", () => {
  assert.match(paymentPage, /elementPaymentUrl = buildNoEmailPaymentQrPayload\(/);
  assert.match(paymentPage, /qrCodeDataUrl = await generateStripePaymentQrDataUrl\(elementPaymentUrl\)/);
  assert.match(paymentPage, /paymentUrl=\{elementPaymentUrl\} qrCodeDataUrl=\{qrCodeDataUrl\}/);
  assert.match(qrView, /<img src=\{qrCodeDataUrl\}/);
  assert.match(qrView, /<Link href=\{paymentUrl\}/);
  assert.match(qrView, /<CheckoutStatusWatcher[^>]+submissionId=\{submissionId\}/);
});

test("the pending online layout keeps the refund terms and Partner payment warning after the QR card", () => {
  assert.ok(qrView.indexOf("copy.membershipLabel") < qrView.indexOf("qr-payment-title"));
  assert.ok(qrView.indexOf("qr-payment-title") < qrView.indexOf("refund-policy-title"));
  assert.ok(qrView.indexOf("refund-policy-title") < qrView.indexOf("{warning}"));
  assert.match(qrView, /href="\/terms#refunds"/);
  assert.match(paymentPage, /warning=\{getPendingPaymentCopy\(locale\)\}/);
  for (const copy of ["Scan to pay", "Inquadra per pagare", "14-day refund policy", "Rimborso entro 14 giorni"]) {
    assert.ok(paymentPage.includes(copy) || qrView.includes(copy), `Missing localized copy: ${copy}`);
  }
});

test("QR payment instructions use the phone camera in both languages", () => {
  assert.match(paymentPage, /Scansiona il codice QR con il tuo telefono per completare il pagamento di \$\{amount\} e pubblicare la tua attività\./);
  assert.match(paymentPage, /Scansiona il codice QR con la fotocamera del tuo telefono e segui le istruzioni per completare il pagamento\./);
  assert.match(paymentPage, /Scan the QR code with your phone to complete your \$\{amount\} payment and publish your listing\./);
  assert.match(paymentPage, /Scan the QR code with your phone's camera and follow the instructions to complete your payment\./);
  assert.match(qrView, /locale === "it" \? `€\$\{amount\.replace\("€", ""\)\.trim\(\)\}` : amount/);
  assert.doesNotMatch(paymentPage, /with your banking app|con l'app della tua banca/);
});

test("preview payment warnings are absent from customer-facing payment pages", () => {
  for (const file of [
    paymentPage,
    readFileSync("src/app/pay/element/[token]/page.tsx", "utf8"),
    readFileSync("src/components/account/pay-later-owner-client.tsx", "utf8"),
  ]) {
    assert.doesNotMatch(file, /During this preview, payments? (?:are|is) simulated|Durante questa anteprima i[ l] pagament[oi]/);
  }
});
