import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildStripeCheckoutMetadata } from "@/lib/payment";

const publishForm = readFileSync("src/components/account/publish-form.tsx", "utf8");
const submissionActions = readFileSync("src/app/(account)/actions.ts", "utf8");
const stripeCheckout = readFileSync("src/lib/stripe-checkout.ts", "utf8");
const paymentPage = readFileSync("src/app/(account)/publish/payment/page.tsx", "utf8");
const paymentSync = readFileSync("src/lib/stripe-payment-sync.ts", "utf8");
const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

test("the initial membership payment step defaults to visibly selected automatic renewal", () => {
  assert.match(publishForm, /useState<"AUTO" \| "MANUAL">\("AUTO"\)/);
  assert.match(publishForm, /Automatic renewal — Recommended/);
  assert.match(publishForm, /checked=\{renewalPreference === "AUTO" && \(role !== "GETTER" \|\| Boolean\(ownerEmail\.trim\(\)\)\)\} disabled=\{role === "GETTER" && !ownerEmail\.trim\(\)\}/);
  assert.match(publishForm, /checked=\{renewalPreference === "MANUAL" \|\| \(role === "GETTER" && !ownerEmail\.trim\(\)\)\}/);
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
  assert.match(publishForm, /const selectedRenewalPreference = method === "BANK_TRANSFER" \|\| \(role === "GETTER" && !ownerEmail\.trim\(\)\) \? "MANUAL" : renewalPreference/);
  assert.match(publishForm, /formData\.set\("renewalPreference", selectedRenewalPreference\)/);
  assert.match(publishForm, /if \(method === "BANK_TRANSFER" \|\| \(role === "GETTER" && !ownerEmail\.trim\(\)\)\) \{\s*setRenewalPreference\("MANUAL"\)/);
  assert.match(submissionActions, /\(viewer\.role !== "GETTER" \|\| Boolean\(parsed\.data\.ownerEmail\?\.trim\(\)\)\) && getStringValue\(formData\.get\("renewalPreference"\)\) === "AUTO"/);
  assert.match(submissionActions, /Choose manual renewal for an owner without email/);
  assert.match(submissionActions, /Choose automatic or manual renewal before continuing/);
  assert.match(submissionActions, /Scegli prima il rinnovo automatico o manuale/);
  assert.match(stripeCheckout, /mode: automaticRenewal \? "subscription" : "payment"/);
});

test("the initial QR preparation preserves automatic renewal for the Checkout helper", () => {
  const initialOnlinePreparation = submissionActions.slice(
    submissionActions.indexOf("prepareOnline: async () =>"),
    submissionActions.indexOf("submissionId: id,"),
  );

  // Regression for the production defect: the selection was saved, but the
  // initial QR action reconstructed a Checkout submission without this field.
  assert.match(
    initialOnlinePreparation,
    /automaticRenewalAtAcceptance:\s*baseSubmissionData\.automaticRenewalAtAcceptance/,
  );
  assert.match(initialOnlinePreparation, /getInitialOnlinePaymentInterface/);
  assert.match(initialOnlinePreparation, /ensureNoEmailPaymentIntent\(id\)/);
  assert.ok(initialOnlinePreparation.indexOf("ensureNoEmailPaymentIntent(id)") < initialOnlinePreparation.indexOf("ensureStripeCheckoutSession"));

  // true creates the existing annual subscription Checkout; false stays a
  // one-time Checkout without a recurring price configuration.
  assert.match(
    stripeCheckout,
    /const automaticRenewal = Boolean\(params\.submission\.automaticRenewalAtAcceptance\)/,
  );
  assert.match(
    stripeCheckout,
    /\.\.\.\(automaticRenewal \? \{ recurring: \{ interval: "year" as const \} \} : \{\}\)/,
  );
  assert.match(stripeCheckout, /mode: automaticRenewal \? "subscription" : "payment"/);
  assert.match(stripeCheckout, /automaticRenewal,/);
  assert.match(stripeCheckout, /automaticRenewal: true/);

  assert.equal(
    buildStripeCheckoutMetadata({
      automaticRenewal: true,
      businessSubmissionId: "automatic-submission",
      userId: "user-1",
    }).automaticRenewal,
    "true",
  );
  assert.equal(
    buildStripeCheckoutMetadata({
      automaticRenewal: false,
      businessSubmissionId: "manual-submission",
      userId: "user-1",
    }).automaticRenewal,
    "false",
  );
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
