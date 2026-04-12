import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export default function ProductRoute({ anyOf = [], children }) {
  const { loading, isAuthenticated, productKey } = useAuth();

  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const allowedProducts = Array.isArray(anyOf)
    ? anyOf.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : [];

  if (!allowedProducts.length || allowedProducts.includes(productKey)) {
    return children;
  }

  return (
    <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      This login is not assigned to this Xandora software.
    </div>
  );
}
