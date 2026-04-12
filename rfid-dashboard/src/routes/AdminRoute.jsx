import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export default function AdminRoute() {
  const { loading, isAuthenticated, canAccessAdminUI } = useAuth();

  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessAdminUI) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
