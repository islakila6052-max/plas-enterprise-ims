// src/pages/ProfileSettings.jsx
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { profileService } from "@/services/profileService";
import { useAuth } from "@/contexts/AuthContext";
import Button from "@/components/ui/Button";
import {
  Input,
  PhoneInput,
  Textarea,
  CharCounter,
} from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import Avatar from "@/components/ui/Avatar";
import Spinner from "@/components/ui/Spinner";
import ChangePassword from "@/pages/auth/ChangePassword";
import { ROLE_LABELS } from "@/lib/constants";

export default function ProfileSettings() {
  const { user, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState("");
  const savedTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    defaultValues: {
      full_name: "",
      contact_number: "",
      bio: "",
    },
  });

  // Watch the contact_number field for real-time validation
  const contactNumber = watch("contact_number");

  useEffect(() => {
    if (profile) {
      // Extract only the local number (last 10 digits)
      let localNumber = profile.contact_number || "";

      // Remove any non-digit characters
      const digits = localNumber.replace(/\D/g, "");

      // If it starts with 63, remove the country code
      if (digits.startsWith("63")) {
        localNumber = digits.slice(2); // Remove "63"
      } else {
        localNumber = digits;
      }

      reset({
        full_name: profile.full_name || "",
        contact_number: localNumber, // Store only the local digits
        bio: profile.bio || "",
      });
    } else {
      reset({
        full_name: user?.full_name || "",
        contact_number: "",
        bio: "",
      });
    }
    setLoading(false);
  }, [profile, reset, user]);

  // Handle phone number change - PhoneInput returns just the local digits
  const handlePhoneChange = (value) => {
    setValue("contact_number", value, { shouldValidate: true });
  };

  // Validate phone number
  const validatePhoneNumber = (value) => {
    if (!value) return true; // Phone is optional

    const digits = String(value).replace(/\D/g, "");

    if (!digits) return true;

    if (digits.length !== 10) {
      return "Must be exactly 10 digits";
    }

    const validPrefixes = ["9"];
    const firstDigit = digits[0];
    if (!validPrefixes.includes(firstDigit)) {
      return "Must start with 9 (Philippine mobile)";
    }

    return true;
  };

  async function onSubmit(values) {
    setServerError("");
    setSaved(false);
    if (saving) return;
    if (!user?.id) {
      setServerError("Your session isn't ready yet. Please reload and try again.");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setServerError("No internet connection. Please check your network and try again.");
      return;
    }
    // Defer clearing timers across renders.
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSaving(true);

    let profileSaved = false;
    try {
      let cleanContactNumber = null;

      if (values.contact_number) {
        const digits = values.contact_number.replace(/\D/g, "");
        if (digits.length === 10) {
          cleanContactNumber = `63${digits}`; // Store with country code
        } else if (digits.length > 0) {
          setServerError("Contact number must be exactly 10 digits starting with 9.");
          return;
        }
      }

      // The target row is resolved from the caller's JWT by the
      // `update_own_profile` RPC, so no user id is passed from the client.
      await profileService.update({
        full_name: values.full_name.trim(),
        contact_number: cleanContactNumber,
        bio: (values.bio ?? "").trim(),
      });
      profileSaved = true;
      toast.success("Profile saved.");

      // NOTE: the audit trail for profile changes (name/bio/contact/role) is
      // written automatically by the database trigger created in
      // supabase/migrations/0044_audit_profile_changes.sql. It captures the
      // true previous value server-side, so no client-side recordAudit here —
      // adding one would create duplicate audit rows.

      await refreshProfile();
      setSaved(true);

      savedTimer.current = setTimeout(() => setSaved(false), 5000);
    } catch (err) {
      const message = profileSaved
        ? "Profile saved, but the latest profile could not be refreshed. Please reload."
        : err.message || "Failed to update profile. Please try again.";
      setServerError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Spinner label="Loading profile…" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center gap-4 border-b border-slate-100 px-5 py-4">
          <Avatar
            src={profile?.avatar_url}
            name={profile?.full_name || user?.full_name || "User"}
            size="lg"
          />
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              {profile?.full_name || user?.full_name || "Your Profile"}
            </h3>
            <p className="text-sm text-slate-500">
              {ROLE_LABELS[profile?.role] || "User"} · {user?.email}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-5">
          {/* Success Message */}
          {saved && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              ✓ Profile updated successfully!
            </div>
          )}

          {/* Error Message */}
          {serverError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              ⚠️ {serverError}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Full Name"
              maxLength={50}
              placeholder="Enter your full name"
              error={errors.full_name?.message}
              {...register("full_name", {
                required: "Full name is required",
                maxLength: { value: 50, message: "Maximum 50 characters" },
                minLength: { value: 2, message: "Minimum 2 characters" },
              })}
            />

            <div>
              <PhoneInput
                label={
                  <div className="flex items-center gap-2">
                    <span>Contact Number</span>
                    {contactNumber && !errors.contact_number && (
                      <span className="text-xs font-normal text-emerald-600">
                        ✓ Valid
                      </span>
                    )}
                    {contactNumber && errors.contact_number && (
                      <span className="text-xs font-normal text-red-600">
                        ✗ Invalid
                      </span>
                    )}
                  </div>
                }
                value={contactNumber || ""}
                onChange={handlePhoneChange}
                placeholder="912 345 6789"
                error={errors.contact_number?.message}
              />
              <p className="mt-1 text-xs text-slate-400">
                Enter 10-digit mobile number (e.g., 9123456789)
              </p>
            </div>
          </div>

          <div>
            <Textarea
              label="Bio"
              rows={3}
              maxLength={250}
              placeholder="Tell us about yourself..."
              error={errors.bio?.message}
              {...register("bio", {
                maxLength: {
                  value: 250,
                  message: "Maximum 250 characters",
                },
              })}
            />
            <CharCounter value={watch("bio") || ""} limit={250} />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" loading={saving} disabled={saving}>
              Save Changes
            </Button>
            {saving && (
              <span className="text-sm text-slate-500">Saving...</span>
            )}
          </div>
        </form>
      </Card>

      <ChangePassword />
    </div>
  );
}
