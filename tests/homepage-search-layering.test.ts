import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homepage = readFileSync("src/app/page.tsx", "utf8");
const styles = readFileSync("src/app/homepage.css", "utf8");
const autocomplete = readFileSync("src/components/search-autocomplete.tsx", "utf8");

test("homepage search suggestions remain visible above the hero", () => {
  assert.match(homepage, /<SearchAutocomplete[^>]*variant="home"/);
  assert.match(styles, /\.home-hero-inner\s*\{[^}]*position:relative/);
  assert.doesNotMatch(styles, /\.home-hero\s*\{[^}]*overflow:hidden/);
  assert.match(autocomplete, /absolute left-0 right-0 top-\[calc\(100%\+0\.6rem\)\] z-50/);
});

test("homepage search keeps suggestions and sends keyword and location to the existing directory", () => {
  assert.match(autocomplete, /\/api\/search-suggestions\?q=\$\{encodeURIComponent\(deferredQuery\)\}/);
  assert.match(autocomplete, /router\.push\(suggestion\.href\)/);
  assert.match(autocomplete, /params\.set\("q", value\.trim\(\)\)/);
  assert.match(autocomplete, /params\.set\(selectedLocation\.kind, selectedLocation\.slug\)/);
  assert.match(autocomplete, /router\.push\(`\$\{searchPath\}\?\$\{params\.toString\(\)\}`\)/);
  assert.match(homepage, /getDirectoryCatalog\(\)/);
  assert.match(homepage, /locationPlaceholder=\{copy\.nearPlaceholder\}/);
});

test("homepage category cards use all real directory routes and the approved color assignments", () => {
  assert.match(homepage, /homeCategorySlugs\.map/);
  assert.match(homepage, /href=\{`\/directory\?category=\$\{slug\}`\}/);
  for (const [slug, color] of Object.entries({ restaurants: "coral", cafes: "blue", beaches: "coral", hotels: "blue", grocery: "coral", mechanics: "blue", pharmacies: "coral", plumbers: "blue", bakeries: "coral", "things-to-do": "blue" })) {
    assert.match(homepage, new RegExp(`(?:"${slug}"|${slug}): "${color}"`));
  }
});

test("the homepage removes Popular shortcuts and keeps the business card inside its image", () => {
  assert.doesNotMatch(homepage, /home-popular|popular: "Popular:|popular: "Popolari:/);
  assert.match(styles, /\.home-listing-card\s*\{[^}]*left:1\.5rem; right:1\.5rem;/);
});
