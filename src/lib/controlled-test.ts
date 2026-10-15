import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function controlledTestAuthorized(authorization: string | null, password: string | undefined) {
  if (!password || password.length < 32 || !authorization?.startsWith("Basic ")) return false;
  let supplied: string;
  try {
    supplied = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const expected = Buffer.from(`tester:${password}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function saveControlledTestEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
}, env: NodeJS.ProcessEnv = process.env) {
  if (env.CONTROLLED_TEST_MODE !== "true") throw new Error("controlled_test_mode_required");
  const recipient = params.to.trim().toLowerCase();
  if (!/^[^@\s]+@example\.test$/.test(recipient)) throw new Error("controlled_test_recipient_required");
  const mailbox = env.CONTROLLED_TEST_MAILBOX_DIR;
  if (!mailbox || !path.isAbsolute(mailbox)) throw new Error("controlled_test_mailbox_missing");
  await mkdir(mailbox, { recursive: true, mode: 0o700 });
  const id = params.idempotencyKey
    ? createHash("sha256").update(params.idempotencyKey).digest("hex")
    : randomUUID();
  const file = path.join(mailbox, `${id}.json`);
  try {
    await writeFile(file, JSON.stringify({ to: recipient, subject: params.subject,
      text: params.text, html: params.html, at: new Date().toISOString() }),
    { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return { messageId: `controlled-${id}`, provider: "smtp" as const, success: true };
}
