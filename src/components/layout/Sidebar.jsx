// src/components/layout/Sidebar.jsx
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { cn } from "@/utils/cn";
import { getNavItems } from "@/components/layout/navigation";
import { Icon } from "@/components/ui/icons";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABELS } from "@/lib/constants";
import Avatar from "@/components/ui/Avatar";
import { resetTour } from "@/components/layout/OnboardingTour";

/** Role-aware collapsible sidebar with a dark-green theme. */
export default function Sidebar({ open, onClose }) {
  const { role, profile, signOut, isAdmin, isSupervisor, isIntern } = useAuth();
  const navigate = useNavigate();
  const items = getNavItems(role);
  const [profileOpen, setProfileOpen] = useState(false);

  async function handleLogout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  /** Restart the onboarding tour on the user's dashboard. */
  function handleRestartTour() {
    setProfileOpen(false);
    // Scope the reset to this user so "Restart Tour" reliably re-arms the
    // auto-start, without clearing anyone else's completion flag.
    resetTour(profile?.id);
    const home = isAdmin ? "/admin" : isSupervisor ? "/supervisor" : "/intern";
    navigate(home, { replace: true });
    // Let the layout remount/re-render before re-triggering the tour.
    setTimeout(() => window.dispatchEvent(new Event("ims:restart-tour")), 100);
  }

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-white transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}>
        <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white/95 p-1">
            <img
              src="/plas-enterprise-logo-ims-project.png"
              alt="PLAS Enterprise"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-white">PLAS Enterprise</p>
            <p className="text-xs text-brand-200">Internship System</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={
                item.to === "/admin" ||
                item.to === "/supervisor" ||
                item.to === "/intern"
              }
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  isActive
                    ? "bg-brand-500/20 text-white shadow-inner ring-1 ring-brand-400/40"
                    : "text-brand-100 hover:bg-white/10 hover:text-white",
                )
              }>
              <Icon name={item.icon} className="h-5 w-5 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="relative border-t border-white/10 px-3 py-3">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/10">
            <Avatar
              src={profile?.avatar_url}
              name={profile?.full_name}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {profile?.full_name ?? "User"}
              </p>
              <p className="truncate text-xs text-brand-200">
                {ROLE_LABELS[role] ?? "User"}
              </p>
            </div>
            <Icon
              name="chevronDown"
              className={cn(
                "h-4 w-4 text-brand-200 transition",
                profileOpen && "rotate-180",
              )}
            />
          </button>

          {profileOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-lg border border-white/10 bg-sidebar-800 shadow-xl">
              <NavLink
                to="/profile"
                onClick={() => {
                  setProfileOpen(false);
                  onClose();
                }}
                className="block px-4 py-2 text-sm text-brand-100 transition hover:bg-white/10 hover:text-white">
                Profile
              </NavLink>
              {(isAdmin || isSupervisor || isIntern) && (
                <button
                  type="button"
                  onClick={handleRestartTour}
                  className="block w-full px-4 py-2 text-left text-sm text-brand-100 transition hover:bg-white/10 hover:text-white">
                  Restart Tour
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="block w-full px-4 py-2 text-left text-sm text-brand-100 transition hover:bg-white/10 hover:text-white">
                Logout
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
