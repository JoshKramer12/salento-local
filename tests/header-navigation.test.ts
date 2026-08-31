import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getAccountNavigationItems,
  getDesktopPartnerAddBusinessAction,
} from "@/lib/account-navigation";

test("desktop Local Partners receive the localized existing publish action", () => {
  assert.deepEqual(getDesktopPartnerAddBusinessAction("en", "GETTER"), {
    href: "/publish",
    label: "Add business",
  });
  assert.deepEqual(getDesktopPartnerAddBusinessAction("it", "GETTER"), {
    href: "/publish",
    label: "Aggiungi attività",
  });
});

test("desktop language control remains in place for visitors and non-Partner roles", () => {
  for (const role of [undefined, null, "ADMIN", "BUSINESS_OWNER", "USER"] as const) {
    assert.equal(getDesktopPartnerAddBusinessAction("en", role), null);
  }
});

test("the existing mobile Partner navigation keeps its publish action", () => {
  const publishItem = getAccountNavigationItems("en", "GETTER", {
    addBusinessLabel: true,
    publishHref: "/publish",
  }).find((item) => item.key === "publish");

  assert.deepEqual(publishItem, {
    href: "/publish",
    key: "publish",
    label: "Add a business",
  });
});

test("Partner Settings retains the shared language control", () => {
  const settingsPage = readFileSync(
    new URL("../src/app/(account)/settings/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    settingsPage,
    /viewer\.role === "GETTER"[\s\S]*<LanguageToggle locale=\{locale\} \/>/,
  );
});

test("header keeps the compact mobile publish action separate from the desktop Partner action", () => {
  const siteHeader = readFileSync(
    new URL("../src/components/site-header.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    siteHeader,
    /className="hidden items-center gap-1\.5 xl:flex"[\s\S]*desktopPartnerAddBusinessAction[\s\S]*<LanguageToggle locale=\{locale\} \/>/,
  );
  assert.match(
    siteHeader,
    /className="flex min-w-0 items-center gap-1 xl:hidden"[\s\S]*href="\/publish"[\s\S]*\+ \{copy\.addBusiness\}/,
  );
});
