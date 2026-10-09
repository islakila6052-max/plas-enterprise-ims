// src/routes/RoleRoute.jsx
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Restrict a route to one or more roles.
 * @param {string[]} roles allowed roles
 */
export default function RoleRoute({ roles, children }) {
  const { role } = useAuth();

  if (!role || !roles.includes(role)) {
    // Send the user to their own dashboard root.
    if (role === "admin" || role === "hr_staff") return <Navigate to="/admin" replace />;
    if (role === "supervisor") return <Navigate to="/supervisor" replace />;
    if (role === "intern") return <Navigate to="/intern" replace />;
    return <Navigate to="/login" replace />;
  }

  return children;
}
