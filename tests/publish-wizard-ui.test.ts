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

test("partner review makes submitted photos large enough to inspect and keeps the handoff action right aligned", () => {
  assert.match(publishForm, /renderBusinessSummary\("partner-review"\)/);
  assert.match(publishForm, /partner-review-photos/);
  assert.match(publishForm, /h-24 w-24 shrink-0 rounded-2xl object-cover sm:h-28 sm:w-28/);
  assert.match(publishForm, /flex flex-wrap justify-end gap-3[\s\S]*Hand phone to owner/);
});

test("duplicate decisions come before the back and save navigation row", () => {
  const duplicateFooterStart = publishForm.indexOf("duplicate-wizard-footer__decisions");
  const duplicateFooter = publishForm.slice(
    duplicateFooterStart,
    publishForm.indexOf('wizardStep === "owner-review"', duplicateFooterStart),
  );

  assert.ok(duplicateFooterStart >= 0);
  assert.ok(duplicateFooter.indexOf("copy.duplicateNewBusiness") < duplicateFooter.indexOf("copy.duplicateSameBusiness"));
  assert.match(duplicateFooter, /duplicate-wizard-footer__navigation flex w-full flex-nowrap items-center justify-between gap-3/);
  assert.match(duplicateFooter, /<IconArrowLeft size=\{18\} aria-hidden="true" \/>/);
  assert.match(duplicateFooter, /<IconDeviceFloppy size=\{18\} aria-hidden="true" \/>/);
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

test("every Save & exit control uses the established secondary button treatment", () => {
  assert.match(
    publishForm,
    /requestDraftSave\("manual", true\)\} className="btn-secondary disabled:cursor-wait disabled:opacity-50"/,
  );
  assert.doesNotMatch(
    publishForm,
    /ownerFlowStep && !specialFooterStep \? "px-2 py-2 text-sm font-medium text-\[var\(--muted\)\] underline underline-offset-4"/,
  );
});
