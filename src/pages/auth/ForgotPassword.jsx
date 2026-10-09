// src/pages/auth/ForgotPassword.jsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { authService } from "@/services/authService";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: { email: "" } });

  async function onSubmit({ email }) {
    setServerError("");
    if (submitting) return;
    const cleaned = String(email ?? "").trim();
    if (!cleaned) {
      setServerError("Email is required.");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setServerError("No internet connection. Please check your network and try again.");
      return;
    }
    setSubmitting(true);
    try {
      await authService.forgotPassword(cleaned);
      setSent(true);
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-brand-50 via-canvas to-brand-100">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-slate-800">Reset password</h1>
            <p className="mt-1 text-sm text-slate-500">
              We'll email you a reset link
            </p>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="surface space-y-4 p-6">
            {sent ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                If an account exists for that email, a reset link has been sent.
                Check your inbox.
              </div>
            ) : (
              <>
                {serverError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {serverError}
                  </div>
                )}
                <Input
                  label="Email"
                  type="email" maxLength={100}
                  placeholder="you@company.com"
                  error={errors.email?.message}
                  {...register("email", {
                    required: "Email is required",
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: "Enter a valid email",
                    },
                  })}
                />
                <Button type="submit" className="w-full" loading={submitting}>
                  Send reset link
                </Button>
              </>
            )}
            <p className="text-center text-sm text-slate-500">
              <Link to="/login" className="font-medium text-brand-600">
                Back to sign in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
