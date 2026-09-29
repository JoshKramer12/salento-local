import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publishForm = readFileSync("src/components/account/publish-form.tsx", "utf8");

test("the collection wizard keeps Partner and edit steps and omits the standalone Owner step", () => {
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

test("partner review uses larger, undistorted submitted photo previews and keeps the handoff action right aligned", () => {
  assert.match(publishForm, /renderBusinessSummary\("partner-review"\)/);
  assert.match(publishForm, /partner-review-photos/);
  assert.match(publishForm, /h-36 w-36 shrink-0 rounded-2xl object-cover sm:h-40 sm:w-40/);
  assert.match(publishForm, /flex flex-wrap justify-end gap-3[\s\S]*Hand phone to owner/);
});

test("Owner navigation skips the standalone private-contact page in both directions", () => {
  assert.match(publishForm, /skipOwnerStep = isOwnerFlow && !isEditMode/);
  assert.match(publishForm, /goToNextStep\(skipOwnerStep \? "about" : "owner"\)/);
  assert.match(publishForm, /case "about":\s*return skipOwnerStep \? "contact" : "owner"/);
  assert.match(publishForm, /wizardStep === "contact" && skipOwnerStep/);
  assert.match(publishForm, /Your private contact information/);
  assert.doesNotMatch(publishForm, /duplicate-blocked/);
});

test("add another photo uses the full available width without changing photo input behavior", () => {
  assert.match(publishForm, /photo-upload-card__add btn-secondary w-full/);
  assert.match(publishForm, /setVisibleExtraPhotoCount\(\(count\) => count \+ 1\)/);
});

test("agreement and signature place their primary continuations before Back and Save & exit", () => {
  const specialFooterStart = publishForm.indexOf("special-wizard-footer__primary");
  const specialFooter = publishForm.slice(
    specialFooterStart,
    publishForm.indexOf('</> : <>', specialFooterStart),
  );

  assert.ok(specialFooterStart >= 0);
  assert.match(specialFooter, /special-wizard-footer__primary btn-primary min-h-12 w-full/);
  assert.ok(specialFooter.indexOf("Continue to signature") < specialFooter.indexOf("special-wizard-footer__navigation"));
  assert.ok(specialFooter.indexOf("Continue to payment") < specialFooter.indexOf("special-wizard-footer__navigation"));
  assert.match(specialFooter, /special-wizard-footer__navigation flex w-full flex-nowrap items-center justify-between gap-3/);
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
