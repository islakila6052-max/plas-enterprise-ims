// src/components/institutions/DatabaseConnectionCard.jsx
import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * System configuration card — DATABASE CONNECTION ONLY.
 *
 * SECURITY: This intentionally does NOT collect or store Supabase keys in the
 * browser. The Service Role Key must never reach the client. Instead it tests
 * the connection using the already-configured environment variables
 * (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) and shows a status indicator.
 */
export default function DatabaseConnectionCard() {
  const [status, setStatus] = useState(null); // 'connected' | 'failed' | null
  const [message, setMessage] = useState("");
  const [testing, setTesting] = useState(false);

  async function testConnection() {
    setTesting(true);
    setStatus(null);
    setMessage("");
    try {
      if (!isSupabaseConfigured) {
        throw new Error("Supabase is not configured on this deployment.");
      }
      // Lightweight reachability check: list institutions (admin-readable).
      const { error } = await supabase.from("institutions").select("institution_id").limit(1);
      if (error) throw error;
      setStatus("connected");
      setMessage("Connected to Supabase successfully.");
    } catch (err) {
      setStatus("failed");
      setMessage(err.message || "Connection failed.");
    } finally {
      setTesting(false);
    }
  }

  const dot =
    status === "connected"
      ? "🟢"
      : status === "failed"
        ? "🔴"
        : "⚪";

  return (
    <Card>
      <div className="border-b border-brand-100 px-5 py-4">
        <h3 className="text-base font-semibold text-slate-800">System Configuration</h3>
        <p className="mt-0.5 text-sm text-slate-500">
          Database connection status. Keys are managed via environment variables, not this form.
        </p>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3">
          <span className="text-xl leading-none">{dot}</span>
          <div>
            <p className="text-sm font-medium text-slate-700">
              {status === "connected"
                ? "Connected"
                : status === "failed"
                  ? "Failed"
                  : "Not tested"}
            </p>
            {message && <p className="text-xs text-slate-500">{message}</p>}
          </div>
        </div>

        <Input label="Supabase Project URL" value={import.meta.env.VITE_SUPABASE_URL || ""} readOnly />
        <Input
          label="Supabase Anon Key"
          value={isSupabaseConfigured ? "•••••••• (configured)" : ""}
          readOnly
        />
        <Input label="Supabase Service Role Key" value="•••••••• (server-only, not exposed)" readOnly />

        <div className="flex gap-2">
          <Button onClick={testConnection} loading={testing}>
            Test Database Connection
          </Button>
          <Button variant="secondary" onClick={testConnection} disabled={testing}>
            Save Configuration
          </Button>
        </div>
        <p className="text-xs text-slate-400">
          The Service Role Key is server-side only (used by /api/admin/create-user). It is never
          sent to or stored in the browser.
        </p>
      </div>
    </Card>
  );
}
