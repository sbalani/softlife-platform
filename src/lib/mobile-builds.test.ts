import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedExpoArtifactUrl, isAllowedExpoDownloadUrl, parseMobileBuildInput, validWebhookSecret } from "./mobile-builds.ts";

const artifact = "https://expo.dev/artifacts/eas/CKqD6EuCCnDH4EN5NIqKw6gAaW77pWD-wCizV5iXUGw.apk";

test("accepts only exact Expo EAS APK artifact URLs", () => {
  assert.equal(isAllowedExpoArtifactUrl(artifact), true);
  for (const value of [
    "http://expo.dev/artifacts/eas/build.apk",
    "https://expo.dev.evil.example/artifacts/eas/build.apk",
    "https://expo.dev/artifacts/eas/build.aab",
    "https://expo.dev/artifacts/eas/build.apk?redirect=https://example.com",
  ]) assert.equal(isAllowedExpoArtifactUrl(value), false, value);
});

test("allows only known HTTPS hosts after Expo redirects", () => {
  assert.equal(isAllowedExpoDownloadUrl("https://api.expo.dev/v2/artifacts/eas/build"), true);
  assert.equal(isAllowedExpoDownloadUrl("https://wf-artifacts.eascdn.net/build.apk?signature=x"), true);
  assert.equal(isAllowedExpoDownloadUrl("https://eascdn.net.evil.example/build.apk"), false);
});

test("parses optional release metadata with limits", () => {
  assert.deepEqual(parseMobileBuildInput({ artifact_url: artifact, version: "1.2.3", build_number: "42", release_notes: "Fixes" }), {
    artifactUrl: artifact,
    version: "1.2.3",
    buildNumber: "42",
    releaseNotes: "Fixes",
  });
  assert.throws(() => parseMobileBuildInput({ artifact_url: artifact, release_notes: "x".repeat(2001) }));
});

test("webhook bearer secret comparison fails closed", () => {
  assert.equal(validWebhookSecret("Bearer correct", "correct"), true);
  assert.equal(validWebhookSecret("Bearer wrong", "correct"), false);
  assert.equal(validWebhookSecret(null, "correct"), false);
});
