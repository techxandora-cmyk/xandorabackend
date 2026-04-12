import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { initTheme } from "@/lib/theme";
import XandoraLockupLogo from "@/components/XandoraLockupLogo";

const RECENT_EMAILS_KEY = "zyro_recent_emails";
const LAST_PRODUCT_KEY = "zyro_last_product_key";
const PRODUCT_KEY_ALIASES = {
  jewellery: "stock_audit",
  jewelry: "stock_audit",
};
const SOFTWARE_OPTIONS = [
  {
    value: "portal",
    label: "Xandora Admin Portal",
    kicker: "Control layer",
    summary: "Customers, users, software allocation, and governance.",
    helper: "For master and customer admin accounts.",
  },
  {
    value: "retail",
    label: "Xandora Retail",
    kicker: "Operational floor",
    summary: "POS, stock visibility, device visibility, and alerts.",
    helper: "For retail store and operations teams.",
  },
  {
    value: "laundry",
    label: "Xandora Laundry",
    kicker: "Lifecycle tracking",
    summary: "Fabric movements, wash cycles, returns, losses, and retirement.",
    helper: "For fabric tracking and lifecycle operations.",
  },
  {
    value: "stock_audit",
    label: "Xandora Stock Audit",
    kicker: "Count assurance",
    summary: "Cycle counts, scan verification, discrepancy review, and stocktake control.",
    helper: "For audits, stock counts, and reconciliation workflows.",
  },
];

function loadRecentEmails() {
  try {
    const raw = localStorage.getItem(RECENT_EMAILS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveRecentEmail(email) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalized) return;

  const next = [normalized, ...loadRecentEmails().filter((item) => item !== normalized)].slice(
    0,
    5
  );

  localStorage.setItem(RECENT_EMAILS_KEY, JSON.stringify(next));
}

export default function Login() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  const [isDark] = useState(() => initTheme().dark);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [productKey, setProductKey] = useState(() => {
    const rememberedRaw = String(localStorage.getItem(LAST_PRODUCT_KEY) || "")
      .trim()
      .toLowerCase();
    const remembered = PRODUCT_KEY_ALIASES[rememberedRaw] || rememberedRaw;
    return SOFTWARE_OPTIONS.some((option) => option.value === remembered)
      ? remembered
      : "retail";
  });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const recentEmails = loadRecentEmails();
  const selectedProduct =
    SOFTWARE_OPTIONS.find((option) => option.value === productKey) || SOFTWARE_OPTIONS[0];
  const headingTextClass = isDark ? "text-[#F2F9FF]" : "text-[#091523]";
  const mutedTextClass = isDark ? "text-[#D5E0EC]" : "text-[#46566D]";

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await apiPost("/auth/login", {
        email,
        password,
        product_key: productKey,
      });
      const token = res?.token;
      if (!token) {
        throw new Error("Invalid login response");
      }

      saveRecentEmail(email);
      localStorage.setItem(LAST_PRODUCT_KEY, productKey);
      setAuth(null, token, true);
      navigate("/", { replace: true });
    } catch (err) {
      if (err?.status === 401) {
        setError("Invalid email or password");
      } else if (err?.status === 403) {
        setError(err?.error || err?.message || "Access denied");
      } else if (err?.status === 400) {
        setError(err?.error || err?.message || "Check the selected software");
      } else {
        setError(err?.error || err?.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  function selectProduct(nextProductKey) {
    setProductKey(nextProductKey);
    setShowForm(true);
    setError("");
  }

  function goBackToModules() {
    setShowForm(false);
    setError("");
  }

  return (
    <div className={`brand-shell ${!isDark ? "light-override" : ""}`}>
      <div className="mx-auto flex min-h-screen w-full max-w-[1080px] flex-col items-center justify-center px-4 py-10">
        <div className="brand-login-head brand-login-head-compact">
          <div className="brand-login-logo">
            <XandoraLockupLogo className="brand-login-logo-img" />
          </div>
          <h1 className={`brand-login-title ${headingTextClass}`}>
            <span className="brand-login-title-plain">RFID Control</span>
          </h1>
          <p className={`max-w-xl text-center text-sm leading-6 ${mutedTextClass}`}>
            Choose your Xandora software first, then continue into the right workflow.
          </p>
          <div className="brand-login-line" aria-hidden />
        </div>

        <div className="brand-module-stage">
          <div className="brand-module-backdrop" aria-hidden>
            <span className="brand-module-backdrop-orb brand-module-backdrop-orb-cyan" />
            <span className="brand-module-backdrop-orb brand-module-backdrop-orb-violet" />
          </div>
          <div className={`brand-module-scene ${showForm ? "is-flipped" : ""}`}>
            <section className="brand-module-face brand-module-face-front brand-card">
              <div className="brand-module-front-layout">
                <div className="brand-module-front-copy">
                  <div className="brand-step-chip">Step 1</div>
                  <h2 className={`text-3xl font-semibold leading-tight ${headingTextClass}`}>
                    Select your workspace.
                  </h2>
                  <p className={`max-w-sm text-sm leading-6 ${mutedTextClass}`}>
                    Keep the login focused. Choose the Xandora module first, and we open a cleaner
                    sign-in panel just for that experience.
                  </p>

                  <div className="brand-module-side-note">
                    <div className="brand-module-side-note-label">How it works</div>
                    <div className={`mt-2 text-sm leading-6 ${mutedTextClass}`}>
                      One shared identity, separate software experiences, and no unnecessary noise
                      before sign-in.
                    </div>
                  </div>
                </div>

                <div className="brand-module-grid">
                  {SOFTWARE_OPTIONS.map((option) => {
                    const active = option.value === productKey;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => selectProduct(option.value)}
                        data-active={active ? "true" : "false"}
                        data-module={option.value}
                        className="brand-module-option"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="brand-module-chip">{option.kicker}</span>
                            <div className="mt-3 text-lg font-semibold text-white/95">
                              {option.label}
                            </div>
                          </div>
                          <span className="brand-module-dot" aria-hidden />
                        </div>
                        <div className="mt-4 text-sm leading-6 text-white/72">
                          {option.summary}
                        </div>
                        <div className="mt-4 text-xs text-white/48">{option.helper}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="brand-module-face brand-module-face-back brand-card">
              <button
                type="button"
                onClick={goBackToModules}
                className="brand-module-back-btn"
              >
                <span className="brand-module-back-btn-arrow" aria-hidden>
                  &larr;
                </span>
                <span>Back to modules</span>
              </button>

              <div className="brand-module-form-shell">
                <div className="brand-module-form-head">
                  <div className="brand-step-chip">Step 2</div>
                  <div>
                    <h2 className={`text-2xl font-semibold ${headingTextClass}`}>
                      Sign in to {selectedProduct.label}
                    </h2>
                    <p className={`mt-2 text-sm leading-6 ${mutedTextClass}`}>
                      {selectedProduct.summary}
                    </p>
                  </div>
                </div>

                <div className="brand-module-selected-panel">
                  <div className="brand-module-selected-kicker">{selectedProduct.kicker}</div>
                  <div className="brand-module-selected-helper">{selectedProduct.helper}</div>
                </div>

                {error && (
                  <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <form onSubmit={onSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="login-email" className={`mb-1 block text-xs font-medium ${mutedTextClass}`}>
                      Email
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      name="email"
                      autoComplete="email"
                      list={recentEmails.length ? "recent-login-emails" : undefined}
                      placeholder="admin@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="brand-input"
                    />
                    {recentEmails.length > 0 && (
                      <datalist id="recent-login-emails">
                        {recentEmails.map((recent) => (
                          <option key={recent} value={recent} />
                        ))}
                      </datalist>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="login-password"
                      className={`mb-1 block text-xs font-medium ${mutedTextClass}`}
                    >
                      Password
                    </label>
                    <input
                      id="login-password"
                      type="password"
                      name="password"
                      autoComplete="current-password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="brand-input"
                    />
                  </div>

                  <button type="submit" disabled={loading} className="brand-btn-primary w-full py-3 text-sm">
                    {loading ? "Logging in..." : `Open ${selectedProduct.label}`}
                  </button>
                </form>

                <div className={`text-center text-[11px] ${mutedTextClass}`}>
                  Access only works if this software is assigned to the customer and user account.
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
