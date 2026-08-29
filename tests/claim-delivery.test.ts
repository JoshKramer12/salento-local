import assert from "node:assert/strict";
import test from "node:test";

import { sendVerificationCode } from "@/lib/claim-delivery";

const envKeys = [
  "NODE_ENV",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_PHONE",
  "TWILIO_VERIFY_SERVICE_SID",
] as const;

function withTempEnv(overrides: Partial<Record<(typeof envKeys)[number], string | undefined>>) {
  const envStore = process.env as Record<string, string | undefined>;
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  for (const key of envKeys) {
    const nextValue = overrides[key];

    if (typeof nextValue === "undefined") {
      delete envStore[key];
    } else {
      envStore[key] = nextValue;
    }
  }

  return () => {
    for (const key of envKeys) {
      const previousValue = previous[key];

      if (typeof previousValue === "undefined") {
        delete envStore[key];
      } else {
        envStore[key] = previousValue;
      }
    }
  };
}

function captureConsole() {
  const info: string[] = [];
  const warn: string[] = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;

  console.info = (...args: unknown[]) => {
    info.push(args.map((value) => String(value)).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    warn.push(args.map((value) => String(value)).join(" "));
  };

  return {
    info,
    restore() {
      console.info = originalInfo;
      console.warn = originalWarn;
    },
    warn,
  };
}

test("missing SMTP env vars in dev does not throw or expose a code", async () => {
  const restoreEnv = withTempEnv({
    NODE_ENV: "development",
    SMTP_FROM: undefined,
    SMTP_HOST: undefined,
    SMTP_PASS: undefined,
    SMTP_PORT: undefined,
    SMTP_USER: undefined,
  });
  const consoleCapture = captureConsole();

  try {
    await sendVerificationCode({
      channel: "EMAIL",
      code: "123456",
      locale: "en",
      recipient: "owner@example.com",
      subject: "business-claim",
    });

    assert.ok(consoleCapture.info.every((line) => !line.includes("123456")));
    assert.ok(consoleCapture.info.every((line) => !line.includes("owner@example.com")));
    assert.ok(consoleCapture.warn.some((line) => line.includes("SMTP")));
  } finally {
    consoleCapture.restore();
    restoreEnv();
  }
});

test("missing Twilio env vars in dev does not expose the SMS code", async () => {
  const restoreEnv = withTempEnv({
    NODE_ENV: "development",
    TWILIO_ACCOUNT_SID: undefined,
    TWILIO_AUTH_TOKEN: undefined,
    TWILIO_FROM_PHONE: undefined,
    TWILIO_VERIFY_SERVICE_SID: undefined,
  });
  const consoleCapture = captureConsole();

  try {
    await sendVerificationCode({
      channel: "SMS",
      code: "654321",
      locale: "en",
      recipient: "+393331234567",
      subject: "business-claim",
    });

    assert.ok(consoleCapture.info.every((line) => !line.includes("654321")));
    assert.ok(consoleCapture.info.every((line) => !line.includes("+393331234567")));
    assert.ok(consoleCapture.warn.some((line) => line.includes("Twilio")));
  } finally {
    consoleCapture.restore();
    restoreEnv();
  }
});

test("missing SMTP env vars in production throws a clear error", async () => {
  const restoreEnv = withTempEnv({
    NODE_ENV: "production",
    SMTP_FROM: undefined,
    SMTP_HOST: undefined,
    SMTP_PASS: undefined,
    SMTP_PORT: undefined,
    SMTP_USER: undefined,
  });

  try {
    await assert.rejects(
      sendVerificationCode({
        channel: "EMAIL",
        code: "123456",
        locale: "en",
        recipient: "owner@example.com",
        subject: "business-claim",
      }),
      /smtp_configuration_missing/,
    );
  } finally {
    restoreEnv();
  }
});

test("missing Twilio env vars in production throws a clear error", async () => {
  const restoreEnv = withTempEnv({
    NODE_ENV: "production",
    TWILIO_ACCOUNT_SID: undefined,
    TWILIO_AUTH_TOKEN: undefined,
    TWILIO_FROM_PHONE: undefined,
    TWILIO_VERIFY_SERVICE_SID: undefined,
  });

  try {
    await assert.rejects(
      sendVerificationCode({
        channel: "SMS",
        code: "123456",
        locale: "en",
        recipient: "+393331234567",
        subject: "business-claim",
      }),
      /twilio_sms_configuration_missing/,
    );
  } finally {
    restoreEnv();
  }
});
