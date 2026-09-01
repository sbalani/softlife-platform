import assert from "node:assert/strict";
import test from "node:test";
import { actionReportAttachmentError } from "./action-report-attachment-errors.ts";

test("maps attachment lifecycle conflicts to stable client errors", () => {
  assert.deepEqual(actionReportAttachmentError({ message: "Action Report not attachable" }), {
    status: 409, code: "report_state_conflict", message: "The Action Report no longer accepts this attachment",
  });
  assert.equal(actionReportAttachmentError({ message: "Refill line not found" }).code, "refill_line_conflict");
  assert.equal(actionReportAttachmentError({ message: "Photo limit reached" }).code, "attachment_limit_reached");
  assert.equal(actionReportAttachmentError({ message: "Photo completion conflict" }).code, "upload_conflict");
});

test("does not expose unknown attachment failures", () => {
  assert.deepEqual(actionReportAttachmentError(new Error("private database detail")), {
    status: 500, code: "internal_error", message: "Could not complete attachment",
  });
});
