import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getBusinessOwnerNavigationItems } from "@/lib/business-owner-navigation";

const editPage = readFileSync("src/app/businesses/[slug]/edit/page.tsx", "utf8");
const publishForm = readFileSync("src/components/account/publish-form.tsx", "utf8");
const ownerDashboard = readFileSync("src/components/account/business-owner-dashboard.tsx", "utf8");
const ownerNav = readFileSync("src/components/account/business-owner-account-nav.tsx", "utf8");
const accountWorkspaceNav = readFileSync("src/components/account/account-workspace-nav.tsx", "utf8");
const partnerWorkspaceNav = readFileSync("src/components/account/partner-workspace-nav.tsx", "utf8");
const businessesPage = readFileSync("src/app/(account)/dashboard/businesses/page.tsx", "utf8");
const claimPage = readFileSync("src/app/(account)/claim/page.tsx", "utf8");
const dashboardPage = readFileSync("src/app/(account)/dashboard/page.tsx", "utf8");
const actions = readFileSync("src/app/(account)/actions.ts", "utf8");
const editActionStart = actions.indexOf("export async function updateOwnedBusinessWithWizardAction");
const editActionEnd = actions.indexOf("export async function verifyBusinessSubmissionCodeAction");
const editAction = actions.slice(editActionStart, editActionEnd);

test("Business Owner edit route uses the shared wizard and supports direct hours and photos steps", () => {
  assert.match(editPage, /<PublishForm/);
  assert.match(editPage, /editMode=\{\{/);
  assert.match(editPage, /const editSteps = new Set\(\["business", "contact", "owner", "about", "hours", "photos"\]\)/);
  assert.match(ownerDashboard, /\/edit\?step=photos/);
  assert.match(ownerDashboard, /\/edit\?step=hours/);
});

test("Business Owner listing cards expose the explicit step-one edit action beside the public listing", () => {
  assert.match(ownerDashboard, /const editListingHref = `\/businesses\/\$\{business\.slug\}\/edit\?step=business`/);
  assert.match(ownerDashboard, /const publicListingHref = `\/businesses\/\$\{business\.slug\}`/);
  assert.match(ownerDashboard, /href=\{editListingHref\} className="btn-secondary min-h-12 w-full justify-center sm:w-auto"/);
  assert.match(ownerDashboard, /<IconPencil size=\{18\} \/>\{copy\.editListing\}/);
  assert.match(ownerDashboard, /href=\{publicListingHref\} className="btn-primary min-h-12 w-full justify-center sm:w-auto"/);
  assert.match(ownerDashboard, /<IconExternalLink size=\{18\} \/>/);
  assert.match(ownerDashboard, /className="mt-5 grid gap-3 sm:flex sm:flex-wrap"/);
});

test("shared publish form keeps create mode and ends owner edit mode at the listing", () => {
  assert.match(
    publishForm,
    /isEditMode \? updateOwnedBusinessWithWizardAction : saveBusinessSubmissionAction/,
  );
  assert.match(publishForm, /EDIT BUSINESS/);
  assert.match(publishForm, /Edit my business/);
  assert.match(publishForm, /Update your business information on Salento Local\./);
  assert.match(publishForm, /Save & view my listing/);
  assert.match(publishForm, /Salva e visualizza la mia scheda/);
  assert.match(publishForm, /`\/businesses\/\$\{editMode\?\.businessSlug\}`/);
  assert.match(publishForm, /isEditMode \? requestDraftSave\("manual", true, null, "listing"\) : goToNextStep\("review"\)/);
  assert.match(publishForm, /locale === "it" \? "Salva ed esci" : "Save & exit"/);
});

test("Business Owner navigation keeps claim actions out of account and workspace navigation", () => {
  assert.match(ownerDashboard, /<BusinessOwnerAccountNav active="businesses" locale=\{locale\} \/>/);
  assert.match(businessesPage, /<BusinessOwnerAccountNav active="drafts" locale=\{locale\} \/>/);
  assert.deepEqual(getBusinessOwnerNavigationItems("en"), [
    { href: "/dashboard", key: "businesses", label: "My businesses" },
    { href: "/dashboard/businesses#drafts", key: "drafts", label: "Drafts" },
  ]);
  assert.match(ownerNav, /<AccountWorkspaceNav/);
  assert.match(ownerNav, /dashboard-nav flex flex-wrap gap-2/);
  assert.match(ownerNav, /nav-link \$\{active === item\.key \? "nav-link-active" : ""\}/);
  assert.doesNotMatch(ownerNav, /bg-\[var\(--primary\)\] text-white/);
  assert.match(partnerWorkspaceNav, /<AccountWorkspaceNav/);
  assert.match(accountWorkspaceNav, /grid grid-cols-3 gap-1/);
  assert.match(accountWorkspaceNav, /bg-white text-\[var\(--foreground\)\] shadow-sm/);
  assert.match(businessesPage, /<BusinessOwnerWorkspaceNav active="drafts" locale=\{locale\} \/>/);
  assert.doesNotMatch(claimPage, /BusinessOwner(?:Account|Workspace)Nav/);
  assert.match(dashboardPage, /<BusinessOwnerWorkspaceNav active="businesses" locale=\{locale\} \/>/);
  assert.match(businessesPage, /viewer\.role === "BUSINESS_OWNER"/);
  assert.match(businessesPage, /<DashboardNav/);
  assert.match(dashboardPage, /<DashboardNav/);
});

test("owner edit stops after Photos while the create publishing flow remains available", () => {
  assert.match(editPage, /requestedStep && editSteps\.has\(requestedStep\)/);
  assert.match(
    publishForm,
    /editMode \? editMode\.initialStep \?\? "business" : getResumeWizardStep/,
  );
  assert.match(publishForm, /wizardStep === "photos" \? <button/);
  assert.match(publishForm, /isEditMode \? requestDraftSave\("manual", true, null, "listing"\) : goToNextStep\("review"\)/);
  assert.match(publishForm, /isEditMode \? updateOwnedBusinessWithWizardAction : saveBusinessSubmissionAction/);
  assert.match(publishForm, /\{!\(isEditMode && wizardStep === "photos"\) \? <button/);
  assert.match(editPage, /openingHours: latestSubmission\?\.openingHours \|\| buildHoursDraft\(business\.hours\)/);
  assert.match(editPage, /photoUrls: imageUrls\.slice\(0, 5\)\.join\("\\n"\)/);
  assert.match(editPage, /preservedPhotoUrls: imageUrls\.slice\(5\)/);
});

test("owner edit action authorizes the existing business and does not create submissions or alter payment state", () => {
  assert.match(editAction, /viewer\.role !== "BUSINESS_OWNER"/);
  assert.match(editAction, /canManageBusiness\(\{ businessId, userId: viewer\.id \}\)/);
  assert.match(editAction, /tx\.business\.update/);
  assert.match(editAction, /tx\.businessSubmission\.update/);
  assert.doesNotMatch(editAction, /businessSubmission\.create/);
  assert.doesNotMatch(editAction, /paymentStatus:/);
  assert.doesNotMatch(editAction, /amountPaidCents:/);
  assert.doesNotMatch(editAction, /commissionCents:/);
  assert.doesNotMatch(editAction, /ownerAccess/);
});
