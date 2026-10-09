// src/components/layout/navigation.js
import { ROLES } from "@/lib/constants";

/**
 * Sidebar navigation definition per role. Each item: { to, label, icon }.
 * `icon` is a key from the shared icon set (src/components/ui/icons).
 */

const icons = {
  dashboard: "dashboard",
  interns: "interns",
  assigned: "assigned",
  attendance: "attendance",
  journal: "journal",
  documents: "documents",
  evaluation: "evaluation",
  announcements: "announcements",
  reports: "reports",
  institutions: "institutions",
  audit: "audit",
  settings: "settings",
  profile: "profile",
};

export const NAVIGATION = {
  [ROLES.ADMIN]: [
    { to: "/admin", label: "Dashboard", icon: icons.dashboard },
    { to: "/admin/interns", label: "Interns", icon: icons.interns },
    { to: "/admin/supervisors", label: "Supervisors", icon: icons.assigned },
    { to: "/admin/attendance", label: "Attendance", icon: icons.attendance },
    { to: "/admin/journals", label: "Daily Journals", icon: icons.journal },
    { to: "/admin/documents", label: "Documents", icon: icons.documents },
    { to: "/admin/evaluations", label: "Evaluations", icon: icons.evaluation },
    {
      to: "/admin/announcements",
      label: "Announcements",
      icon: icons.announcements,
    },
    { to: "/admin/reports", label: "Reports", icon: icons.reports },
    {
      to: "/admin/institutions",
      label: "Institutions",
      icon: icons.institutions,
    },
    { to: "/admin/audit-logs", label: "Audit Logs", icon: icons.audit },
    { to: "/admin/settings", label: "Settings", icon: icons.settings },
    { to: "/profile", label: "Profile", icon: icons.profile },
  ],
  [ROLES.HR_STAFF]: [
    { to: "/admin", label: "Dashboard", icon: icons.dashboard },
    { to: "/admin/interns", label: "Interns", icon: icons.interns },
    { to: "/admin/supervisors", label: "Supervisors", icon: icons.assigned },
    { to: "/admin/documents", label: "Documents", icon: icons.documents },
    {
      to: "/admin/announcements",
      label: "Announcements",
      icon: icons.announcements,
    },
    { to: "/profile", label: "Profile", icon: icons.profile },
  ],
  [ROLES.SUPERVISOR]: [
    { to: "/supervisor", label: "Dashboard", icon: icons.dashboard },
    {
      to: "/supervisor/interns",
      label: "Assigned Interns",
      icon: icons.assigned,
    },
    {
      to: "/supervisor/attendance",
      label: "Attendance",
      icon: icons.attendance,
    },
    {
      to: "/supervisor/journals",
      label: "Daily Journals",
      icon: icons.journal,
    },
    {
      to: "/supervisor/documents",
      label: "Documents",
      icon: icons.documents,
    },
    {
      to: "/supervisor/evaluations",
      label: "Evaluations",
      icon: icons.evaluation,
    },
    { to: "/profile", label: "Profile", icon: icons.profile },
  ],
  [ROLES.INTERN]: [
    { to: "/intern", label: "Dashboard", icon: icons.dashboard },
    { to: "/intern/attendance", label: "Attendance", icon: icons.attendance },
    { to: "/intern/journal", label: "Daily Journal", icon: icons.journal },
    { to: "/intern/documents", label: "Documents", icon: icons.documents },
    { to: "/intern/evaluation", label: "Evaluation", icon: icons.evaluation },
    {
      to: "/intern/announcements",
      label: "Announcements",
      icon: icons.announcements,
    },
    { to: "/profile", label: "Profile", icon: icons.profile },
  ],
};

export function getNavItems(role) {
  return NAVIGATION[role] ?? [];
}
