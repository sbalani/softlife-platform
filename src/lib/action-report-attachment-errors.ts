export type ActionReportAttachmentError = {
  status: number;
  code: string;
  message: string;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

export function actionReportAttachmentError(error: unknown): ActionReportAttachmentError {
  const message = errorMessage(error);
  if (message === "Invalid photo" || message === "Invalid photo reservation" || message === "Unsupported audio object") {
    return { status: 400, code: "invalid_attachment", message: "Invalid attachment" };
  }
  if (message === "Refill line not found") {
    return { status: 409, code: "refill_line_conflict", message: "The refill line changed; refresh the draft and try again" };
  }
  if (message === "Photo limit reached") {
    return { status: 409, code: "attachment_limit_reached", message: "Attachment limit reached" };
  }
  if (message === "Photo completion conflict") {
    return { status: 409, code: "upload_conflict", message: "Attachment completion does not match the original upload" };
  }
  if (message === "Action Report not attachable" || message === "Confirmed Action Report not found" || message === "Audio can only be added to a draft") {
    return { status: 409, code: "report_state_conflict", message: "The Action Report no longer accepts this attachment" };
  }
  if (message === "This draft already has a voice AI job") {
    return { status: 409, code: "voice_workflow_conflict", message: "Voice workflow already exists" };
  }
  if (message === "Voice purpose conflicts with existing attachment") {
    return { status: 409, code: "voice_purpose_conflict", message: "Voice purpose conflicts with the existing attachment" };
  }
  return { status: 500, code: "internal_error", message: "Could not complete attachment" };
}
