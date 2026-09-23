import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const businessesPage = readFileSync("src/app/(account)/dashboard/businesses/page.tsx", "utf8");
const submissionList = readFileSync("src/components/account/submission-list.tsx", "utf8");

test("business owners see the Drafts section even with no saved drafts", () => {
  assert.match(businessesPage, /personalView && viewer\.role !== "GETTER" && \(draftSubmissions\.length > 0 \|\| viewer\.role === "BUSINESS_OWNER"\)/);
  assert.match(businessesPage, /<section id="drafts"/);
  assert.match(businessesPage, /Saved drafts appear here first so you can jump back in quickly\./);
  assert.match(businessesPage, /Le bozze salvate compaiono qui per prime/);
  assert.match(businessesPage, /You currently have no drafts\./);
  assert.match(businessesPage, /Al momento non hai bozze\./);
});

test("drafts use the existing submissions empty card without changing the normal empty state", () => {
  assert.match(businessesPage, /emptyMessage=\{locale === "it" \? "Al momento non hai bozze\." : "You currently have no drafts\."\}/);
  assert.match(submissionList, /className="card p-6 text-sm text-\[var\(--muted\)\]"/);
  assert.match(submissionList, /\{emptyMessage \?\? copy\.empty\}/);
  assert.match(submissionList, /There are no submissions to show yet\./);
});
