import assert from "node:assert/strict";
import test from "node:test";
import { isSameOrigin, publicReportContact, publicReportFile } from "./public-reporting.ts";
import { submissionTokenHash } from "./public-reporting-crypto.ts";

test("public reports require a named, contactable reporter with consent", () => {
  assert.equal(publicReportContact({ reporter_name: "", phone: "", email: "", contact_consent: false }).error, "Enter your name.");
  assert.equal(publicReportContact({ reporter_name: "A", phone: "", email: "", contact_consent: true }).error, "Enter a phone number or email address.");
  assert.equal(publicReportContact({ reporter_name: " A ", phone: "12345", email: "", contact_consent: true }).reporterName, "A");
  assert.equal(publicReportContact({ reporter_name: "A", phone: "12345", email: "", contact_consent: true, website: "spam" }).error, "Unable to submit report.");
});

test("public evidence accepts only bounded audio, image, and video files", () => {
  const image = publicReportFile("", "photo.HEIC", 100);
  const audio = publicReportFile("audio/webm", "voice.webm", 20 * 1024 * 1024);
  assert.ok(!("error" in image));
  assert.ok(!("error" in audio));
  assert.equal(image.mimeType, "image/heic");
  assert.equal(audio.kind, "audio");
  assert.match(publicReportFile("video/mp4", "video.mp4", 50 * 1024 * 1024 + 1).error!, /too large/);
  assert.equal(publicReportFile("application/pdf", "report.pdf", 100).error, "Unsupported attachment type.");
});

test("submission tokens are hashed and mutations require same-origin requests", () => {
  assert.match(submissionTokenHash("secret"), /^[0-9a-f]{64}$/);
  assert.equal(isSameOrigin(new Request("https://softlife.example/api/report", { headers: { origin: "https://softlife.example" } })), true);
  assert.equal(isSameOrigin(new Request("https://softlife.example/api/report", { headers: { origin: "https://other.example" } })), false);
});
