// src/pages/auth/ChangePassword.jsx
import { useState } from "react";
import { useForm } from "react-hook-form";
import { authService } from "@/services/authService";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import { useAuth } from "@/contexts/AuthContext";
import { Icon } from "@/components/ui/icons";

/**
 * Password strength rules. Each rule is a predicate on the raw password.
 *
 * H6: the length floor was 8, which is far too weak for an account that can
 * reach admin functions. It is now 12 to match the server-side policy in
 * api/admin/_security.js (validatePassword) and the Supabase Auth policy. The
 * server remains the enforcement point; this is guidance only.
 */
const RULES = [
  { id: "length", label: "At least 12 characters", test: (p) => p.length >= 12 },
  { id: "upper", label: "At least one uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "At least one lowercase letter", test: (p) => /[a-z]/.test(p) },
  { id: "number", label: "At least one number", test: (p) => /[0-9]/.test(p) },
  { id: "special", label: "At least one symbol (recommended)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/**
 * The subset of rules the server actually enforces (length + upper + lower +
 * number). The "symbol" rule is deliberately excluded: it is a recommendation
 * shown in the meter, not a requirement, so a user is never blocked by a rule
 * the backend would also reject.
 */
const REQUIRED_RULES = ["length", "upper", "lower", "number"];

export function meetsServerPolicy(password) {
  return REQUIRED_RULES.every((id) =>
    RULES.find((r) => r.id === id)?.test(password ?? ""),
  );
}

/** Returns a 0-4 strength score based on how many rules pass. */
function strengthScore(password) {
  if (!password) return 0;
  return RULES.filter((r) => r.test(password)).length;
}

const STROKE = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e"];

/** A single rule indicator: dot + label, green when passing. */
function Rule({ label, ok }) {
  return (
    <li className={`flex items-center gap-1.5 text-xs ${ok ? "text-emerald-600" : "text-slate-400"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-300"}`} />
      {label}
    </li>
  );
}

export default function ChangePassword() {
  const { user } = useAuth();
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm({ defaultValues: { password: "", confirm: "" } });

  const password = watch("password") || "";
  const score = strengthScore(password);

  async function onSubmit({ password }) {
    setServerError("");
    setDone(false);
    setSubmitting(true);
    try {
      await authService.updatePassword(password);
      setDone(true);
      reset();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-base font-semibold text-slate-800">Change password</h3>
        <p className="mt-0.5 text-sm text-slate-500">
          {user?.email ? `Signed in as ${user.email}` : "Update your account password"}
        </p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-5">
        {done && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Password changed successfully.
          </div>
        )}
        {serverError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </div>
        )}
        <div className="grid max-w-md gap-4">
          <div>
            <Input
              label="New password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              error={errors.password?.message}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="text-slate-400 hover:text-emerald-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <Icon name={showPassword ? "eyeOff" : "eye"} className="h-4 w-4" />
                </button>
              }
              {...register("password", {
                required: "Password is required",
                // H6: 12+ chars, upper, lower, digit - exactly the policy
                // enforced server-side by api/admin/_security.js. The "symbol"
                // rule is dropped here so the client never blocks a password
                // the backend would accept.
                minLength: { value: 12, message: "At least 12 characters" },
                validate: {
                  upper: (p) => /[A-Z]/.test(p) || "Needs at least one uppercase letter",
                  lower: (p) => /[a-z]/.test(p) || "Needs at least one lowercase letter",
                  number: (p) => /[0-9]/.test(p) || "Needs at least one number",
                },
              })}
            />
            {/* Strength bar */}
            <div className="mt-2 flex gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  key={i}
                  className="h-1 flex-1 rounded-full"
                  style={{ background: i < score ? STROKE[score] : "#e2e8f0" }}
                />
              ))}
            </div>
            <ul className="mt-2 space-y-1">
              {RULES.map((r) => (
                <Rule key={r.id} label={r.label} ok={r.test(password)} />
              ))}
            </ul>
          </div>
          <Input
            label="Confirm password"
            type={showConfirm ? "text" : "password"}
            placeholder="••••••••"
            error={errors.confirm?.message}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowConfirm((s) => !s)}
                className="text-slate-400 hover:text-emerald-600"
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                <Icon name={showConfirm ? "eyeOff" : "eye"} className="h-4 w-4" />
              </button>
            }
            {...register("confirm", {
              required: "Please confirm your password",
              validate: (v) =>
                v === watch("password") || "Passwords do not match",
            })}
          />
        </div>
        <Button type="submit" loading={submitting}>
          Update password
        </Button>
      </form>
    </Card>
  );
}