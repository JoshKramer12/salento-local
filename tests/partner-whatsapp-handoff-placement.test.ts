import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const partnerPaymentPage = readFileSync("src/app/(account)/publish/payment/page.tsx", "utf8");
const payerSuccessPage = readFileSync("src/app/(account)/publish/payment/success/page.tsx", "utf8");
const statusWatcher = readFileSync("src/components/account/checkout-status-watcher.tsx", "utf8");

test("the WhatsApp handoff is rendered only in the paid Partner QR state", () => {
  assert.match(partnerPaymentPage, /const ownerWhatsAppHandoff = isPaid && viewer\.role === "GETTER"/);
  assert.match(partnerPaymentPage, /getNoEmailOwnerWhatsAppHandoff/);
  assert.match(partnerPaymentPage, /ownerWhatsAppHandoff \? <section/);
  assert.match(partnerPaymentPage, /<CheckoutStatusWatcher/);
  assert.doesNotMatch(payerSuccessPage, /getNoEmailOwnerWhatsAppHandoff/);
  assert.doesNotMatch(payerSuccessPage, /Send access via WhatsApp/);
});

test("the Partner QR refresh follows authoritative payment polling before the paid handoff renders", () => {
  assert.match(statusWatcher, /\/api\/stripe\/checkout-status\?submission=/);
  assert.match(statusWatcher, /!data\.paymentReceived/);
  assert.match(statusWatcher, /router\.refresh\(\)/);
});
