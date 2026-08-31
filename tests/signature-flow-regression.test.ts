import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const signaturePadSource = readFileSync(
  "src/components/account/signature-pad.tsx",
  "utf8",
);
const publishFormSource = readFileSync(
  "src/components/account/publish-form.tsx",
  "utf8",
);

test("signature pad offers only the drawing surface, not a typed-signature fallback", () => {
  assert.match(signaturePadSource, /onPointerDown={handlePointerDown}/);
  assert.match(signaturePadSource, /serializeSignature\(nextStrokes\)/);
  assert.doesNotMatch(signaturePadSource, /typedHelp|typedLabel|typed:/);
  assert.doesNotMatch(signaturePadSource, /type="text"/);
  assert.doesNotMatch(publishFormSource, /Typed signature|Firma digitata/);
  assert.doesNotMatch(
    publishFormSource,
    /Alternatively, type your full name\.|In alternativa, digita il tuo nome completo\./,
  );
});

test("publish flow retains agreement, drawn-signature, back, and draft-save gates", () => {
  assert.match(
    publishFormSource,
    /disabled={!agreementAccepted \|\| draftSavePending \|\| actionPending}/,
  );
  assert.match(
    publishFormSource,
    /if \(!signerFullName \|\| !signerRole \|\| !signature\)/,
  );
  assert.match(publishFormSource, /onClick={goToPreviousStep}/);
  assert.match(publishFormSource, /requestDraftSave\("manual", true\)/);
  assert.match(publishFormSource, /<input type="hidden" name="agreementSignature" value={signature} \/>/);
});
