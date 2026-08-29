import type Stripe from "stripe";
import { PartnerStripeAccountStatus } from "@prisma/client";

import { sendTransactionalEmail } from "@/lib/email";
import type { Locale } from "@/lib/i18n";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { getSafeInternalRedirect } from "@/lib/redirects";
import { runThrottledServerTask } from "@/lib/server-throttle";
import { getStripe } from "@/lib/stripe";

type PartnerProfileSnapshot = {
  baseTownOrArea: string;
  billingAddress: string;
  fullName: string;
  id: string;
  legalFullName: string;
  phone: string;
  preferredLanguage: string;
  stripeAccountStatus: PartnerStripeAccountStatus;
  stripeConnectedAccountId: string | null;
  stripeOnboardingStartedAt: Date | null;
  taxIdOrVatNumber: string;
  user: {
    email: string;
    id: string;
  };
};

type PartnerPayoutSetupState =
  | "setup-not-started"
  | "setup-incomplete"
  | "action-required"
  | "ready"
  | "restricted";

export type PartnerOnboardingReturnState = PartnerPayoutSetupState | "missing";

const connectCountryOptions = ["IT", "DE", "FR", "IE", "NL", "ES"] as const;
const payoutDayOptions = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
] as const;
const defaultPartnerOnboardingReturnTo = "/onboarding/partner";
const PARTNER_STRIPE_STATUS_SYNC_MIN_INTERVAL_MS = 2 * 60 * 1000;

type StripeConnectedAccount = Stripe.Account & {
  external_accounts?: Stripe.ApiList<Stripe.BankAccount | Stripe.Card>;
};

function trimValue(value: string | null | undefined) {
  return value?.trim() || "";
}

function splitName(fullName: string) {
  const pieces = fullName.trim().split(/\s+/).filter(Boolean);

  if (pieces.length <= 1) {
    return {
      firstName: pieces[0] || fullName.trim(),
      lastName: "",
    };
  }

  return {
    firstName: pieces.slice(0, -1).join(" "),
    lastName: pieces[pieces.length - 1],
  };
}

function getSupportedConnectCountry() {
  const configured = trimValue(process.env.STRIPE_CONNECT_COUNTRY).toUpperCase();

  if (connectCountryOptions.includes(configured as (typeof connectCountryOptions)[number])) {
    return configured;
  }

  return "IT";
}

function getPartnerBusinessProfileUrl() {
  try {
    const appUrl = new URL(getAppUrl());

    if (appUrl.protocol !== "https:") {
      return undefined;
    }

    if (
      appUrl.hostname === "localhost" ||
      appUrl.hostname === "127.0.0.1" ||
      appUrl.hostname === "::1"
    ) {
      return undefined;
    }

    return appUrl.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function getPartnerCommissionCents() {
  const configured = Number.parseInt(trimValue(process.env.PARTNER_COMMISSION_CENTS), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 5000;
}

export function getPartnerMinimumPayoutCents() {
  const configured = Number.parseInt(trimValue(process.env.PARTNER_MINIMUM_PAYOUT_CENTS), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 5000;
}

export function getPartnerPayoutDay() {
  const configured = trimValue(process.env.PARTNER_PAYOUT_DAY).toLowerCase();

  if (payoutDayOptions.includes(configured as (typeof payoutDayOptions)[number])) {
    return configured as (typeof payoutDayOptions)[number];
  }

  return "friday";
}

export function getPartnerPayoutTimezone() {
  return trimValue(process.env.PARTNER_PAYOUT_TIMEZONE) || "Europe/Rome";
}

function resolveConnectAppUrl(appUrl: string | null | undefined) {
  const explicit = trimValue(appUrl);
  const configured = trimValue(process.env.APP_URL) || trimValue(process.env.NEXT_PUBLIC_APP_URL);
  const fallback = getAppUrl();

  function normalizeUrl(candidate: string) {
    try {
      return new URL(candidate).toString().replace(/\/+$/, "");
    } catch {
      return null;
    }
  }

  function isSecurePublicUrl(candidate: string) {
    try {
      const parsed = new URL(candidate);
      return (
        parsed.protocol === "https:" &&
        parsed.hostname !== "localhost" &&
        parsed.hostname !== "127.0.0.1" &&
        parsed.hostname !== "::1"
      );
    } catch {
      return false;
    }
  }

  const normalizedConfigured = configured ? normalizeUrl(configured) : null;
  const normalizedExplicit = explicit ? normalizeUrl(explicit) : null;
  const normalizedFallback = normalizeUrl(fallback);

  if (explicit && normalizedExplicit && isSecurePublicUrl(explicit)) {
    return normalizedExplicit;
  }

  if (configured && normalizedConfigured && isSecurePublicUrl(configured)) {
    return normalizedConfigured;
  }

  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  if (normalizedConfigured) {
    return normalizedConfigured;
  }

  return normalizedFallback ?? fallback;
}

export function resolvePartnerOnboardingReturnTo(value: string | null | undefined) {
  return getSafeInternalRedirect(trimValue(value)) ?? defaultPartnerOnboardingReturnTo;
}

function buildConnectReturnUrl(params: {
  appUrl: string;
  locale: Locale;
  returnTo: string;
}) {
  const nextUrl = new URL(
    "/api/stripe/connect/onboarding/return",
    resolveConnectAppUrl(params.appUrl),
  );
  nextUrl.searchParams.set("locale", params.locale);
  nextUrl.searchParams.set("returnTo", params.returnTo);

  return nextUrl.toString();
}

function buildConnectRefreshUrl(params: {
  appUrl: string;
  locale: Locale;
  returnTo: string;
}) {
  const nextUrl = new URL(
    "/api/stripe/connect/onboarding/refresh",
    resolveConnectAppUrl(params.appUrl),
  );
  nextUrl.searchParams.set("locale", params.locale);
  nextUrl.searchParams.set("returnTo", params.returnTo);

  return nextUrl.toString();
}

function buildRequirementSnapshot(account: Stripe.Account) {
  return {
    currentlyDue: account.requirements?.currently_due ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
    eventuallyDue: account.requirements?.eventually_due ?? [],
    pastDue: account.requirements?.past_due ?? [],
    pendingVerification: account.requirements?.pending_verification ?? [],
  };
}

function resolveStripeAccountStatus(account: Stripe.Account): PartnerStripeAccountStatus {
  const requirements = buildRequirementSnapshot(account);
  const hasHardRestriction =
    Boolean(requirements.disabledReason) || requirements.pastDue.length > 0;
  const hasOutstandingRequirements =
    requirements.currentlyDue.length > 0 ||
    requirements.eventuallyDue.length > 0 ||
    requirements.pendingVerification.length > 0;

  if (account.payouts_enabled && account.details_submitted && !hasHardRestriction) {
    return "READY";
  }

  if (!account.details_submitted) {
    return "INCOMPLETE";
  }

  if (hasHardRestriction) {
    return "RESTRICTED";
  }

  if (hasOutstandingRequirements || !account.payouts_enabled) {
    return "ACTION_REQUIRED";
  }

  return "INCOMPLETE";
}

function mapStatusToSetupState(
  status: PartnerStripeAccountStatus,
  connectedAccountId: string | null,
): PartnerPayoutSetupState {
  if (!connectedAccountId || status === "NOT_STARTED") {
    return "setup-not-started";
  }

  if (status === "READY") {
    return "ready";
  }

  if (status === "RESTRICTED") {
    return "restricted";
  }

  if (status === "ACTION_REQUIRED") {
    return "action-required";
  }

  return "setup-incomplete";
}

export function getFriendlyPayoutSetupState(params: {
  connectedAccountId: string | null;
  status: PartnerStripeAccountStatus;
}) {
  return mapStatusToSetupState(params.status, params.connectedAccountId);
}

function getFriendlySetupMessageKey(state: PartnerPayoutSetupState) {
  switch (state) {
    case "ready":
      return "ready";
    case "action-required":
      return "action-required";
    case "restricted":
      return "restricted";
    case "setup-incomplete":
      return "setup-incomplete";
    default:
      return "setup-not-started";
  }
}

function buildStoredPartnerStripeStatusSummary(params: {
  connectedAccountId: string | null;
  payoutsEnabled?: boolean;
  status: PartnerStripeAccountStatus;
}) {
  return {
    connectedAccountId: params.connectedAccountId,
    payoutsEnabled: params.payoutsEnabled ?? false,
    setupState: getFriendlyPayoutSetupState({
      connectedAccountId: params.connectedAccountId,
      status: params.status,
    }),
    status: params.status,
  };
}

async function sendPartnerSetupStatusEmail(params: {
  email: string;
  locale: Locale;
  nextState: PartnerPayoutSetupState;
}) {
  const key = getFriendlySetupMessageKey(params.nextState);

  if (key === "setup-not-started" || key === "setup-incomplete") {
    return;
  }

  const copy =
    params.locale === "it"
      ? {
          "action-required": {
            html:
              "<p>Stripe ha bisogno di alcune informazioni aggiuntive prima che i tuoi pagamenti possano continuare.</p><p>Accedi a Salento Local e aggiorna i tuoi dati di pagamento.</p>",
            subject: "Aggiorna i tuoi dati pagamento Salento Local",
            text:
              "Stripe ha bisogno di alcune informazioni aggiuntive prima che i tuoi pagamenti possano continuare. Accedi a Salento Local e aggiorna i tuoi dati di pagamento.",
          },
          ready: {
            html:
              "<p>Il tuo conto bancario e collegato e sei pronto a ricevere i pagamenti da Salento Local.</p>",
            subject: "I tuoi pagamenti Salento Local sono pronti",
            text:
              "Il tuo conto bancario e collegato e sei pronto a ricevere i pagamenti da Salento Local.",
          },
          restricted: {
            html:
              "<p>Stripe ha bisogno di alcune informazioni aggiuntive prima che i tuoi pagamenti possano continuare.</p><p>Accedi a Salento Local e controlla i dettagli del tuo conto pagamento.</p>",
            subject: "I tuoi pagamenti Salento Local richiedono attenzione",
            text:
              "Stripe ha bisogno di alcune informazioni aggiuntive prima che i tuoi pagamenti possano continuare. Accedi a Salento Local e controlla i dettagli del tuo conto pagamento.",
          },
        }
      : {
          "action-required": {
            html:
              "<p>Stripe needs some additional information before your payouts can continue.</p><p>Log in to Salento Local and update your payout details.</p>",
            subject: "Update your Salento Local payout details",
            text:
              "Stripe needs some additional information before your payouts can continue. Log in to Salento Local and update your payout details.",
          },
          ready: {
            html:
              "<p>Your bank account is connected and you are ready to receive Salento Local payouts.</p>",
            subject: "Your Salento Local payouts are ready",
            text:
              "Your bank account is connected and you are ready to receive Salento Local payouts.",
          },
          restricted: {
            html:
              "<p>Stripe needs some additional information before your payouts can continue.</p><p>Log in to Salento Local and review your payout details.</p>",
            subject: "Your Salento Local payouts need attention",
            text:
              "Stripe needs some additional information before your payouts can continue. Log in to Salento Local and review your payout details.",
          },
        };

  await sendTransactionalEmail({
    headers: {
      "X-Transactional-Message": "partner-payout-setup",
    },
    html: copy[key].html,
    subject: copy[key].subject,
    text: copy[key].text,
    to: params.email,
  });
}

function queuePartnerSetupStatusEmail(params: {
  email: string;
  locale: Locale;
  nextState: PartnerPayoutSetupState;
}) {
  void sendPartnerSetupStatusEmail(params).catch((error) => {
    console.error("[partner-connect:setup-status-email]", error);
  });
}

async function ensureManualPayoutSchedule(accountId: string) {
  const stripe = getStripe();

  try {
    await stripe.balanceSettings.update(
      {
        payments: {
          payouts: {
            schedule: {
              interval: "manual",
            },
          },
        },
      },
      {
        stripeAccount: accountId,
      },
    );
  } catch {
    // Keep sync resilient. If Stripe rejects manual schedule for the account,
    // we still keep the account state in sync and surface it in the dashboard.
  }
}

export async function ensurePartnerStripeAccount(userId: string) {
  const profile = await prisma.localPartnerProfile.findUnique({
    where: {
      userId,
    },
    include: {
      user: {
        select: {
          email: true,
          id: true,
        },
      },
    },
  });

  if (!profile) {
    throw new Error("partner_profile_missing");
  }

  if (profile.stripeConnectedAccountId) {
    return profile.stripeConnectedAccountId;
  }

  const stripe = getStripe();
  const { firstName, lastName } = splitName(profile.legalFullName || profile.fullName);
  const businessProfileUrl = getPartnerBusinessProfileUrl();
  const account = await stripe.accounts.create({
    business_profile: {
      product_description: "Salento Local partner commissions",
      url: businessProfileUrl,
    },
    capabilities: {
      transfers: {
        requested: true,
      },
    },
    country: getSupportedConnectCountry(),
    email: profile.user.email,
    individual: {
      first_name: firstName || undefined,
      last_name: lastName || undefined,
    },
    metadata: {
      localPartnerProfileId: profile.id,
      salentoLocalUserId: profile.user.id,
    },
    type: "express",
  });

  await prisma.localPartnerProfile.update({
    where: {
      id: profile.id,
    },
    data: {
      stripeAccountStatus: "INCOMPLETE",
      stripeConnectedAccountId: account.id,
      stripeOnboardingStartedAt: profile.stripeOnboardingStartedAt ?? new Date(),
    },
  });

  return account.id;
}

function getPrimaryExternalBank(account: StripeConnectedAccount) {
  const bankAccount = account.external_accounts?.data.find(
    (external): external is Stripe.BankAccount => external.object === "bank_account",
  );

  return bankAccount
    ? {
        bankName: bankAccount.bank_name || null,
        last4: bankAccount.last4 || null,
      }
    : {
        bankName: null,
        last4: null,
      };
}

export async function syncPartnerStripeAccountStatus(
  userId: string,
  options: {
    force?: boolean;
    minIntervalMs?: number;
  } = {},
) {
  const profile = await prisma.localPartnerProfile.findUnique({
    where: {
      userId,
    },
    include: {
      user: {
        select: {
          email: true,
          id: true,
        },
      },
    },
  });

  if (!profile?.stripeConnectedAccountId) {
    return profile
      ? buildStoredPartnerStripeStatusSummary({
          connectedAccountId: null,
          payoutsEnabled: false,
          status: profile.stripeAccountStatus,
        })
      : null;
  }

  const minIntervalMs = options.minIntervalMs ?? PARTNER_STRIPE_STATUS_SYNC_MIN_INTERVAL_MS;
  const lastSyncedAt = profile.stripeLastSyncedAt?.getTime() ?? 0;

  if (!options.force && Date.now() - lastSyncedAt < minIntervalMs) {
    return buildStoredPartnerStripeStatusSummary({
      connectedAccountId: profile.stripeConnectedAccountId,
      payoutsEnabled: profile.stripePayoutsEnabled,
      status: profile.stripeAccountStatus,
    });
  }

  const synced = await runThrottledServerTask({
    force: options.force,
    key: userId,
    minIntervalMs,
    task: async () => {
      const stripe = getStripe();
      const account = (await stripe.accounts.retrieve(profile.stripeConnectedAccountId!, {
        expand: ["external_accounts"],
      })) as StripeConnectedAccount;
      const nextStatus = resolveStripeAccountStatus(account);
      const setupState = getFriendlyPayoutSetupState({
        connectedAccountId: account.id,
        status: nextStatus,
      });
      const previousState = getFriendlyPayoutSetupState({
        connectedAccountId: profile.stripeConnectedAccountId,
        status: profile.stripeAccountStatus,
      });
      const requirements = buildRequirementSnapshot(account);
      const bank = getPrimaryExternalBank(account);

      if (account.details_submitted) {
        await ensureManualPayoutSchedule(account.id);
      }

      await prisma.localPartnerProfile.update({
        where: {
          id: profile.id,
        },
        data: {
          stripeAccountStatus: nextStatus,
          stripeChargesEnabled: account.charges_enabled,
          stripeCurrentDeadline: account.requirements?.current_deadline
            ? new Date(account.requirements.current_deadline * 1000)
            : null,
          stripeDetailsSubmitted: account.details_submitted,
          stripeDisabledReason: account.requirements?.disabled_reason ?? null,
          stripeLastSyncedAt: new Date(),
          stripeOnboardingComplete:
            account.details_submitted &&
            requirements.currentlyDue.length === 0 &&
            requirements.pastDue.length === 0,
          stripeOnboardingCompletedAt:
            nextStatus === "READY" && !profile.stripeOnboardingCompletedAt
              ? new Date()
              : profile.stripeOnboardingCompletedAt,
          stripePayoutAccountLast4: bank.last4,
          stripePayoutBankName: bank.bankName,
          stripePayoutsEnabled: account.payouts_enabled,
          stripeRequirementsDue: requirements,
        },
      });

      if (previousState !== setupState) {
        const locale = profile.preferredLanguage === "en" ? "en" : "it";
        queuePartnerSetupStatusEmail({
          email: profile.user.email,
          locale,
          nextState: setupState,
        });
      }

      return {
        connectedAccountId: account.id,
        payoutsEnabled: account.payouts_enabled,
        setupState,
        status: nextStatus,
      };
    },
    taskName: "partner-stripe-account-status-sync",
  });

  return (
    synced ??
    buildStoredPartnerStripeStatusSummary({
      connectedAccountId: profile.stripeConnectedAccountId,
      payoutsEnabled: profile.stripePayoutsEnabled,
      status: profile.stripeAccountStatus,
    })
  );
}

export async function syncPartnerStripeAccountStatusByConnectedAccountId(
  connectedAccountId: string,
) {
  const profile = await prisma.localPartnerProfile.findUnique({
    where: {
      stripeConnectedAccountId: connectedAccountId,
    },
    select: {
      userId: true,
    },
  });

  if (!profile) {
    return null;
  }

  return syncPartnerStripeAccountStatus(profile.userId, {
    force: true,
  });
}

export async function createPartnerOnboardingLink(params: {
  appUrl?: string;
  locale: Locale;
  returnTo?: string | null;
  userId: string;
}) {
  const accountId = await ensurePartnerStripeAccount(params.userId);
  const stripe = getStripe();
  const appUrl = resolveConnectAppUrl(params.appUrl);
  const returnTo = resolvePartnerOnboardingReturnTo(params.returnTo);
  const link = await stripe.accountLinks.create({
    account: accountId,
    collection_options: {
      fields: "eventually_due",
      future_requirements: "include",
    },
    refresh_url: buildConnectRefreshUrl({
      appUrl,
      locale: params.locale,
      returnTo,
    }),
    return_url: buildConnectReturnUrl({
      appUrl,
      locale: params.locale,
      returnTo,
    }),
    type: "account_onboarding",
  });

  return {
    accountId,
    url: link.url,
  };
}

export async function createPartnerOnboardingAccountSession(userId: string) {
  const accountId = await ensurePartnerStripeAccount(userId);
  const stripe = getStripe();
  const accountSession = await stripe.accountSessions.create({
    account: accountId,
    components: {
      account_onboarding: {
        enabled: true,
        features: {
          external_account_collection: true,
        },
      },
    },
  });

  return {
    accountId,
    clientSecret: accountSession.client_secret,
  };
}

export async function handlePartnerOnboardingReturn(userId: string) {
  const synced = await syncPartnerStripeAccountStatus(userId, {
    force: true,
  });

  if (!synced) {
    return "missing";
  }

  return synced.setupState;
}

export function getPartnerOnboardingReturnDestination(params: {
  appUrl: string;
  returnTo?: string | null;
  setupState: PartnerOnboardingReturnState;
}) {
  const appUrl = resolveConnectAppUrl(params.appUrl);
  const requestedReturnTo = resolvePartnerOnboardingReturnTo(params.returnTo);
  const successfulReturnTo = requestedReturnTo;
  const shouldResumeRequestedRoute = params.setupState === "ready";
  const destination = shouldResumeRequestedRoute
    ? new URL(successfulReturnTo, appUrl)
    : new URL(defaultPartnerOnboardingReturnTo, appUrl);

  if (!shouldResumeRequestedRoute && requestedReturnTo.startsWith("/publish")) {
    destination.searchParams.set("reason", "publish");
  }

  destination.searchParams.set("stripeReturned", "1");

  if (params.setupState !== "missing") {
    destination.searchParams.set("payoutSetup", params.setupState);
  }

  return destination.toString();
}

export async function warmPartnerStripeAccount(userId: string) {
  try {
    await ensurePartnerStripeAccount(userId);
    return true;
  } catch (error) {
    console.error("[partner-connect:warm-account]", error);
    return false;
  }
}

export async function getPartnerPayoutSetupSummary(userId: string) {
  const profile = await prisma.localPartnerProfile.findUnique({
    where: {
      userId,
    },
    select: {
      stripeAccountStatus: true,
      stripeConnectedAccountId: true,
      stripeCurrentDeadline: true,
      stripeDisabledReason: true,
      stripePayoutAccountLast4: true,
      stripePayoutBankName: true,
      stripePayoutsEnabled: true,
      stripeRequirementsDue: true,
      preferredPayoutMethod: true,
      payoutSetupStatus: true,
      paypalPayoutEmail: true,
      bankPayoutAccountLast4: true,
    },
  });

  if (!profile) {
    return null;
  }

  const stripeSetupState = getFriendlyPayoutSetupState({
    connectedAccountId: profile.stripeConnectedAccountId,
    status: profile.stripeAccountStatus,
  });
  const usesStripe = profile.preferredPayoutMethod === "STRIPE";
  const setupState = usesStripe
    ? stripeSetupState
    : profile.payoutSetupStatus === "READY"
      ? "ready"
      : profile.payoutSetupStatus === "ACTION_REQUIRED"
        ? "action-required"
        : "setup-incomplete";

  return {
    bankAccountLast4: profile.stripePayoutAccountLast4,
    bankName: usesStripe ? profile.stripePayoutBankName : null,
    destinationLast4: usesStripe
      ? profile.stripePayoutAccountLast4
      : profile.preferredPayoutMethod === "PAYPAL"
        ? null
        : profile.bankPayoutAccountLast4,
    connectedAccountId: profile.stripeConnectedAccountId,
    currentDeadline: profile.stripeCurrentDeadline,
    disabledReason: profile.stripeDisabledReason,
    payoutsEnabled: profile.stripePayoutsEnabled,
    payoutMethod: profile.preferredPayoutMethod,
    payoutSetupStatus: profile.payoutSetupStatus,
    paypalPayoutEmail: profile.paypalPayoutEmail,
    requirementsDue: profile.stripeRequirementsDue,
    setupState,
    status: profile.stripeAccountStatus,
  };
}

export function getNextPartnerPayoutDate(fromDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: getPartnerPayoutTimezone(),
    weekday: "long",
  });
  const normalizedTargetDay = getPartnerPayoutDay();
  const date = new Date(fromDate);

  for (let index = 0; index < 14; index += 1) {
    const weekday = formatter.format(date).toLowerCase();

    if (weekday === normalizedTargetDay) {
      return date;
    }

    date.setDate(date.getDate() + 1);
  }

  return fromDate;
}
