import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homepage = readFileSync("src/app/page.tsx", "utf8");
const autocomplete = readFileSync("src/components/search-autocomplete.tsx", "utf8");

test("homepage search suggestions are not trapped beneath the category strip stacking context", () => {
  assert.match(homepage, /homepage-hero relative overflow-visible/);
  assert.doesNotMatch(homepage, /homepage-hero[^"\n]*\bisolate\b/);
  assert.match(homepage, /homepage-category-row relative z-10/);
  assert.match(autocomplete, /absolute left-0 right-0 top-\[calc\(100%\+0\.6rem\)\] z-50/);
});

test("autocomplete continues to use the existing suggestion endpoint and result routes", () => {
  assert.match(autocomplete, /\/api\/search-suggestions\?q=\$\{encodeURIComponent\(deferredQuery\)\}/);
  assert.match(autocomplete, /router\.push\(suggestion\.href\)/);
  assert.match(autocomplete, /router\.push\(`\$\{searchPath\}\?q=/);
});
