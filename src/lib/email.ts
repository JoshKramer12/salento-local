import nodemailer from "nodemailer";
import { Resend, type CreateEmailRequestOptions } from "resend";

import { normalizeEnvValue } from "@/lib/env";

type RuntimeEnv = NodeJS.ProcessEnv;

function trimEnvValue(value: string | undefined) {
  return normalizeEnvValue(value);
}

function extractEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim();
}

function normalizeFromValue(value: string) {
  if (!value) {
    return "";
  }

  if (value.includes("<") && value.includes(">")) {
    return value;
  }

  return `Salento Local <${value}>`;
}

function buildDkimConfiguration(env: RuntimeEnv = process.env) {
  const domainName = trimEnvValue(env.SMTP_DKIM_DOMAIN_NAME);
  const keySelector = trimEnvValue(env.SMTP_DKIM_SELECTOR);
  const privateKey = trimEnvValue(env.SMTP_DKIM_PRIVATE_KEY).replace(/\\n/g, "\n");

  if (!domainName || !keySelector || !privateKey) {
    return undefined;
  }

  return {
    domainName,
    keySelector,
    privateKey,
  };
}

export function getTransactionalFrom(env: RuntimeEnv = process.env) {
  const resendFrom = trimEnvValue(env.RESEND_FROM);

  if (resendFrom) {
    return normalizeFromValue(resendFrom);
  }

  return normalizeFromValue(trimEnvValue(env.SMTP_FROM));
}

export function getTransactionalReplyTo(env: RuntimeEnv = process.env) {
  const explicitReplyTo = trimEnvValue(env.SMTP_REPLY_TO);

  if (explicitReplyTo) {
    return explicitReplyTo;
  }

  const from = getTransactionalFrom(env);
  return from ? extractEmailAddress(from) : "";
}

export function createSmtpTransport(env: RuntimeEnv = process.env) {
  return nodemailer.createTransport({
    auth: {
      pass: trimEnvValue(env.SMTP_PASS),
      user: trimEnvValue(env.SMTP_USER),
    },
    connectionTimeout: 15_000,
    dkim: buildDkimConfiguration(env),
    greetingTimeout: 15_000,
    host: trimEnvValue(env.SMTP_HOST),
    port: Number(trimEnvValue(env.SMTP_PORT)),
    secure: Number(trimEnvValue(env.SMTP_PORT)) === 465,
    socketTimeout: 20_000,
  });
}

export function hasResendConfiguration(env: RuntimeEnv = process.env) {
  return Boolean(trimEnvValue(env.RESEND_API_KEY) && trimEnvValue(env.RESEND_FROM));
}

export function getTransactionalEmailProvider(env: RuntimeEnv = process.env) {
  return hasResendConfiguration(env) ? "resend" as const : "smtp" as const;
}

function getResendClient(env: RuntimeEnv = process.env) {
  return new Resend(trimEnvValue(env.RESEND_API_KEY));
}

type TransactionalAttachment = {
  content: Buffer | string;
  contentType?: string;
  filename: string;
};

type TransactionalEmailParams = {
  attachments?: TransactionalAttachment[];
  headers?: Record<string, string>;
  html: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  subject: string;
  text: string;
  to: string;
};

export function buildTransactionalMailOptions(params: {
  headers?: Record<string, string>;
}, env: RuntimeEnv = process.env) {
  const from = getTransactionalFrom(env);
  const replyTo = getTransactionalReplyTo(env);

  return {
    from,
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      "X-Mailer": "Salento Local",
      ...params.headers,
    },
    replyTo: replyTo || undefined,
    sender: replyTo || undefined,
  };
}

export async function sendTransactionalEmail(
  params: TransactionalEmailParams,
  env: RuntimeEnv = process.env,
) {
  if (getTransactionalEmailProvider(env) === "resend") {
    const resend = getResendClient(env);
    const options = buildTransactionalMailOptions(
      {
        headers: params.headers,
      },
      env,
    );
    // This SDK version forwards request options to fetch but does not yet type
    // the supported signal option. Only callers that supply a signal use it.
    const requestOptions: (CreateEmailRequestOptions & { signal?: AbortSignal }) | undefined = params.signal
      ? { idempotencyKey: params.idempotencyKey, signal: params.signal }
      : params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined;
    const result = await resend.emails.send(
      {
        attachments: params.attachments?.map((attachment) => ({
          content:
            typeof attachment.content === "string"
              ? attachment.content
              : attachment.content.toString("base64"),
          filename: attachment.filename,
        })),
        from: options.from,
        headers: options.headers,
        html: params.html,
        replyTo: options.replyTo,
        subject: params.subject,
        text: params.text,
        to: [params.to],
      },
      requestOptions,
    );

    if (result.error) {
      throw new Error(result.error.message || "resend_send_failed");
    }

    return {
      messageId: result.data?.id ?? null,
      provider: "resend" as const,
      success: true,
    };
  }

  const transporter = createSmtpTransport(env);
  const options = buildTransactionalMailOptions(
    {
      headers: params.headers,
    },
    env,
  );

  const result = await transporter.sendMail({
    ...options,
    attachments: params.attachments?.map((attachment) => ({
      content: attachment.content,
      contentType: attachment.contentType,
      filename: attachment.filename,
    })),
    headers: {
      ...options.headers,
      ...(params.idempotencyKey
        ? { "Resend-Idempotency-Key": params.idempotencyKey }
        : {}),
    },
    html: params.html,
    subject: params.subject,
    text: params.text,
    to: params.to,
  });

  return {
    messageId: result.messageId || null,
    provider: "smtp" as const,
    success: true,
  };
}
