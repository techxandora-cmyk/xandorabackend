import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export default function PermissionRoute({ anyOf = [], children }) {
  const { loading, isAuthenticated, hasPermission } = useAuth();

  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const required = Array.isArray(anyOf) ? anyOf.filter(Boolean) : [];
  if (!required.length) return children;

  const allowed = required.some((perm) => hasPermission(perm));
  if (!allowed) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        You do not have permission to view this section.
      </div>
    );
  }

  return children;
}
