import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getBusinessPhotoUrls,
  getStoredPhotoUrls,
  mergeBusinessPhotoUrls,
} from "../src/lib/business-photos";

const actions = readFileSync("src/app/(account)/actions.ts", "utf8");
const editPage = readFileSync("src/app/businesses/[slug]/edit/page.tsx", "utf8");
const publicBusinessPage = readFileSync("src/app/businesses/[slug]/page.tsx", "utf8");
const publishForm = readFileSync("src/components/account/publish-form.tsx", "utf8");
const ownerDashboard = readFileSync("src/components/account/business-owner-dashboard.tsx", "utf8");
const dashboardPage = readFileSync("src/app/(account)/dashboard/page.tsx", "utf8");
const ownerEditAction = actions.slice(
  actions.indexOf("export async function updateOwnedBusinessWithWizardAction"),
  actions.indexOf("export async function verifyBusinessSubmissionCodeAction"),
);

test("stored submission photos restore a gallery when BusinessImage rows are missing", () => {
  const exterior = "/uploads/submissions/exterior.jpg";
  const interior = "/uploads/submissions/interior.jpg";
  const additional = "/uploads/submissions/extra-1.jpg";

  assert.deepEqual(getStoredPhotoUrls([` ${exterior} `, "", 123, interior, additional]), [
    exterior,
    interior,
    additional,
  ]);
  assert.deepEqual(
    mergeBusinessPhotoUrls([exterior, interior], [exterior, additional]),
    [exterior, interior, additional],
  );
});

test("shared photo resolution keeps each dashboard business independent", () => {
  const businessAImage = "/uploads/submissions/business-a.jpg";
  const businessBSubmissionImage = "/uploads/submissions/business-b.jpg";
  const businessCFirstImage = "/uploads/submissions/business-c-first.jpg";
  const businessCSecondImage = "/uploads/submissions/business-c-second.jpg";

  assert.deepEqual(getBusinessPhotoUrls([{ url: businessAImage }], ["/unused.jpg"]), [
    businessAImage,
    "/unused.jpg",
  ]);
  assert.deepEqual(getBusinessPhotoUrls([], [businessBSubmissionImage]), [businessBSubmissionImage]);
  assert.deepEqual(getBusinessPhotoUrls([], []), []);
  assert.deepEqual(
    getBusinessPhotoUrls(
      [{ url: businessCFirstImage }, { url: businessCSecondImage }],
      [businessCSecondImage],
    ),
    [businessCFirstImage, businessCSecondImage],
  );
});

test("owner photo saves preserve matching image rows and only create or remove changed URLs", () => {
  assert.match(ownerEditAction, /tx\.businessImage\.findMany/);
  assert.match(ownerEditAction, /existingImagesByUrl/);
  assert.match(ownerEditAction, /tx\.businessImage\.update/);
  assert.match(ownerEditAction, /tx\.businessImage\.create/);
  assert.match(ownerEditAction, /id: \{ in: imageIdsToDelete \}/);
  assert.doesNotMatch(ownerEditAction, /images:\s*\{[\s\S]*deleteMany:\s*\{\}/);
  assert.match(ownerEditAction, /photoUrls: photoUrls\.length \? photoUrls : Prisma\.JsonNull/);
});

test("edit and public pages hydrate the same merged business and submission photos", () => {
  assert.match(editPage, /mergeBusinessPhotoUrls\(/);
  assert.match(editPage, /getStoredPhotoUrls\(latestSubmission\?\.photoUrls\)/);
  assert.match(publicBusinessPage, /submissions: \{/);
  assert.match(publicBusinessPage, /getBusinessPhotoUrls\(business\.images, submissionPhotoUrls\)/);
  assert.match(publishForm, /setPhotos\(\(current\) => \(\{ \.\.\.current, \[slot\]: payload\.url \}\)\)/);
  assert.match(publishForm, /setPreviewUrlForSlot\(slot, null\)/);
});

test("owner dashboard uses the shared photo resolver for its primary image and thumbnails", () => {
  assert.match(dashboardPage, /submissions: \{/);
  assert.match(dashboardPage, /select: \{ photoUrls: true \}/);
  assert.match(ownerDashboard, /getBusinessPhotoUrls\(business\.images, business\.submissions\[0\]\?\.photoUrls\)/);
  assert.match(ownerDashboard, /const hero = gallery\[0\] \?\?/);
  assert.match(ownerDashboard, /visibleImages\.slice\(1\)/);
  assert.match(ownerDashboard, /gallery\.length > 4/);
  assert.match(ownerDashboard, /lg:grid lg:grid-cols/);
});

test("owner management links always choose their requested initial step", () => {
  assert.match(publishForm, /editMode \? editMode\.initialStep \?\? "business" : getResumeWizardStep/);
  assert.match(ownerDashboard, /\/edit\?step=business/);
  assert.match(ownerDashboard, /\/edit\?step=photos/);
  assert.match(ownerDashboard, /\/edit\?step=hours/);
});
