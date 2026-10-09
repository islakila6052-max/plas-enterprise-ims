// src/components/layout/Navbar.jsx
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import NotificationBell from "@/components/layout/NotificationBell";
import { Icon } from "@/components/ui/icons";
import { ROLE_LABELS } from "@/lib/constants";

/** Top navbar with menu toggle, page title, and user menu. */
export default function Navbar({ title, onMenuClick }) {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-brand-100 bg-white/80 px-4 backdrop-blur lg:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-md p-2 text-slate-500 transition hover:bg-brand-50 hover:text-brand-700 lg:hidden"
          aria-label="Toggle menu">
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <NotificationBell />
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-slate-700">
            {profile?.full_name ?? "User"}
          </p>
          <p className="text-xs text-slate-400">{ROLE_LABELS[role] ?? ""}</p>
        </div>
      </div>
    </header>
  );
}
