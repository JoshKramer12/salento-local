import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSubmissionSocialInput,
  normalizeSubmissionSocialValue,
} from "@/lib/business-links";

test("publish social inputs reserve @ for the permanent input adornment", () => {
  assert.equal(normalizeSubmissionSocialInput("@salentolocal"), "salentolocal");
  assert.equal(normalizeSubmissionSocialInput("@@salentolocal"), "salentolocal");
  assert.equal(normalizeSubmissionSocialInput("salentolocal"), "salentolocal");
});

test("publish social inputs preserve previously saved URLs", () => {
  assert.equal(
    normalizeSubmissionSocialInput("https://www.instagram.com/salentolocal/"),
    "https://www.instagram.com/salentolocal/",
  );
  assert.equal(normalizeSubmissionSocialValue("@salentolocal"), "salentolocal");
  assert.equal(normalizeSubmissionSocialValue("@@salentolocal"), "salentolocal");
});
