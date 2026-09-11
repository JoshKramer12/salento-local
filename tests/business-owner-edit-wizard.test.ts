import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editPage = readFileSync("src/app/businesses/[slug]/edit/page.tsx", "utf8");
const publishForm = readFileSync("src/components/account/publish-form.tsx", "utf8");
const ownerDashboard = readFileSync("src/components/account/business-owner-dashboard.tsx", "utf8");
const actions = readFileSync("src/app/(account)/actions.ts", "utf8");
const editActionStart = actions.indexOf("export async function updateOwnedBusinessWithWizardAction");
const editActionEnd = actions.indexOf("export async function verifyBusinessSubmissionCodeAction");
const editAction = actions.slice(editActionStart, editActionEnd);

test("Business Owner edit route uses the shared wizard and supports direct hours and photos steps", () => {
  assert.match(editPage, /<PublishForm/);
  assert.match(editPage, /editMode=\{\{/);
  assert.match(editPage, /const editSteps = new Set\(\["business", "contact", "owner", "about", "hours", "photos"\]\)/);
  assert.match(ownerDashboard, /\/edit\?step=photos/);
  assert.match(ownerDashboard, /\/edit\?step=hours/);
});

test("shared publish form keeps create mode and ends owner edit mode with Save changes", () => {
  assert.match(
    publishForm,
    /isEditMode \? updateOwnedBusinessWithWizardAction : saveBusinessSubmissionAction/,
  );
  assert.match(publishForm, /isEditMode \? requestDraftSave\("manual", true\) : goToNextStep\("review"\)/);
  assert.match(publishForm, /locale === "it" \? "Salva modifiche" : "Save changes"/);
  assert.match(publishForm, /router\.push\(isEditMode \? "\/dashboard" : "\/dashboard\/businesses"\)/);
});

test("owner edit action authorizes the existing business and does not create submissions or alter payment state", () => {
  assert.match(editAction, /viewer\.role !== "BUSINESS_OWNER"/);
  assert.match(editAction, /canManageBusiness\(\{ businessId, userId: viewer\.id \}\)/);
  assert.match(editAction, /tx\.business\.update/);
  assert.match(editAction, /tx\.businessSubmission\.update/);
  assert.doesNotMatch(editAction, /businessSubmission\.create/);
  assert.doesNotMatch(editAction, /paymentStatus:/);
  assert.doesNotMatch(editAction, /amountPaidCents:/);
  assert.doesNotMatch(editAction, /commissionCents:/);
  assert.doesNotMatch(editAction, /ownerAccess/);
});
