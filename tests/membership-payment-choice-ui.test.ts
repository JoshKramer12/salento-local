import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publishForm = readFileSync("src/components/account/publish-form.tsx", "utf8");
const submissionActions = readFileSync("src/app/(account)/actions.ts", "utf8");
const stripeCheckout = readFileSync("src/lib/stripe-checkout.ts", "utf8");
const paymentPage = readFileSync("src/app/(account)/publish/payment/page.tsx", "utf8");
const paymentSync = readFileSync("src/lib/stripe-payment-sync.ts", "utf8");
const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

test("the initial membership payment step defaults to visibly selected automatic renewal", () => {
  assert.match(publishForm, /useState<"AUTO" \| "MANUAL">\("AUTO"\)/);
  assert.match(publishForm, /Automatic renewal — Recommended/);
  assert.match(publishForm, /checked=\{renewalPreference === "AUTO"\}/);
  assert.match(publishForm, /onChange=\{\(\) => setRenewalPreference\("AUTO"\)\}/);
  assert.match(publishForm, /onChange=\{\(\) => setRenewalPreference\("MANUAL"\)\}/);
  assert.ok(publishForm.indexOf("Automatic renewal — Recommended") < publishForm.indexOf('<PaymentChoiceButton method="ONLINE"'));
});

test("renewal controls are localized, stacked tap cards before the payment methods", () => {
  for (const copy of [
    "Renewal",
    "Manual renewal",
    "€100/year. Renews automatically every year.",
    "€100/year. We’ll remind you before your membership expires.",
    "Rinnovo",
    "Rinnovo automatico — Consigliato",
    "Rinnovo manuale",
    "€100/anno. Si rinnova automaticamente ogni anno.",
    "€100/anno. Ti ricorderemo prima della scadenza.",
  ]) {
    assert.ok(publishForm.includes(copy), `missing localized renewal copy: ${copy}`);
  }

  assert.match(publishForm, /mt-4 grid gap-3/);
  assert.match(publishForm, /h-5 w-5 shrink-0 accent-\[var\(--primary\)\]/);
  assert.match(publishForm, /sm:p-5/);
});

test("card and bank-transfer choices pass the existing renewal mode into the current QR action", () => {
  assert.match(publishForm, /const selectedRenewalPreference = method === "BANK_TRANSFER" \? "MANUAL" : renewalPreference/);
  assert.match(publishForm, /formData\.set\("renewalPreference", selectedRenewalPreference\)/);
  assert.match(publishForm, /if \(method === "BANK_TRANSFER"\) \{\s*setRenewalPreference\("MANUAL"\)/);
  assert.match(submissionActions, /paymentMethod === "ONLINE" && getStringValue\(formData\.get\("renewalPreference"\)\) === "AUTO"/);
  assert.match(submissionActions, /Choose automatic or manual renewal before continuing/);
  assert.match(submissionActions, /Scegli prima il rinnovo automatico o manuale/);
  assert.match(stripeCheckout, /mode: automaticRenewal \? "subscription" : "payment"/);
});

test("the established QR, polling, webhook, and publication path remains in place", () => {
  assert.match(publishForm, /<PaymentChoiceButton method="ONLINE"/);
  assert.match(publishForm, /<PaymentChoiceButton method="BANK_TRANSFER"/);
  assert.match(paymentPage, /CheckoutStatusWatcher/);
  assert.match(paymentPage, /ensureStripeCheckoutSession/);
  assert.match(paymentPage, /ensureStripeBankTransferIntent/);
  assert.match(paymentSync, /publishSubmissionAfterPayment/);
  assert.match(webhook, /processPaidSubmissionWebhook/);
});
