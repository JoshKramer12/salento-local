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
