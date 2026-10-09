// src/pages/auth/FirstTimeSetup.jsx
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { toast } from "react-hot-toast";
import { ShieldCheck, Eye, EyeOff } from "lucide-react";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";

/**
 * First-Time Admin Account Setup.
 *
 * Shown only while the system has no admin account. The availability check is
 * performed server-side (GET /api/admin/setup-admin) and re-verified on
 * submission — once an admin exists the endpoint rejects creation with 403,
 * so this page can never be used to add extra initial admins.
 */
export default function FirstTimeSetup() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  // Distinguishes "the server says setup is finished" from "the check itself
  // failed". Previously both collapsed into setupRequired=false, so a 429/500
  // from the availability endpoint rendered the misleading "Setup already
  // completed" screen — telling the operator an admin exists when the truth was
  // simply that the status could not be read.
  const [checkFailed, setCheckFailed] = useState(false);
  const [retryingCheck, setRetryingCheck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: { full_name: "", email: "", password: "", confirm: "" },
  });

  // Check server-side whether setup is still available.
  //
  // CRITICAL: only an explicit HTTP 200 carrying a real boolean may be treated
  // as an answer. A 429/500/offline response has no `setupRequired` field, and
  // the old code did `Boolean(data.setupRequired)` on it — `Boolean(undefined)`
  // is `false`, which rendered "Setup already completed" on a completely empty
  // database. Anything other than a definite 200/true|false is now a CHECK
  // FAILURE that offers a retry, never a claim that setup is finished.
  const runCheck = useCallback(async () => {
    setChecking(true);
    setCheckFailed(false);
    try {
      const res = await fetch("/api/admin/setup-admin", {
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      if (typeof data?.setupRequired !== "boolean") {
        throw new Error("Malformed setup-status response.");
      }
      setSetupRequired(data.setupRequired);
    } catch {
      // Fail CLOSED for rendering (never show the form on an unknown state),
      // but surface a retry instead of claiming setup is already done.
      setCheckFailed(true);
      setSetupRequired(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/setup-admin", {
          headers: { Accept: "application/json" },
        });
        const data = await res.json().catch(() => null);
        if (!active) return;
        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
        if (typeof data?.setupRequired !== "boolean") {
          throw new Error("Malformed setup-status response.");
        }
        setSetupRequired(data.setupRequired);
      } catch {
        if (active) setCheckFailed(true);
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(values) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/setup-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: values.full_name.trim(),
          email: values.email.trim(),
          password: values.password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data.error || "Failed to create the admin account.");
      toast.success("Admin account created. You can now sign in.");
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner label="Checking system status…" />
      </div>
    );
  }

  // The availability check could not be completed (429 / 500 / offline). Show a
  // retry rather than the misleading "Setup already completed" screen.
  if (checkFailed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <h1 className="text-lg font-semibold text-slate-800">
            Couldn’t check setup status
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            We couldn’t reach the server to confirm whether first-time setup is
            still available. This is usually brief — please retry, or wait a
            moment if you’ve made several attempts recently.
          </p>
          <div className="mt-5 flex flex-col items-center gap-2">
            <Button
              loading={retryingCheck}
              onClick={async () => {
                if (retryingCheck) return;
                setRetryingCheck(true);
                try {
                  await runCheck();
                } finally {
                  setRetryingCheck(false);
                }
              }}>
              Try again
            </Button>
            <p className="text-xs text-slate-400">
              Still not working?{" "}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="font-medium text-brand-600 hover:underline">
                Reload the page
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Setup already completed (or unavailable): hide the form entirely.
  if (!setupRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-green-600" />
          <h1 className="text-lg font-semibold text-slate-800">
            Setup already completed
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            An administrator account already exists for this system. Please sign
            in with your credentials.
          </p>
          <Link
            to="/login"
            className="mt-5 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  const password = watch("password");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <ShieldCheck className="mx-auto mb-3 h-12 w-12 text-brand-600" />
          <h1 className="text-2xl font-bold text-slate-800">
            First-Time Setup
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Create the first administrator account for your organization. This
            page will be disabled automatically afterwards.
          </p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          noValidate>
          <div>
            <Input
              label="Full name"
              placeholder="Juan Dela Cruz"
              error={errors.full_name?.message}
              {...register("full_name", {
                required: "Full name is required.",
                minLength: { value: 2, message: "Name is too short." },
              })}
            />
          </div>

          <div>
            <Input
              label="Email"
              type="email"
              placeholder="admin@company.com"
              error={errors.email?.message}
              {...register("email", {
                required: "Email is required.",
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: "Enter a valid email address.",
                },
              })}
            />
          </div>

          <div>
            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? "text" : "password"}
                placeholder="At least 12 characters"
                error={errors.password?.message}
                {...register("password", {
                  required: "Password is required.",
                  minLength: {
                    // H6: the bootstrap admin must meet the same server-side
                    // policy as every other account (12+ chars, upper, lower,
                    // digit) - it is the most privileged account in the system.
                    value: 12,
                    message: "Password must be at least 12 characters.",
                  },
                  pattern: {
                    value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
                    message:
                      "Include an uppercase letter, a lowercase letter and a number.",
                  },
                })}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-8 text-slate-400 hover:text-slate-600"
                aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <Input
              label="Confirm password"
              type={showPassword ? "text" : "password"}
              placeholder="Re-enter your password"
              error={errors.confirm?.message}
              {...register("confirm", {
                required: "Please confirm your password.",
                validate: (v) => v === password || "Passwords do not match.",
              })}
            />
          </div>

          <Button type="submit" loading={submitting} className="w-full">
            Create Admin Account
          </Button>

          <p className="text-center text-xs text-slate-400">
            This one-time form stops accepting submissions as soon as the first
            admin exists.
          </p>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-semibold text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
