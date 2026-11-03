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

test("desktop language control remains in place for visitors and non-account roles", () => {
  for (const role of [undefined, null, "ADMIN", "USER"] as const) {
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

test("Partner and Business Owner Settings retain the shared language control", () => {
  const settingsPage = readFileSync(
    new URL("../src/app/(account)/settings/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    settingsPage,
    /viewer\.role === "GETTER" \|\| viewer\.role === "BUSINESS_OWNER"[\s\S]*<LanguageToggle locale=\{locale\} \/>/,
  );
});

test("owner headers defer language selection to Settings while visitor and Partner header behavior stays intact", () => {
  const siteHeader = readFileSync(
    new URL("../src/components/site-header.tsx", import.meta.url),
    "utf8",
  );

  assert.match(siteHeader, /viewer\?\.role !== "BUSINESS_OWNER" \? <LanguageToggle locale=\{locale\} variant="compact" \/>/);
  assert.match(
    siteHeader,
    /getDesktopPartnerAddBusinessAction[\s\S]*home-header-business/,
  );
  const mobileDrawer = readFileSync(
    new URL("../src/components/mobile-navigation-drawer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(mobileDrawer, /viewer\?\.role !== "BUSINESS_OWNER"[\s\S]*<LanguageToggle locale=\{locale\} \/>/);
});

test("the public header restores Explore and keeps town and locality destinations", () => {
  const header = readFileSync("src/components/site-header.tsx", "utf8");
  assert.match(header, /usesRedesignedSiteHeader\(pathname\)/);
  assert.match(header, /<HardNavigationLink href="\/explore"[^>]*>\{copy\.explore\}<\/HardNavigationLink>/);
  assert.match(header, /<details className="home-nav-places">[\s\S]*href="\/towns"[\s\S]*href="\/localities"/);
  assert.match(header, /href="\/dashboard" ariaCurrent=\{pathname\.startsWith\("\/dashboard"\) \? "true" : undefined\}/);
  assert.match(header, /<SearchAutocomplete locale=\{locale\} placeholder=\{copy\.searchPlaceholder\} searchPath="\/directory" variant="header"/);
  assert.match(header, /<NotificationBadge count=\{notificationCount\} className="home-menu-badge" \/>/);
});
