import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBankTransferReference,
  buildPaymentStatusForMethod,
  buildSubmissionTotals,
  isDraftLikeSubmission,
  getSubmissionPaymentSummary,
  getPaymentStatusLabel,
} from "@/lib/account";
import { canAccessSubmissionReceipt, resolveReceiptRecipient } from "@/lib/receipts";
import {
  getBankTransferDetails,
  getListingPayerEmail,
  getStripeEuBankTransferCountry,
  isCommissionEligible,
} from "@/lib/payment";
import {
  getPartnerOnboardingReturnDestination,
  getFriendlyPayoutSetupState,
  getNextPartnerPayoutDate,
  getPartnerMinimumPayoutCents,
  getPartnerPayoutDay,
  resolvePartnerOnboardingReturnTo,
} from "@/lib/partner-connect";

test("bank transfer reference uses the SL prefix", () => {
  assert.equal(buildBankTransferReference("clx12345678"), "SL-12345678");
});

test("payment status reflects the selected method", () => {
  assert.equal(buildPaymentStatusForMethod("ONLINE"), "PENDING_PAYMENT");
  assert.equal(buildPaymentStatusForMethod("BANK_TRANSFER"), "AWAITING_BANK_TRANSFER");
  assert.equal(buildPaymentStatusForMethod(undefined), "NOT_REQUIRED");
});

test("payment status labels append a reference when present", () => {
  assert.equal(
    getPaymentStatusLabel("AWAITING_BANK_TRANSFER", "en", "SL-12345678"),
    "Awaiting bank transfer · SL-12345678",
  );
});

test("pure drafts show none for method payment and paid", () => {
  assert.deepEqual(
    getSubmissionPaymentSummary(
      {
        amountOwedCents: 10000,
        amountPaidCents: 0,
        paymentMethod: null,
        paymentStatus: "NOT_REQUIRED",
        status: "DRAFT",
      },
      "en",
    ),
    {
      method: "None",
      paid: "None",
      payment: "None",
    },
  );
});

test("drafts with a selected payment method show awaiting approval and the listing amount", () => {
  assert.deepEqual(
    getSubmissionPaymentSummary(
      {
        amountOwedCents: 10000,
        amountPaidCents: 0,
        paymentMethod: "ONLINE",
        paymentStatus: "PENDING_PAYMENT",
        status: "DRAFT",
      },
      "en",
    ),
    {
      method: "QR / card",
      paid: "€100.00",
      payment: "Awaiting Approval",
    },
  );
});

test("unpaid payment-stage submissions still count as drafts until money is received", () => {
  assert.equal(
    isDraftLikeSubmission({
      paymentMethod: "ONLINE",
      paymentStatus: "PENDING_PAYMENT",
      status: "AWAITING_PAYMENT",
    }),
    true,
  );
  assert.equal(
    isDraftLikeSubmission({
      paymentMethod: "ONLINE",
      paymentStatus: "PAID",
      status: "PUBLISHED",
    }),
    false,
  );
});

test("receipt emails prefer the owner email before the business email", () => {
  assert.equal(
    resolveReceiptRecipient({
      businessEmail: "business@example.com",
      ownerEmail: "owner@example.com",
    }),
    "owner@example.com",
  );
  assert.equal(
    resolveReceiptRecipient({
      businessEmail: "business@example.com",
      ownerEmail: "",
    }),
    "business@example.com",
  );
  assert.equal(
    resolveReceiptRecipient({
      businessEmail: "",
      ownerEmail: "",
    }),
    null,
  );
});

test("Stripe Checkout never uses a Local Partner's email as the listing payer", () => {
  assert.equal(
    getListingPayerEmail({
      ownerEmail: "owner@example.com",
      submissionUserId: "partner-1",
      viewer: { email: "partner@example.com", id: "partner-1", role: "GETTER" },
    }),
    "owner@example.com",
  );
  assert.equal(
    getListingPayerEmail({
      ownerEmail: "",
      submissionUserId: "partner-1",
      viewer: { email: "partner@example.com", id: "partner-1", role: "GETTER" },
    }),
    undefined,
  );
});

test("direct publishers can use their own authenticated email as the listing payer", () => {
  assert.equal(
    getListingPayerEmail({
      ownerEmail: "",
      submissionUserId: "owner-1",
      viewer: { email: "owner@example.com", id: "owner-1", role: "BUSINESS_OWNER" },
    }),
    "owner@example.com",
  );
});

test("receipt access allows the submitting owner, linked partner, and admin only", () => {
  const receipt = { paymentPartnerUserId: "partner-1", submissionUserId: "owner-1" };

  assert.equal(canAccessSubmissionReceipt({ ...receipt, viewerId: "owner-1", viewerRole: "BUSINESS_OWNER" }), true);
  assert.equal(canAccessSubmissionReceipt({ ...receipt, viewerId: "partner-1", viewerRole: "GETTER" }), true);
  assert.equal(canAccessSubmissionReceipt({ ...receipt, viewerId: "admin-1", viewerRole: "ADMIN" }), true);
  assert.equal(
    canAccessSubmissionReceipt({
      paymentPartnerUserId: null,
      submissionUserId: "legacy-partner-1",
      viewerId: "legacy-partner-1",
      viewerRole: "GETTER",
    }),
    true,
  );
  assert.equal(canAccessSubmissionReceipt({ ...receipt, viewerId: "other-user", viewerRole: "GETTER" }), false);
  assert.equal(canAccessSubmissionReceipt({ ...receipt, viewerId: "partner-1", viewerRole: "BUSINESS_OWNER" }), false);
});

test("receipt access accepts only the secure post-checkout handoff without an account", () => {
  assert.equal(canAccessSubmissionReceipt({ allowInternal: true, submissionUserId: "owner-1" }), true);
  assert.equal(canAccessSubmissionReceipt({ submissionUserId: "owner-1" }), false);
});

test("commission only becomes eligible after payment and approval/publication", () => {
  assert.equal(
    isCommissionEligible({
      paymentStatus: "PAID",
      status: "PUBLISHED",
    }),
    true,
  );
  assert.equal(
    isCommissionEligible({
      paymentStatus: "PENDING_PAYMENT",
      status: "APPROVED",
    }),
    false,
  );
});

test("partner submission totals still track qualifying lifetime earnings", () => {
  const totals = buildSubmissionTotals(
    [
      {
        amountOwedCents: 0,
        amountPaidCents: 10000,
        commissionCents: 5000,
        paymentMethod: "ONLINE",
        paymentStatus: "PAID",
        status: "PUBLISHED",
      },
      {
        amountOwedCents: 0,
        amountPaidCents: 10000,
        commissionCents: 5000,
        paymentMethod: "ONLINE",
        paymentStatus: "PAID",
        status: "PUBLISHED",
      },
    ],
    "GETTER",
  );

  assert.equal(totals.earned, 10000);
  assert.equal(totals.owed, 0);
  assert.equal(totals.paid, 0);
});

test("bank transfer details are read from env without hardcoding", () => {
  const originalBeneficiary = process.env.SALENTO_LOCAL_BANK_BENEFICIARY;
  const originalIban = process.env.SALENTO_LOCAL_IBAN;
  const originalBankName = process.env.SALENTO_LOCAL_BANK_NAME;

  process.env.SALENTO_LOCAL_BANK_BENEFICIARY = "Salento Local SRL";
  process.env.SALENTO_LOCAL_IBAN = "IT00X0000000000000000000000";
  process.env.SALENTO_LOCAL_BANK_NAME = "Banca Demo";

  try {
    assert.deepEqual(getBankTransferDetails(), {
      bankName: "Banca Demo",
      beneficiary: "Salento Local SRL",
      iban: "IT00X0000000000000000000000",
    });
  } finally {
    process.env.SALENTO_LOCAL_BANK_BENEFICIARY = originalBeneficiary;
    process.env.SALENTO_LOCAL_IBAN = originalIban;
    process.env.SALENTO_LOCAL_BANK_NAME = originalBankName;
  }
});

test("stripe bank transfer country falls back to a supported EU virtual account country", () => {
  const originalCountry = process.env.STRIPE_BANK_TRANSFER_EU_COUNTRY;

  process.env.STRIPE_BANK_TRANSFER_EU_COUNTRY = "NL";
  assert.equal(getStripeEuBankTransferCountry(), "NL");

  process.env.STRIPE_BANK_TRANSFER_EU_COUNTRY = "IT";
  assert.equal(getStripeEuBankTransferCountry(), "IE");

  process.env.STRIPE_BANK_TRANSFER_EU_COUNTRY = originalCountry;
});

test("partner payout configuration falls back to the documented defaults", () => {
  const originalDay = process.env.PARTNER_PAYOUT_DAY;
  const originalMinimum = process.env.PARTNER_MINIMUM_PAYOUT_CENTS;

  process.env.PARTNER_PAYOUT_DAY = "tuesday";
  process.env.PARTNER_MINIMUM_PAYOUT_CENTS = "7500";
  assert.equal(getPartnerPayoutDay(), "tuesday");
  assert.equal(getPartnerMinimumPayoutCents(), 7500);

  process.env.PARTNER_PAYOUT_DAY = "sunday";
  process.env.PARTNER_MINIMUM_PAYOUT_CENTS = "0";
  assert.equal(getPartnerPayoutDay(), "friday");
  assert.equal(getPartnerMinimumPayoutCents(), 5000);

  process.env.PARTNER_PAYOUT_DAY = originalDay;
  process.env.PARTNER_MINIMUM_PAYOUT_CENTS = originalMinimum;
});

test("partner payout setup states are translated from Stripe account status safely", () => {
  assert.equal(
    getFriendlyPayoutSetupState({
      connectedAccountId: null,
      status: "NOT_STARTED",
    }),
    "setup-not-started",
  );
  assert.equal(
    getFriendlyPayoutSetupState({
      connectedAccountId: "acct_123",
      status: "INCOMPLETE",
    }),
    "setup-incomplete",
  );
  assert.equal(
    getFriendlyPayoutSetupState({
      connectedAccountId: "acct_123",
      status: "ACTION_REQUIRED",
    }),
    "action-required",
  );
  assert.equal(
    getFriendlyPayoutSetupState({
      connectedAccountId: "acct_123",
      status: "READY",
    }),
    "ready",
  );
});

test("partner onboarding return paths stay inside the app", () => {
  assert.equal(resolvePartnerOnboardingReturnTo("/publish"), "/publish");
  assert.equal(
    resolvePartnerOnboardingReturnTo("https://malicious.example.com/"),
    "/onboarding/partner",
  );
  assert.equal(resolvePartnerOnboardingReturnTo("//malicious.example.com"), "/onboarding/partner");
});

test("partner onboarding resumes the requested route only after Stripe is ready", () => {
  assert.equal(
    getPartnerOnboardingReturnDestination({
      appUrl: "https://salentolocal.com",
      returnTo: "/publish",
      setupState: "ready",
    }),
    "https://salentolocal.com/publish?stripeReturned=1&payoutSetup=ready",
  );

  assert.equal(
    getPartnerOnboardingReturnDestination({
      appUrl: "https://salentolocal.com",
      returnTo: "/publish",
      setupState: "action-required",
    }),
    "https://salentolocal.com/onboarding/partner?reason=publish&stripeReturned=1&payoutSetup=action-required",
  );
});

test("partner onboarding prefers the configured public app URL for Stripe return handling", () => {
  const originalAppUrl = process.env.APP_URL;
  const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  process.env.APP_URL = "https://salentolocal.com";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

  try {
    assert.equal(
      getPartnerOnboardingReturnDestination({
        appUrl: "http://internal-preview:3000",
        returnTo: "/dashboard",
        setupState: "ready",
      }),
      "https://salentolocal.com/dashboard?stripeReturned=1&payoutSetup=ready",
    );
  } finally {
    process.env.APP_URL = originalAppUrl;
    process.env.NEXT_PUBLIC_APP_URL = originalPublicAppUrl;
  }
});

test("partner onboarding can still use a secure request origin when env falls back to localhost", () => {
  const originalAppUrl = process.env.APP_URL;
  const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  delete process.env.APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

  try {
    assert.equal(
      getPartnerOnboardingReturnDestination({
        appUrl: "https://preview.salentolocal.com",
        returnTo: "/dashboard",
        setupState: "ready",
      }),
      "https://preview.salentolocal.com/dashboard?stripeReturned=1&payoutSetup=ready",
    );
  } finally {
    process.env.APP_URL = originalAppUrl;
    process.env.NEXT_PUBLIC_APP_URL = originalPublicAppUrl;
  }
});

test("next payout date follows the configured weekly payout day", () => {
  const originalDay = process.env.PARTNER_PAYOUT_DAY;
  const originalTimezone = process.env.PARTNER_PAYOUT_TIMEZONE;

  process.env.PARTNER_PAYOUT_DAY = "friday";
  process.env.PARTNER_PAYOUT_TIMEZONE = "Europe/Rome";

  const nextDate = getNextPartnerPayoutDate(new Date("2026-07-12T10:00:00.000Z"));
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    weekday: "long",
  }).format(nextDate);

  assert.equal(weekday.toLowerCase(), "friday");

  process.env.PARTNER_PAYOUT_DAY = originalDay;
  process.env.PARTNER_PAYOUT_TIMEZONE = originalTimezone;
});
