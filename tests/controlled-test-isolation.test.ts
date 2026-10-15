import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { controlledTestAuthorized, saveControlledTestEmail } from "../src/lib/controlled-test";

test("controlled test gate rejects missing and invalid browser credentials", () => {
  const password = randomBytes(32).toString("hex");
  assert.equal(controlledTestAuthorized(null, password), false);
  assert.equal(controlledTestAuthorized(`Basic ${Buffer.from(`tester:${password}x`).toString("base64")}`, password), false);
  assert.equal(controlledTestAuthorized(`Basic ${Buffer.from(`tester:${password}`).toString("base64")}`, password), true);
  assert.equal(controlledTestAuthorized(`Basic ${Buffer.from("tester:short").toString("base64")}`, "short"), false);
});

test("controlled test mail cannot reach a real address and retries save one copy", async () => {
  const mailbox = await mkdtemp(path.join(os.tmpdir(), "salento-test-mail-"));
  const env = { CONTROLLED_TEST_MODE: "true", CONTROLLED_TEST_MAILBOX_DIR: mailbox };
  const message = { to: "owner@example.test", subject: "Test", text: "OTP 123456", html: "<p>OTP 123456</p>", idempotencyKey: "same-attempt" };
  try {
    await assert.rejects(saveControlledTestEmail({ ...message, to: "customer@example.com" }, env), /controlled_test_recipient_required/);
    assert.deepEqual(await readdir(mailbox), []);
    const first = await saveControlledTestEmail(message, env);
    const second = await saveControlledTestEmail(message, env);
    assert.equal(first.messageId, second.messageId);
    const files = await readdir(mailbox);
    assert.equal(files.length, 1);
    const saved = JSON.parse(await readFile(path.join(mailbox, files[0]), "utf8"));
    assert.equal(saved.to, message.to);
    assert.equal(saved.text, message.text);
  } finally {
    await rm(mailbox, { recursive: true, force: true });
  }
});
