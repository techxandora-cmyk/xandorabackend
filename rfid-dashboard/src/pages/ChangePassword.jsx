import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { apiPost } from "@/lib/api";

export default function ChangePassword() {
  const { user, forcePasswordChange, refreshToken, logout } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isForced = forcePasswordChange;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const body = isForced
        ? { new_password: newPassword }
        : { current_password: currentPassword, new_password: newPassword };

      const res = await apiPost("/auth/change-password", body);
      if (res?.token) {
        refreshToken(res.token);
      }
      // Navigate based on product
      const productKey = user?.product_key || "retail";
      if (productKey === "portal") {
        navigate("/admin", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (e) {
      setError(e.message || "Failed to change password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="glass w-full max-w-sm rounded-2xl p-8 space-y-6">
        {isForced ? (
          <>
            <div>
              <h1 className="text-lg font-semibold">Set your password</h1>
              <p className="text-xs text-white/50 mt-1">
                Your account was created by an admin. Choose a new password before continuing.
              </p>
            </div>
          </>
        ) : (
          <div>
            <h1 className="text-lg font-semibold">Change password</h1>
            <p className="text-xs text-white/50 mt-1">{user?.email}</p>
          </div>
        )}

        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isForced && (
            <div>
              <label className="text-xs text-white/50 block mb-1">Current password</label>
              <input
                type="password"
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-white/50 block mb-1">New password</label>
            <input
              type="password"
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
              placeholder="Min. 8 characters"
            />
          </div>

          <div>
            <label className="text-xs text-white/50 block mb-1">Confirm new password</label>
            <input
              type="password"
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            {saving ? "Saving…" : isForced ? "Set password & continue" : "Update password"}
          </button>

          {!isForced && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-full py-2 text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Cancel
            </button>
          )}

          {isForced && (
            <button
              type="button"
              onClick={logout}
              className="w-full py-2 text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Sign out instead
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
