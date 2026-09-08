import assert from "node:assert/strict";
import test from "node:test";

import jsQR from "jsqr";
import { PNG } from "pngjs";

import {
  buildStripeCheckoutCancelUrl,
  buildStripeCheckoutSuccessUrl,
} from "@/lib/stripe-checkout";
import {
  buildStripePaymentQrPayload,
  generateStripePaymentQrDataUrl,
  getValidatedStripeCheckoutUrl,
  resolveStripePaymentQrDestination,
} from "@/lib/stripe-payment-qr";

const checkoutSessionId = "cs_test_a1ProductionQrRegression123456789";
const stripeCheckoutUrl =
  `https://checkout.stripe.com/c/pay/${checkoutSessionId}` +
  "#fidnandhYHdWcXxpYCc%2FJ2FgY2RwaXEnKSdpamZkaWAnPydscScpJ2JwZGZkaGppYFNkd2xka3EnPydmamtxd2ppJyknZHVsTmB8Jz8ndW5acWB2cVowNFF0clZwV1FvTnVGcGpVTVxtbW9gfUZwbzJKNFBAUkxvclVScVY0M0BPQmhmbnYwNk9DaHVgMGhgV3VLYUs1d0ZUcldgU0ddYmdfYmJTbE5cQDJ%2FQGozYTU1dDc3d1xrVDUnKSdjd2poVmB3c2B3Jz9xd3Bg";
const productionAppUrl = "https://web-production-6f26e.up.railway.app";

function decodePngDataUrl(dataUrl: string) {
  const png = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
}

test("the production payment QR uses a short public handoff while preserving Stripe's URL exactly", async () => {
  const payload = buildStripePaymentQrPayload({
    appUrl: productionAppUrl,
    checkoutSessionId,
    checkoutUrl: stripeCheckoutUrl,
    runtimeEnvironment: "production",
  });
  const parsedQrValue = new URL(payload.qrValue);

  assert.equal(payload.checkoutUrl, stripeCheckoutUrl);
  assert.equal(
    payload.qrValue,
    `${productionAppUrl}/pay/stripe/${checkoutSessionId}`,
  );
  assert.equal(parsedQrValue.protocol, "https:");
  assert.equal(parsedQrValue.hostname, "web-production-6f26e.up.railway.app");
  assert.equal(parsedQrValue.search, "");
  assert.ok(!payload.qrValue.includes("localhost"));
  assert.ok(!payload.qrValue.includes("railway.internal"));
  assert.ok(!payload.qrValue.includes("stripe-audit-web"));
  assert.ok(payload.qrValue.startsWith("https://"));

  const qrDataUrl = await generateStripePaymentQrDataUrl(payload.qrValue);
  assert.equal(decodePngDataUrl(qrDataUrl), payload.qrValue);
});

test("production payment QR construction rejects local, private, audit, relative, and non-Stripe URLs", () => {
  for (const appUrl of [
    "http://localhost:3000",
    "https://web.railway.internal",
    "https://stripe-audit-web-stripe-audit-run.up.railway.app",
  ]) {
    assert.throws(
      () => buildStripePaymentQrPayload({
        appUrl,
        checkoutSessionId,
        checkoutUrl: stripeCheckoutUrl,
        runtimeEnvironment: "production",
      }),
      /invalid_public_app_url/,
    );
  }

  for (const checkoutUrl of [
    "",
    "/checkout/session",
    "http://checkout.stripe.com/c/pay/not-secure",
    "https://stripe-audit-web.example/c/pay/not-stripe",
  ]) {
    assert.equal(getValidatedStripeCheckoutUrl(checkoutUrl), null);
  }
});

test("the public QR handoff resolves the stored session to Stripe's exact hosted URL", async () => {
  const result = await resolveStripePaymentQrDestination(checkoutSessionId, {
    findPayment: async () => ({ businessSubmissionId: "submission_123" }),
    retrieveCheckoutSession: async () => ({
      id: checkoutSessionId,
      metadata: { businessSubmissionId: "submission_123" },
      status: "open",
      url: stripeCheckoutUrl,
    }),
  });

  assert.deepEqual(result, { status: "ready", url: stripeCheckoutUrl });
});

test("the public QR handoff rejects a mismatched submission or unsafe redirect host", async () => {
  const mismatch = await resolveStripePaymentQrDestination(checkoutSessionId, {
    findPayment: async () => ({ businessSubmissionId: "submission_123" }),
    retrieveCheckoutSession: async () => ({
      id: checkoutSessionId,
      metadata: { businessSubmissionId: "submission_other" },
      status: "open",
      url: stripeCheckoutUrl,
    }),
  });
  const unsafe = await resolveStripePaymentQrDestination(checkoutSessionId, {
    findPayment: async () => ({ businessSubmissionId: "submission_123" }),
    retrieveCheckoutSession: async () => ({
      id: checkoutSessionId,
      metadata: { businessSubmissionId: "submission_123" },
      status: "open",
      url: "https://example.com/not-stripe",
    }),
  });

  assert.deepEqual(mismatch, { status: "not_available", url: null });
  assert.deepEqual(unsafe, { status: "not_available", url: null });
});

test("Checkout success and cancel URLs remain on the production Salento Local host", () => {
  assert.equal(
    buildStripeCheckoutSuccessUrl({
      appUrl: `${productionAppUrl}/`,
      submissionId: "submission/card & owner",
    }),
    `${productionAppUrl}/publish/payment/success?submission=submission%2Fcard%20%26%20owner&session={CHECKOUT_SESSION_ID}&locale=it`,
  );
  assert.equal(
    buildStripeCheckoutCancelUrl({
      appUrl: `${productionAppUrl}/`,
      submissionId: "submission/card & owner",
    }),
    `${productionAppUrl}/publish/payment/cancel?submission=submission%2Fcard%20%26%20owner`,
  );
});
