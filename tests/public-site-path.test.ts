import assert from "node:assert/strict";
import test from "node:test";

import { isPublicSitePath, usesRedesignedSiteHeader } from "@/lib/public-site-path";

test("the shared public header covers discovery, listings, and legal pages", () => {
  for (const path of ["/", "/directory", "/explore", "/towns/otranto", "/localities/porto-badisco-otranto", "/businesses/example", "/earn", "/privacy", "/terms", "/cookies"]) {
    assert.equal(isPublicSitePath(path), true, path);
  }
});

test("account, dashboard, edit, and payment flows are not public discovery paths", () => {
  for (const path of ["/dashboard", "/dashboard/admin/users", "/login", "/signup/business", "/businesses/example/edit", "/pay/element/example", "/publish/payment", "/partner/join"]) {
    assert.equal(isPublicSitePath(path), false, path);
  }
});

test("the redesigned site header covers account dashboards, profile, and listing management", () => {
  for (const path of ["/", "/explore", "/businesses/example", "/businesses/example/edit", "/dashboard", "/dashboard/businesses", "/dashboard/earnings", "/dashboard/admin/users", "/dashboard/support", "/settings", "/manage-business", "/login", "/signup/business", "/claim", "/publish", "/partner/guide"]) {
    assert.equal(usesRedesignedSiteHeader(path), true, path);
  }
});

test("payment and onboarding workflows retain their existing header", () => {
  for (const path of ["/pay/element/example", "/pay-later", "/publish/payment", "/dashboard/membership/payment", "/dashboard/membership/bank-transfer", "/dashboard/membership/recovery-unavailable", "/dashboard/refund/example", "/partner/join", "/partner/onboarding", "/signup/business/details", "/signup/business/join", "/owner-access/example", "/receipts/example", "/agreements/example"]) {
    assert.equal(usesRedesignedSiteHeader(path), false, path);
  }
});
