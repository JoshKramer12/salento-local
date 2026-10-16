import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildStripeCheckoutMetadata } from "@/lib/payment";

const publishForm = readFileSync("src/components/account/publish-form.tsx", "utf8");
const paymentSteps = readFileSync("src/components/account/pay-later-payment-steps.tsx", "utf8");
const submissionActions = readFileSync("src/app/(account)/actions.ts", "utf8");
const stripeCheckout = readFileSync("src/lib/stripe-checkout.ts", "utf8");
const paymentPage = readFileSync("src/app/(account)/publish/payment/page.tsx", "utf8");
const paymentSync = readFileSync("src/lib/stripe-payment-sync.ts", "utf8");
const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const paymentForm = readFileSync("src/components/account/no-email-payment-form.tsx", "utf8");
const successWatcher = readFileSync("src/components/account/no-email-success-watcher.tsx", "utf8");

test("email owners retain both renewal options and no-email owners see manual alone", () => {
  assert.match(publishForm, /autoAvailable=\{Boolean\(ownerEmail\.trim\(\)\)\}/);
  assert.match(publishForm, /value=\{renewalChosen \? effectiveRenewalPreference : null\}/);
  assert.match(paymentSteps, /\{autoAvailable \? <label/);
  assert.match(paymentSteps, /onChange=\{\(\) => onChange\("AUTO"\)\}/);
  assert.match(paymentSteps, /onChange=\{\(\) => onChange\("MANUAL"\)\}/);
  assert.match(paymentSteps, /disabled=\{!value\}/);
});

test("renewal controls are localized, stacked tap cards before the payment methods", () => {
  for (const copy of [
    "Renewal",
    "Manual renewal",
    "€100/year. Renews automatically every year.",
    "€100/year. We'll remind you before expiry.",
    "Rinnovo",
    "Rinnovo automatico",
    "Rinnovo manuale",
    "€100/anno. Si rinnova automaticamente ogni anno.",
    "€100/anno. Ti ricorderemo prima della scadenza.",
  ]) {
    assert.ok(paymentSteps.includes(copy), `missing localized renewal copy: ${copy}`);
  }
  assert.match(paymentSteps, /type="radio" name="renewalChoice" value="AUTO"/);
  assert.match(paymentSteps, /type="radio" name="renewalChoice" value="MANUAL"/);
  assert.match(publishForm, /<RenewalSelectionStep/);
  assert.match(publishForm, /<PaymentMethodStep/);
});

test("card and bank-transfer choices pass the existing renewal mode into the current QR action", () => {
  assert.match(publishForm, /if \(method === "BANK_TRANSFER" && renewalPreference === "AUTO"\)/);
  assert.match(publishForm, /const selectedRenewalPreference = !ownerEmail\.trim\(\) \? "MANUAL" : renewalPreference/);
  assert.match(publishForm, /formData\.set\("renewalPreference", selectedRenewalPreference\)/);
  assert.match(paymentSteps, /disabled=\{Boolean\(busyMethod\) \|\| renewal === "AUTO"\}/);
  assert.match(submissionActions, /Boolean\(parsed\.data\.ownerEmail\?\.trim\(\)\) && getStringValue\(formData\.get\("renewalPreference"\)\) === "AUTO"/);
  assert.match(submissionActions, /Choose manual renewal for an owner without email/);
  assert.match(submissionActions, /Choose automatic or manual renewal before continuing/);
  assert.match(submissionActions, /Scegli prima il rinnovo automatico o manuale/);
  assert.match(stripeCheckout, /mode: automaticRenewal \? "subscription" : "payment"/);
});

test("the initial QR preparation routes automatic to Subscription and manual to PaymentIntent", () => {
  const initialOnlinePreparation = submissionActions.slice(
    submissionActions.indexOf("prepareOnline: async () =>"),
    submissionActions.indexOf("submissionId: id,"),
  );

  // The saved renewal selection chooses the embedded setup before QR display.
  assert.match(
    initialOnlinePreparation,
    /const setup = baseSubmissionData\.automaticRenewalAtAcceptance/,
  );
  assert.match(initialOnlinePreparation, /ensureEmbeddedSubscription\(id\)/);
  assert.match(initialOnlinePreparation, /ensureManualElementPaymentIntent\(id\)/);
  assert.doesNotMatch(initialOnlinePreparation, /ensureStripeCheckoutSession/);

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
  assert.match(publishForm, /onOnline=\{\(\) => continueWithPaymentMethod\("ONLINE"\)\}/);
  assert.match(publishForm, /onBank=\{\(\) => continueWithPaymentMethod\("BANK_TRANSFER"\)\}/);
  assert.match(paymentPage, /CheckoutStatusWatcher/);
  assert.doesNotMatch(paymentPage, /ensureStripeCheckoutSession/);
  assert.match(paymentPage, /ensureStripeBankTransferIntent/);
  assert.match(paymentSync, /publishSubmissionAfterPayment/);
  assert.match(webhook, /processPaidSubmissionWebhook/);
});

test("no-email automatic renewal is absent from the UI and rejected by the server", () => {
  assert.match(publishForm, /autoAvailable=\{Boolean\(ownerEmail\.trim\(\)\)\}/);
  assert.match(paymentSteps, /\{autoAvailable \? <label[\s\S]*?<\/label> : null\}/);
  assert.match(submissionActions, /parsed\.data\.paymentMethod === "ONLINE" && !parsed\.data\.ownerEmail\?\.trim\(\) &&\s*getStringValue\(formData\.get\("renewalPreference"\)\) !== "MANUAL"/);
  assert.match(submissionActions, /automaticRenewalAtAcceptance:.*Boolean\(parsed\.data\.ownerEmail\?\.trim\(\)\).*=== "AUTO"/);
});

test("new initial card payments use embedded setup while historical Checkout handlers remain", () => {
  assert.match(paymentPage, /submission\.automaticRenewalAtAcceptance\s*\? await ensureEmbeddedSubscription\(submission\.id\)\s*: await ensureManualElementPaymentIntent\(submission\.id\)/);
  assert.match(webhook, /getVerifiedInitialSubscriptionInvoice\(currentInvoice\)/);
  assert.match(webhook, /invoice\.billing_reason === "subscription_create"/);
  assert.match(webhook, /finalizeMembershipRenewalPayment/);
  assert.match(webhook, /checkout\.session\.completed/);
});

test("processing UX keeps Pay disabled, shows localized spinner, and offers safe status checks", () => {
  assert.match(paymentForm, /submitting\.current = true/);
  assert.match(paymentForm, /disabled=\{!stripe \|\| !elements \|\| busy \|\| walletPending\}/);
  assert.match(paymentForm, /payment-processing-spinner/);
  for (const copy of [
    "Processing your payment", "Please wait while we confirm your payment. Do not close this page.",
    "Pagamento in elaborazione", "Attendi mentre confermiamo il pagamento. Non chiudere questa pagina.",
    "Your payment is taking a little longer to confirm.", "La conferma del pagamento sta richiedendo",
    "Check payment status", "Controlla lo stato del pagamento",
  ]) assert.ok(paymentForm.includes(copy) || successWatcher.includes(copy), `missing processing copy: ${copy}`);
  assert.match(paymentForm, /setBusy\(false\)/);
  assert.doesNotMatch(paymentForm, /Pay again|Paga di nuovo/);
});
