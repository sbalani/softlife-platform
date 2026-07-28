import { SetPasswordForm } from "./SetPasswordForm";

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-6">
          <div className="font-display text-2xl font-bold text-cocoa">Set your password</div>
          <p className="mt-1 text-sm text-taupe">Choose a password to finish setting up your SoftLife account.</p>
        </div>
        <SetPasswordForm />
      </div>
    </div>
  );
}
