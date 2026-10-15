import type { VerificationChannel } from "@prisma/client";
import {
  hasResendConfiguration,
  sendTransactionalEmail,
} from "@/lib/email";

type VerificationDeliveryParams = {
  channel: VerificationChannel;
  code: string;
  locale: "it" | "en";
  recipient: string;
  subject: "business-claim" | "business-submission";
};

type RuntimeEnv = NodeJS.ProcessEnv;

function trimEnvValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
}

function isProductionRuntime(env: RuntimeEnv) {
  return env.NODE_ENV === "production";
}

function buildDeliveryLabel({
  locale,
  subject,
}: Pick<VerificationDeliveryParams, "locale" | "subject">) {
  if (subject === "business-claim") {
    return locale === "it" ? "rivendicazione attivita" : "business claim";
  }

  return locale === "it" ? "verifica attivita" : "business verification";
}

function logVerificationFallback({
  channel,
  locale,
  subject,
}: VerificationDeliveryParams) {
  console.info(
    `[verification:${subject}] ${channel} delivery skipped in non-production (${buildDeliveryLabel({
      locale,
      subject,
    })})`,
  );
}

export function hasSmtpConfiguration(env: RuntimeEnv = process.env) {
  return Boolean(
    trimEnvValue(env.SMTP_HOST) &&
      trimEnvValue(env.SMTP_PORT) &&
      trimEnvValue(env.SMTP_USER) &&
      trimEnvValue(env.SMTP_PASS) &&
      trimEnvValue(env.SMTP_FROM),
  );
}

export function hasTransactionalEmailDelivery(env: RuntimeEnv = process.env) {
  return env.CONTROLLED_TEST_MODE === "true" || hasResendConfiguration(env) || hasSmtpConfiguration(env);
}

export function hasTwilioSmsConfiguration(env: RuntimeEnv = process.env) {
  const hasVerify = Boolean(
    trimEnvValue(env.TWILIO_ACCOUNT_SID) &&
      trimEnvValue(env.TWILIO_AUTH_TOKEN) &&
      trimEnvValue(env.TWILIO_VERIFY_SERVICE_SID),
  );

  if (hasVerify) {
    return true;
  }

  return Boolean(
    trimEnvValue(env.TWILIO_ACCOUNT_SID) &&
      trimEnvValue(env.TWILIO_AUTH_TOKEN) &&
      trimEnvValue(env.TWILIO_FROM_PHONE),
  );
}

export function hasTwilioVerifyConfiguration(env: RuntimeEnv = process.env) {
  return Boolean(
    trimEnvValue(env.TWILIO_ACCOUNT_SID) &&
      trimEnvValue(env.TWILIO_AUTH_TOKEN) &&
      trimEnvValue(env.TWILIO_VERIFY_SERVICE_SID),
  );
}

function resolveWhatsAppProvider(env: RuntimeEnv = process.env) {
  const explicitProvider = trimEnvValue(env.WHATSAPP_VERIFICATION_PROVIDER).toLowerCase();

  if (explicitProvider) {
    return explicitProvider;
  }

  if (
    trimEnvValue(env.META_WHATSAPP_ACCESS_TOKEN) &&
    trimEnvValue(env.META_WHATSAPP_PHONE_NUMBER_ID)
  ) {
    return "meta";
  }

  return "";
}

function normalizeWhatsAppRecipient(recipient: string) {
  const trimmed = recipient.trim();

  if (!trimmed) {
    return "";
  }

  const withoutPlus = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const normalized = withoutPlus.replace(/\D+/g, "");

  if (normalized.startsWith("00")) {
    return normalized.slice(2);
  }

  return normalized;
}

function resolveMetaTemplateLanguage(locale: "it" | "en", env: RuntimeEnv = process.env) {
  if (locale === "it") {
    return (
      trimEnvValue(env.META_WHATSAPP_TEMPLATE_LANGUAGE_IT) ||
      trimEnvValue(env.META_WHATSAPP_TEMPLATE_LANGUAGE) ||
      "it_IT"
    );
  }

  return (
    trimEnvValue(env.META_WHATSAPP_TEMPLATE_LANGUAGE_EN) ||
    trimEnvValue(env.META_WHATSAPP_TEMPLATE_LANGUAGE) ||
    "en_US"
  );
}

function resolveMetaTemplateName(
  subject: VerificationDeliveryParams["subject"],
  env: RuntimeEnv = process.env,
) {
  if (subject === "business-claim") {
    return (
      trimEnvValue(env.META_WHATSAPP_CLAIM_TEMPLATE_NAME) ||
      trimEnvValue(env.META_WHATSAPP_TEMPLATE_NAME)
    );
  }

  return (
    trimEnvValue(env.META_WHATSAPP_SUBMISSION_TEMPLATE_NAME) ||
    trimEnvValue(env.META_WHATSAPP_TEMPLATE_NAME)
  );
}

function buildEmailCopy({
  code,
  locale,
  subject,
}: Pick<VerificationDeliveryParams, "code" | "locale" | "subject">) {
  if (locale === "it") {
    return {
      html: `<p>Il tuo codice di verifica Salento Local e <strong>${code}</strong>.</p><p>Scade tra 15 minuti.</p>`,
      subject:
        subject === "business-claim"
          ? "Codice verifica rivendicazione Salento Local"
          : "Codice verifica attivita Salento Local",
      text: `Il tuo codice di verifica Salento Local e ${code}. Scade tra 15 minuti.`,
    };
  }

  return {
    html: `<p>Your Salento Local verification code is <strong>${code}</strong>.</p><p>It expires in 15 minutes.</p>`,
    subject:
      subject === "business-claim"
        ? "Your Salento Local business claim code"
        : "Your Salento Local verification code",
    text: `Your Salento Local verification code is ${code}. It expires in 15 minutes.`,
  };
}

function buildSmsBody({
  code,
  locale,
  subject,
}: Pick<VerificationDeliveryParams, "code" | "locale" | "subject">) {
  if (locale === "it") {
    return subject === "business-claim"
      ? `Codice Salento Local per rivendicare l'attivita: ${code}. Scade tra 15 minuti.`
      : `Codice Salento Local: ${code}. Scade tra 15 minuti.`;
  }

  return subject === "business-claim"
    ? `Your Salento Local business claim code is ${code}. It expires in 15 minutes.`
    : `Your Salento Local verification code is ${code}. It expires in 15 minutes.`;
}

async function sendEmailVerification(
  params: Omit<VerificationDeliveryParams, "channel">,
  env: RuntimeEnv = process.env,
) {
  if (!hasTransactionalEmailDelivery(env)) {
    if (!isProductionRuntime(env)) {
      logVerificationFallback({
        ...params,
        channel: "EMAIL",
      });
      console.warn(
        "[verification:email] SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM to send real emails.",
      );
      return;
    }

    throw new Error("smtp_configuration_missing");
  }

  const emailCopy = buildEmailCopy(params);

  await sendTransactionalEmail({
    headers: {
      "X-Transactional-Message": "verification",
    },
    html: emailCopy.html,
    subject: emailCopy.subject,
    text: emailCopy.text,
    to: params.recipient,
  }, env);
}

async function sendSmsVerification(
  params: Omit<VerificationDeliveryParams, "channel">,
  env: RuntimeEnv = process.env,
) {
  if (!hasTwilioSmsConfiguration(env)) {
    if (!isProductionRuntime(env)) {
      logVerificationFallback({
        ...params,
        channel: "SMS",
      });
      console.warn(
        "[verification:sms] Twilio SMS is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_PHONE to send real messages.",
      );
      return;
    }

    throw new Error("twilio_sms_configuration_missing");
  }

  const accountSid = trimEnvValue(env.TWILIO_ACCOUNT_SID);
  const authToken = trimEnvValue(env.TWILIO_AUTH_TOKEN);

  if (hasTwilioVerifyConfiguration(env)) {
    const verifyServiceSid = trimEnvValue(env.TWILIO_VERIFY_SERVICE_SID);
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`,
      {
        body: new URLSearchParams({
          Channel: "sms",
          Locale: params.locale,
          To: params.recipient,
        }),
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      },
    );

    const payload = (await response.json().catch(() => null)) as
      | {
          message?: string;
          sid?: string;
          status?: string;
        }
      | null;

    if (!response.ok) {
      console.error("[sms:twilio-verify] send failed", payload);
      throw new Error(
        payload?.message
          ? `twilio_verify_send_failed:${payload.message}`
          : `twilio_verify_send_failed:${response.status}`,
      );
    }

    console.info("[sms:twilio-verify] verification started", {
      recipient: params.recipient,
      status: payload?.status ?? null,
      subject: params.subject,
      verificationSid: payload?.sid ?? null,
    });
    return;
  }

  const fromPhone = trimEnvValue(env.TWILIO_FROM_PHONE);
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      body: new URLSearchParams({
        Body: buildSmsBody(params),
        From: fromPhone,
        To: params.recipient,
      }),
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        code?: number;
        message?: string;
        sid?: string;
      }
    | null;

  if (!response.ok) {
    console.error("[sms:twilio] send failed", payload);
    throw new Error(
      payload?.message
        ? `twilio_sms_send_failed:${payload.message}`
        : `twilio_sms_send_failed:${response.status}`,
    );
  }

  console.info("[sms:twilio] message sent", {
    messageSid: payload?.sid ?? null,
    recipient: params.recipient,
    subject: params.subject,
  });
}

export async function checkTwilioVerifyCode({
  code,
  recipient,
  env = process.env,
}: {
  code: string;
  env?: RuntimeEnv;
  recipient: string;
}) {
  if (!hasTwilioVerifyConfiguration(env)) {
    if (!isProductionRuntime(env)) {
      throw new Error("twilio_verify_configuration_missing");
    }

    throw new Error("twilio_verify_configuration_missing");
  }

  const accountSid = trimEnvValue(env.TWILIO_ACCOUNT_SID);
  const authToken = trimEnvValue(env.TWILIO_AUTH_TOKEN);
  const verifyServiceSid = trimEnvValue(env.TWILIO_VERIFY_SERVICE_SID);
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${verifyServiceSid}/VerificationCheck`,
    {
      body: new URLSearchParams({
        Code: code,
        To: recipient,
      }),
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        code?: number;
        message?: string;
        status?: string;
        valid?: boolean;
      }
    | null;

  if (response.status === 404) {
    return "expired" as const;
  }

  if (!response.ok) {
    console.error("[sms:twilio-verify] check failed", payload);
    throw new Error(
      payload?.message
        ? `twilio_verify_check_failed:${payload.message}`
        : `twilio_verify_check_failed:${response.status}`,
    );
  }

  if (payload?.status === "approved" || payload?.valid === true) {
    return "approved" as const;
  }

  if (payload?.status === "max_attempts_reached") {
    return "too_many_attempts" as const;
  }

  if (
    payload?.status === "expired" ||
    payload?.status === "canceled" ||
    payload?.status === "deleted" ||
    payload?.status === "failed"
  ) {
    return "expired" as const;
  }

  return "invalid" as const;
}

async function sendMetaWhatsAppVerification(
  params: Omit<VerificationDeliveryParams, "channel">,
  env: RuntimeEnv = process.env,
) {
  const accessToken = trimEnvValue(env.META_WHATSAPP_ACCESS_TOKEN);
  const phoneNumberId = trimEnvValue(env.META_WHATSAPP_PHONE_NUMBER_ID);
  const graphVersion = trimEnvValue(env.META_WHATSAPP_GRAPH_VERSION) || "v23.0";
  const templateName = resolveMetaTemplateName(params.subject, env);
  const templateLanguage = resolveMetaTemplateLanguage(params.locale, env);
  const normalizedRecipient = normalizeWhatsAppRecipient(params.recipient);

  if (!accessToken) {
    throw new Error("meta_whatsapp_access_token_missing");
  }

  if (!phoneNumberId) {
    throw new Error("meta_whatsapp_phone_number_id_missing");
  }

  if (!templateName) {
    throw new Error("meta_whatsapp_template_name_missing");
  }

  if (!normalizedRecipient) {
    throw new Error("meta_whatsapp_recipient_invalid");
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
    {
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        template: {
          components: [
            {
              parameters: [
                {
                  text: params.code,
                  type: "text",
                },
              ],
              type: "body",
            },
          ],
          language: {
            code: templateLanguage,
          },
          name: templateName,
        },
        to: normalizedRecipient,
        type: "template",
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: {
          code?: number;
          message?: string;
          type?: string;
        };
        messages?: Array<{ id?: string }>;
      }
    | null;

  if (!response.ok) {
    console.error("[whatsapp:meta] send failed", payload);
    throw new Error(
      payload?.error?.message
        ? `meta_whatsapp_send_failed:${payload.error.message}`
        : `meta_whatsapp_send_failed:${response.status}`,
    );
  }

  console.info("[whatsapp:meta] message sent", {
    messageId: payload?.messages?.[0]?.id ?? null,
    recipient: normalizedRecipient,
    subject: params.subject,
    templateLanguage,
    templateName,
  });
}

async function sendWhatsAppVerification(
  params: Omit<VerificationDeliveryParams, "channel">,
  env: RuntimeEnv = process.env,
) {
  const provider = resolveWhatsAppProvider(env);

  if (provider === "meta") {
    await sendMetaWhatsAppVerification(params, env);
    return;
  }

  if (!isProductionRuntime(env)) {
    logVerificationFallback({
      ...params,
      channel: "WHATSAPP",
    });
    console.warn(
      "[whatsapp] Meta WhatsApp Cloud API is not configured yet. Add the META_WHATSAPP_* env vars to send real messages.",
    );
    return;
  }

  if (!provider) {
    throw new Error("whatsapp_verification_provider_missing");
  }

  throw new Error(`unsupported_whatsapp_provider:${provider}`);
}

export async function sendVerificationCode(params: VerificationDeliveryParams) {
  if (params.channel === "EMAIL") {
    await sendEmailVerification(params);
    return;
  }

  if (params.channel === "SMS") {
    await sendSmsVerification(params);
    return;
  }

  if (params.channel === "WHATSAPP") {
    await sendWhatsAppVerification(params);
    return;
  }

  if (!isProductionRuntime(process.env)) {
    logVerificationFallback(params);
  }
}
