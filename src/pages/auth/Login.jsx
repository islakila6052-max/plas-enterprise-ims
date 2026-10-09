// src/pages/auth/Login.jsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useAuth } from "@/contexts/AuthContext";
import { authService } from "@/services/authService";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ROLES } from "@/lib/constants";

const ROLE_HOME = {
  [ROLES.ADMIN]: "/admin",
  [ROLES.HR_STAFF]: "/admin",
  [ROLES.SUPERVISOR]: "/supervisor",
  [ROLES.INTERN]: "/intern",
};

// Custom SVG Icons
function FacebookIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={16}
      height={16}
      {...props}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function MailIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={16}
      height={16}
      {...props}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function GithubIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={16}
      height={16}
      {...props}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.15 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.62.24 2.85.12 3.15.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function XIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={16}
      height={16}
      {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function PhoneIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={16}
      height={16}
      {...props}>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.574 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

// Eye icons for password toggle
function EyeIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
      {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
      {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export default function Login() {
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Show the "First-time setup?" link only while no admin account exists.
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    let active = true;
    // Only an explicit 200 with a real boolean counts. A 429/500 has no
    // `setupRequired` field, and `Boolean(undefined)` is false — which silently
    // hid the setup link whenever the availability check was throttled.
    fetch("/api/admin/setup-admin", { headers: { Accept: "application/json" } })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (!active || !ok) return;
        if (typeof data?.setupRequired === "boolean") {
          setSetupRequired(data.setupRequired);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: { email: "", password: "" } });

  const from = location.state?.from?.pathname;

  async function onSubmit(values) {
    setServerError("");
    if (submitting) return;
    const email = String(values.email ?? "").trim();
    if (!email) {
      setServerError("Email is required.");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setServerError("No internet connection. Please check your network and try again.");
      return;
    }
    setSubmitting(true);
    try {
      await authService.signIn(email, values.password);
      const loaded = await refreshProfile();
      if (!loaded?.role) {
        setServerError(
          "Your account exists but no profile/role is assigned yet. Please contact an administrator to activate your account.",
        );
        return;
      }
      const target = from || ROLE_HOME[loaded?.role] || "/";
      navigate(target, { replace: true });
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-emerald-50 via-white to-green-100 overflow-hidden">
      <div className="flex flex-1 items-center justify-center p-3 sm:p-4 mt-0">
        <div className="w-full max-w-sm sm:max-w-md">
          {/* Logo Section */}
          <div className="text-center">
            <img
              src="/login-logo.png"
              alt="PLAS Enterprise"
              className="mx-auto h-24 sm:h-28 md:h-32 w-auto object-contain"
            />
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-emerald-900 tracking-tight px-2">
              Internship Management System
            </h1>
          </div>

          {/* Login Form */}
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="surface animate-fade-up space-y-4 p-4 sm:p-6 rounded-xl shadow-lg border border-emerald-100/50 bg-white/80 backdrop-blur-sm mt-4 sm:mt-6">
            {serverError && (
              <div
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs sm:text-sm text-red-700"
                role="alert"
                aria-live="assertive">
                {serverError}
              </div>
            )}
            <Input
              label="Email"
              type="email"
              maxLength={100}
              autoComplete="email"
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

            {/* Password Field with Eye Toggle */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={`w-full rounded-lg border ${
                    errors.password ? "border-red-300" : "border-slate-200"
                  } bg-white/70 px-3 sm:px-4 py-2 sm:py-2.5 pr-10 sm:pr-11 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all duration-200`}
                  {...register("password", {
                    required: "Password is required",
                  })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600 transition-colors duration-200"
                  aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div className="flex justify-between">
              <Link
                to="/forgot-password"
                className="text-xs sm:text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors">
                Forgot password?
              </Link>
              {setupRequired && (
                <Link
                  to="/setup"
                  className="text-xs sm:text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors">
                  First-time setup?
                </Link>
              )}
            </div>
            <Button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 sm:py-2.5 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg text-sm sm:text-base"
              loading={submitting}>
              Sign In
            </Button>
          </form>
        </div>
      </div>

      {/* Developer Credit Footer */}
      <footer className="pb-3 sm:pb-6 pt-2 sm:pt-4 text-center border-t border-emerald-100/30 bg-white/40 backdrop-blur-sm">
        <div className="max-w-md mx-auto px-3 sm:px-4">
          <p className="text-[10px] sm:text-xs font-medium text-slate-600">
            Developed by
            <a
              href="https://www.facebook.com/Mashiro.Villacampa"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 font-semibold hover:text-[#1877f2] transition-colors hover:underline ml-1">
              John Maico Villacampa
            </a>
          </p>
          <p className="mt-0.5 text-[10px] sm:text-[11px] text-slate-400">
            Intern | Computer Engineering
          </p>
          <p className="text-[9px] sm:text-[10px] text-slate-400/70 mt-0.5">
            © {new Date().getFullYear()} PLAS Internship Management System. All
            rights reserved.
          </p>

          <div className="mt-2 sm:mt-3 flex flex-wrap items-center justify-center gap-x-4 sm:gap-x-5 gap-y-1.5 sm:gap-y-2">
            <a
              href="https://www.facebook.com/Mashiro.Villacampa"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 transition-all duration-200 hover:text-[#1877f2] hover:scale-110"
              aria-label="Facebook">
              <FacebookIcon />
            </a>

            <a
              href="mailto:johnmaicovillacampa@gmail.com"
              className="text-slate-400 transition-all duration-200 hover:text-[#ea4335] hover:scale-110"
              aria-label="Email">
              <MailIcon />
            </a>

            <a
              href="https://github.com/mikshts"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 transition-all duration-200 hover:text-[#333] hover:scale-110"
              aria-label="GitHub">
              <GithubIcon />
            </a>

            <a
              href="https://x.com/Vil41354Michael"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 transition-all duration-200 hover:text-[#1da1f2] hover:scale-110"
              aria-label="X (Twitter)">
              <XIcon />
            </a>

            <span
              className="text-slate-400 hover:text-emerald-600 transition-colors"
              aria-label="Phone">
              <PhoneIcon />
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
