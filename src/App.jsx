// src/App.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "@/routes/ProtectedRoute";
import RoleRoute from "@/routes/RoleRoute";
import DashboardLayout from "@/layouts/DashboardLayout";

import Login from "@/pages/auth/Login";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";
import FirstTimeSetup from "@/pages/auth/FirstTimeSetup";
import ProfileSettings from "@/pages/ProfileSettings";

import AdminDashboard from "@/pages/admin/AdminDashboard";
import InternManagement from "@/pages/admin/InternManagement";
import AdminAttendance from "@/pages/admin/AdminAttendance";
import AdminJournals from "@/pages/admin/AdminJournals";
import AdminDocuments from "@/pages/admin/AdminDocuments";
import AdminEvaluations from "@/pages/admin/AdminEvaluations";
import AdminAnnouncements from "@/pages/admin/AdminAnnouncements";
import AdminReports from "@/pages/admin/AdminReports";
import AdminSettings from "@/pages/admin/AdminSettings";
import AdminSupervisors from "@/pages/admin/AdminSupervisors";
import AdminAuditLogs from "@/pages/admin/AdminAuditLogs";
import AdminInstitutions from "@/pages/admin/AdminInstitutions";
import InstitutionProfile from "@/pages/admin/InstitutionProfile";

import SupervisorDashboard from "@/pages/supervisor/SupervisorDashboard";
import SupervisorInterns from "@/pages/supervisor/SupervisorInterns";
import SupervisorAttendance from "@/pages/supervisor/SupervisorAttendance";
import SupervisorJournals from "@/pages/supervisor/SupervisorJournals";
import SupervisorEvaluations from "@/pages/supervisor/SupervisorEvaluations";
import SupervisorDocuments from "@/pages/supervisor/SupervisorDocuments";

import InternDashboard from "@/pages/intern/InternDashboard";
import InternAttendance from "@/pages/intern/InternAttendance";
import InternJournal from "@/pages/intern/InternJournal";
import InternDocuments from "@/pages/intern/InternDocuments";
import InternEvaluation from "@/pages/intern/InternEvaluation";
import InternAnnouncements from "@/pages/intern/InternAnnouncements";

export default function App() {
  return (
    <Routes>
      {/* Public auth routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* One-time first-admin setup; disables itself once an admin exists. */}
      <Route path="/setup" element={<FirstTimeSetup />} />

      {/* Protected app shell */}
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }>
        <Route path="/profile" element={<ProfileSettings />} />

        {/* Admin */}
        <Route
          path="/admin"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminDashboard />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/interns"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <InternManagement />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/attendance"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminAttendance />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/journals"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminJournals />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/documents"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminDocuments />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/evaluations"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminEvaluations />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/announcements"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminAnnouncements />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminReports />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminSettings />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/supervisors"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminSupervisors />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/institutions"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminInstitutions />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/institutions/:institutionId"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <InstitutionProfile />
            </RoleRoute>
          }
        />
        <Route
          path="/admin/audit-logs"
          element={
            <RoleRoute roles={["admin", "hr_staff"]}>
              <AdminAuditLogs />
            </RoleRoute>
          }
        />

        {/* Supervisor */}
        <Route
          path="/supervisor"
          element={
            <RoleRoute roles={["supervisor"]}>
              <SupervisorDashboard />
            </RoleRoute>
          }
        />
        <Route
          path="/supervisor/interns"
          element={
            <RoleRoute roles={["supervisor"]}>
              <SupervisorInterns />
            </RoleRoute>
          }
        />
        <Route
          path="/supervisor/attendance"
          element={
            <RoleRoute roles={["supervisor"]}>
              <SupervisorAttendance />
            </RoleRoute>
          }
        />
        <Route
          path="/supervisor/journals"
          element={
            <RoleRoute roles={["supervisor"]}>
              <SupervisorJournals />
            </RoleRoute>
          }
        />
        <Route
          path="/supervisor/evaluations"
          element={
            <RoleRoute roles={["supervisor"]}>
              <SupervisorEvaluations />
            </RoleRoute>
          }
        />
        <Route
          path="/supervisor/documents"
          element={
            <RoleRoute roles={["supervisor"]}>
              <SupervisorDocuments />
            </RoleRoute>
          }
        />

        {/* Intern */}
        <Route
          path="/intern"
          element={
            <RoleRoute roles={["intern"]}>
              <InternDashboard />
            </RoleRoute>
          }
        />
        <Route
          path="/intern/attendance"
          element={
            <RoleRoute roles={["intern"]}>
              <InternAttendance />
            </RoleRoute>
          }
        />
        <Route
          path="/intern/journal"
          element={
            <RoleRoute roles={["intern"]}>
              <InternJournal />
            </RoleRoute>
          }
        />
        <Route
          path="/intern/documents"
          element={
            <RoleRoute roles={["intern"]}>
              <InternDocuments />
            </RoleRoute>
          }
        />
        <Route
          path="/intern/evaluation"
          element={
            <RoleRoute roles={["intern"]}>
              <InternEvaluation />
            </RoleRoute>
          }
        />
        <Route
          path="/intern/announcements"
          element={
            <RoleRoute roles={["intern"]}>
              <InternAnnouncements />
            </RoleRoute>
          }
        />
      </Route>

      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
