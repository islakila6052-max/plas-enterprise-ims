// src/pages/auth/ResetPassword.jsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { authService } from "@/services/authService";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigate("/login", { replace: true }), 1500);
    return () => clearTimeout(t);
  }, [done, navigate]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: { password: "", confirm: "" } });

  async function onSubmit({ password }) {
    setServerError("");
    if (submitting) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setServerError("No internet connection. Please check your network and try again.");
      return;
    }
    setSubmitting(true);
    try {
      await authService.updatePassword(password);
      setDone(true);
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
            <h1 className="text-2xl font-bold text-slate-800">Set new password</h1>
            <p className="mt-1 text-sm text-slate-500">
              Choose a strong password for your account
            </p>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="surface space-y-4 p-6">
            {done ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                Password updated. Redirecting to sign in…
              </div>
            ) : (
              <>
                {serverError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {serverError}
                  </div>
                )}
                <Input
                  label="New password"
                  type="password"
                  placeholder="••••••••"
                  error={errors.password?.message}
                  {...register("password", {
                    required: "Password is required",
                    // H6: matches the server-side policy (12+ chars, upper,
                    // lower, digit). The server remains the enforcement point.
                    minLength: { value: 12, message: "At least 12 characters" },
                    pattern: {
                      value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
                      message:
                        "Include an uppercase letter, a lowercase letter and a number.",
                    },
                  })}
                />
                <Input
                  label="Confirm password"
                  type="password"
                  placeholder="••••••••"
                  error={errors.confirm?.message}
                  {...register("confirm", {
                    required: "Please confirm your password",
                    validate: (v) =>
                      v === watch("password") || "Passwords do not match",
                  })}
                />
                <Button type="submit" className="w-full" loading={submitting}>
                  Update password
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
