import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createCompletePartnerSignup,
  openPartnerSignupHandoff,
  sealPartnerSignupHandoff,
  validatePartnerSignupEntry,
} from "@/lib/partner-signup-flow";
import { localPartnerOnboardingSchema } from "@/lib/validation";

const validEntry = {
  email: "partner@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  locale: "en" as const,
  partnerTermsAccepted: true,
  password: "ValidPassword1!",
  confirmPassword: "ValidPassword1!",
  redirectTo: "/partner/start",
  username: "ada-lovelace",
};

test("a valid Page 1 submission only produces a pending signup handoff", () => {
  const result = validatePartnerSignupEntry(validEntry);

  assert.deepEqual(result.fields, []);
  assert.deepEqual(result.entry, {
    email: "partner@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    locale: "en",
    partnerTermsAccepted: true,
    password: "ValidPassword1!",
    redirectTo: "/partner/start",
    username: "ada-lovelace",
  });
});

test("the Page 1 handoff is encrypted, short-lived, and rejects tampering", () => {
  const entry = validatePartnerSignupEntry(validEntry).entry!;
  const token = sealPartnerSignupHandoff(entry, "test-signup-handoff-secret");

  assert.equal(token.includes(entry.password), false);
  assert.equal(token.includes(entry.email), false);
  assert.deepEqual(openPartnerSignupHandoff(token, "test-signup-handoff-secret"), entry);
  const [iv, tag, payload] = token.split(".");
  const tamperedTag = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
  assert.equal(
    openPartnerSignupHandoff(`${iv}.${tamperedTag}.${payload}`, "test-signup-handoff-secret"),
    null,
  );
});

test("Page 2 blocks missing town, birthday, and phone before persistence", () => {
  const requiredDetails = {
    baseTownOrArea: "Lecce",
    birthDate: "2000-08-31",
    heardAbout: "friend-family",
    phone: "+39 333 1234567",
    whatsapp: "+39 333 1234567",
  };

  for (const [field, value] of [
    ["baseTownOrArea", ""],
    ["birthDate", ""],
    ["phone", ""],
  ] as const) {
    const result = localPartnerOnboardingSchema.safeParse({
      ...requiredDetails,
      [field]: value,
    });
    assert.equal(result.success, false, field);
  }
});

test("a completed two-page signup creates one user, partner profile, and legal acceptance", async () => {
  let userCreates = 0;
  let profileCreates = 0;
  let acceptedBy: string | undefined;

  await createCompletePartnerSignup(
    {
      baseTownOrArea: "Lecce",
      birthDate: "2000-08-31",
      email: "partner@example.com",
      firstName: "Ada",
      heardAbout: "friend-family",
      lastName: "Lovelace",
      locale: "en",
      passwordHash: "hashed-password",
      phone: "+39 333 1234567",
      username: "ada-lovelace",
      whatsapp: "+39 333 1234567",
    },
    {
      createProfile: async (profile) => {
        profileCreates += 1;
        assert.equal(profile.userId, "partner-user-id");
        assert.equal(profile.fullName, "Ada Lovelace");
        assert.equal(profile.baseTownOrArea, "Lecce");
      },
      createUser: async (user) => {
        userCreates += 1;
        assert.deepEqual(user, {
          email: "partner@example.com",
          name: "Ada Lovelace",
          passwordHash: "hashed-password",
          profileCompleted: true,
          role: "GETTER",
          username: "ada-lovelace",
        });
        return { id: "partner-user-id" };
      },
      recordLegalAcceptance: async (userId) => {
        acceptedBy = userId;
      },
    },
  );

  assert.equal(userCreates, 1);
  assert.equal(profileCreates, 1);
  assert.equal(acceptedBy, "partner-user-id");
});

test("the two pages keep their distinct controls and final creation boundary", () => {
  const entryForm = readFileSync("src/components/account/partner-entry-signup-form.tsx", "utf8");
  const detailsForm = readFileSync(
    "src/components/account/local-partner-onboarding-form.tsx",
    "utf8",
  );
  const actions = readFileSync("src/app/(account)/auth-actions.ts", "utf8");
  const entryAction = actions.slice(
    actions.indexOf("export async function partnerSignupAction"),
    actions.indexOf("export async function completePartnerSignupAction"),
  );
  const completionAction = actions.slice(actions.indexOf("export async function completePartnerSignupAction"));

  assert.match(entryForm, /create: "Next"/);
  assert.match(entryForm, /create: "Avanti"/);
  assert.match(detailsForm, /createAccount: "Create account"/);
  assert.match(detailsForm, /createAccount: "Crea account"/);
  assert.match(detailsForm, /HardNavigationLink href=\{backHref\}/);
  assert.doesNotMatch(entryAction, /prisma\.user\.create|signIn\(/);
  assert.match(entryAction, /storePendingPartnerSignup/);
  assert.match(completionAction, /prisma\.\$transaction/);
  assert.match(completionAction, /createCompletePartnerSignup/);
  assert.match(completionAction, /signIn\("credentials"/);
  assert.match(completionAction, /P2002/);
});
