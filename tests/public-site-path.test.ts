import assert from "node:assert/strict";
import test from "node:test";

import { isPublicSitePath } from "@/lib/public-site-path";

test("the shared public header covers discovery, listings, and legal pages", () => {
  for (const path of ["/", "/directory", "/explore", "/towns/otranto", "/localities/porto-badisco-otranto", "/businesses/example", "/earn", "/privacy", "/terms", "/cookies"]) {
    assert.equal(isPublicSitePath(path), true, path);
  }
});

test("account, dashboard, edit, and payment flows keep their existing header", () => {
  for (const path of ["/dashboard", "/dashboard/admin/users", "/login", "/signup/business", "/businesses/example/edit", "/pay/element/example", "/publish/payment", "/partner/join"]) {
    assert.equal(isPublicSitePath(path), false, path);
  }
});
