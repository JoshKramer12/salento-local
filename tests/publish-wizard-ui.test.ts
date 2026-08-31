import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publishForm = readFileSync("src/components/account/publish-form.tsx", "utf8");

test("the collection wizard retains the six real steps and marks the active step", () => {
  for (const step of ["business", "contact", "owner", "about", "hours", "photos"]) {
    assert.match(publishForm, new RegExp(`key: "${step}"`));
  }

  assert.match(publishForm, /collectionSteps\.findIndex\(\(step\) => step\.key === wizardStep\)/);
  assert.match(publishForm, /aria-current=\{index === collectionIndex \? "step" : undefined\}/);
  assert.match(publishForm, /publish-step-progress__button--active/);
});

test("photo cards use accessible native inputs while exposing replace and remove actions", () => {
  assert.match(publishForm, /id=\{inputId\}/);
  assert.match(publishForm, /type="file"/);
  assert.match(publishForm, /accept="image\/\*"/);
  assert.match(publishForm, /className="peer sr-only"/);
  assert.match(publishForm, /htmlFor=\{inputId\}/);
  assert.match(publishForm, /copy\.photoReplace/);
  assert.match(publishForm, /copy\.photoRemove/);
  assert.match(publishForm, /function removePhoto\(slot: PhotoSlot\)/);
});

test("photo completion validation still requires exterior and interior images", () => {
  assert.match(
    publishForm,
    /wizardStep === "photos" && \(!photos\.exterior \|\| !photos\.interior\)/,
  );
  assert.match(publishForm, /serializePhotos\(photos\)/);
  assert.match(publishForm, /handlePhotoChange\(slot, file\)/);
});

test("the partner-to-owner flow keeps distinct review, handoff, and owner confirmation purposes", () => {
  assert.match(publishForm, /Review business/);
  assert.match(publishForm, /Everything look right\?/);
  assert.match(publishForm, /Hand phone to owner/);
  assert.match(publishForm, /Partner section complete/);
  assert.match(publishForm, /Now hand the phone to the business owner/);
  assert.match(publishForm, /owner-confirmation-card/);
  assert.match(publishForm, /ownerPrepared/);
  assert.match(publishForm, /moveToWizardStep\(step as WizardStep\)/);
});

test("owner confirmation retains compact details, accessible disclosure, and confirmation gating", () => {
  assert.match(publishForm, /const \[ownerDetailsExpanded, setOwnerDetailsExpanded\] = useState\(false\)/);
  assert.match(publishForm, /aria-expanded=\{ownerDetailsExpanded\}/);
  assert.match(publishForm, /aria-controls="owner-full-business-details"/);
  assert.match(publishForm, /setOwnerDetailsExpanded\(\(expanded\) => !expanded\)/);
  assert.match(publishForm, /renderBusinessSummary\("owner"\)/);
  assert.match(publishForm, /disabled=\{!ownerInformationConfirmed \|\| draftSavePending \|\| actionPending\}/);
});

test("owner-only progress follows confirmation, agreement, signature, and payment states", () => {
  for (const step of ["owner-review", "agreement", "signature", "payment"]) {
    assert.match(publishForm, new RegExp(`key: "${step}"`));
  }

  assert.match(publishForm, /const ownerProgressIndex = ownerSteps\.findIndex\(\(step\) => step\.key === wizardStep\)/);
  assert.match(publishForm, /owner-flow-progress__step--active/);
  assert.match(publishForm, /owner-flow-progress__step--complete/);
});
