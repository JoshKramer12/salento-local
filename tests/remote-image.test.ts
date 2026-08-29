import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REMOTE_IMAGE_BYTES,
  isAllowedRemoteImageUrl,
  isRemoteImageSizeAllowed,
  isSafeRemoteImageContentType,
} from "@/lib/remote-image";

test("remote image proxy accepts only HTTPS Wikimedia image origins", () => {
  assert.equal(isAllowedRemoteImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/example.jpg"), true);
  assert.equal(isAllowedRemoteImageUrl("https://upload.wikimedia.org/example.jpg"), true);
  assert.equal(isAllowedRemoteImageUrl("https://en.wikipedia.org/wiki/File:example.jpg"), true);
  assert.equal(isAllowedRemoteImageUrl("http://commons.wikimedia.org/example.jpg"), false);
  assert.equal(isAllowedRemoteImageUrl("https://127.0.0.1/metadata"), false);
  assert.equal(isAllowedRemoteImageUrl("https://[::1]/metadata"), false);
  assert.equal(isAllowedRemoteImageUrl("https://2130706433/metadata"), false);
  assert.equal(isAllowedRemoteImageUrl("https://commons.wikimedia.org@127.0.0.1/image.jpg"), false);
  assert.equal(isAllowedRemoteImageUrl("https://commons.wikimedia.org.attacker.example/image.jpg"), false);
});

test("remote image proxy rejects active or oversized response types", () => {
  assert.equal(isSafeRemoteImageContentType("image/jpeg; charset=binary"), true);
  assert.equal(isSafeRemoteImageContentType("image/svg+xml"), false);
  assert.equal(isSafeRemoteImageContentType("text/html"), false);
  assert.equal(isRemoteImageSizeAllowed(String(MAX_REMOTE_IMAGE_BYTES)), true);
  assert.equal(isRemoteImageSizeAllowed(String(MAX_REMOTE_IMAGE_BYTES + 1)), false);
});
