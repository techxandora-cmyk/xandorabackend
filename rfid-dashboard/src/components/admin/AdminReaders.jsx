import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

const ZONE_OPTIONS = [
  { value: "sales_floor", label: "Sales Floor" },
  { value: "pos", label: "POS" },
  { value: "exit", label: "Exit" },
  { value: "changing_room", label: "Changing Room" },
  { value: "stockroom", label: "Stockroom" },
  { value: "receiving", label: "Receiving" },
];

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      className="ml-2 px-2 py-0.5 text-xs rounded border border-white/15 hover:bg-white/10 transition-colors"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function TokenRow({ label, token, type }) {
  const [visible, setVisible] = useState(false);
  const masked = token ? `${token.slice(0, 8)}${"•".repeat(18)}` : "—";
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${type === "store" ? "bg-blue-500/20 text-blue-300" : "bg-purple-500/20 text-purple-300"}`}>
        {type === "store" ? "st_" : "ct_"}
      </span>
      <span className="text-xs text-white/60 w-32 truncate">{label}</span>
      <span className="font-mono text-xs text-white/80 flex-1">
        {visible ? token : masked}
      </span>
      <button
        onClick={() => setVisible((v) => !v)}
        className="text-xs text-white/40 hover:text-white/70 transition-colors"
      >
        {visible ? "Hide" : "Show"}
      </button>
      {visible && <CopyButton value={token} />}
    </div>
  );
}

export default function AdminReaders() {
  const [tokens, setTokens] = useState([]);
  const [readers, setReaders] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [loadingReaders, setLoadingReaders] = useState(true);
  const [error, setError] = useState(null);

  // Add reader form
  const [form, setForm] = useState({
    company_name: "",
    store_id: "",
    reader_ip: "",
    device_id: "",
    reader_name: "",
    zone_id: "sales_floor",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveOk, setSaveOk] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    try {
      const data = await apiGet("/admin/tokens");
      setTokens(data.tokens || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingTokens(false);
    }
  }, []);

  const loadReaders = useCallback(async () => {
    setLoadingReaders(true);
    try {
      const data = await apiGet("/admin/readers");
      setReaders(data.readers || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingReaders(false);
    }
  }, []);

  useEffect(() => {
    loadTokens();
    loadReaders();
  }, [loadTokens, loadReaders]);

  // Group tokens: company tokens first, then store tokens by company
  const companyTokens = tokens.filter((t) => t.token_type === "company");
  const storeTokens = tokens.filter((t) => t.token_type === "store");

  async function handleAddReader(e) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      await apiPost("/admin/readers", form);
      setSaveOk(true);
      setForm({ company_name: "", store_id: "", reader_ip: "", device_id: "", reader_name: "", zone_id: "sales_floor" });
      loadReaders();
      setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteReader(id) {
    if (!confirm("Remove this reader?")) return;
    try {
      await apiDelete(`/admin/readers/${id}`);
      loadReaders();
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleToggleReader(id, currentActive) {
    try {
      await apiPatch(`/admin/readers/${id}`, { is_active: !currentActive });
      loadReaders();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1">Reader Integration</h2>
        <p className="text-xs text-white/50">
          Tokens are auto-generated for each company and store. Copy the store token (<span className="font-mono text-blue-300">st_</span>) and set it as <span className="font-mono text-white/70">STORE_TOKEN</span> in your bridge <span className="font-mono text-white/70">.env</span>.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* TOKENS */}
      <div className="glass rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-purple-300 uppercase tracking-wide">Scan Tokens</h3>
          {loadingTokens && <span className="text-xs text-white/40">Loading…</span>}
        </div>

        {!loadingTokens && tokens.length === 0 && (
          <p className="text-xs text-white/40">No tokens found. Create stores first.</p>
        )}

        {companyTokens.length > 0 && (
          <div>
            <p className="text-xs text-white/40 mb-2">Company tokens</p>
            {companyTokens.map((t) => (
              <TokenRow key={t.id} label={t.company_name} token={t.token} type="company" />
            ))}
          </div>
        )}

        {storeTokens.length > 0 && (
          <div>
            <p className="text-xs text-white/40 mb-2 mt-4">Store tokens — use these as <span className="font-mono text-blue-300">STORE_TOKEN</span></p>
            {storeTokens.map((t) => (
              <TokenRow key={t.id} label={`${t.company_name} / ${t.store_id}`} token={t.token} type="store" />
            ))}
          </div>
        )}
      </div>

      {/* REGISTER READER */}
      <div className="glass rounded-xl p-5 space-y-4">
        <h3 className="text-xs font-semibold text-purple-300 uppercase tracking-wide">Register Reader</h3>
        <form onSubmit={handleAddReader} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="text-xs text-white/50 block mb-1">Store</label>
            <select
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white"
              value={form.company_name && form.store_id ? `${form.company_name}||${form.store_id}` : ""}
              onChange={(e) => {
                const [company_name, store_id] = e.target.value.split("||");
                setForm((f) => ({ ...f, company_name: company_name || "", store_id: store_id || "" }));
              }}
              required
            >
              <option value="">— select store —</option>
              {storeTokens.map((t) => (
                <option key={t.id} value={`${t.company_name}||${t.store_id}`}>
                  {t.company_name} / {t.store_id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-white/50 block mb-1">Reader IP</label>
            <input
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-white/20"
              placeholder="192.168.100.132"
              value={form.reader_ip}
              onChange={(e) => setForm((f) => ({ ...f, reader_ip: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="text-xs text-white/50 block mb-1">Device ID</label>
            <input
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-white/20"
              placeholder="FX9600_01"
              value={form.device_id}
              onChange={(e) => setForm((f) => ({ ...f, device_id: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="text-xs text-white/50 block mb-1">Reader Name</label>
            <input
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-white/20"
              placeholder="Main Floor Reader"
              value={form.reader_name}
              onChange={(e) => setForm((f) => ({ ...f, reader_name: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs text-white/50 block mb-1">Zone</label>
            <select
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white"
              value={form.zone_id}
              onChange={(e) => setForm((f) => ({ ...f, zone_id: e.target.value }))}
            >
              {ZONE_OPTIONS.map((z) => (
                <option key={z.value} value={z.value}>{z.label}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Add Reader"}
            </button>
            {saveOk && <span className="text-xs text-green-400">Reader added.</span>}
            {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          </div>
        </form>
      </div>

      {/* READERS TABLE */}
      <div className="glass rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-purple-300 uppercase tracking-wide">
            Registered Readers {!loadingReaders && <span className="text-white/40 font-normal">({readers.length})</span>}
          </h3>
          {loadingReaders && <span className="text-xs text-white/40">Loading…</span>}
        </div>

        {!loadingReaders && readers.length === 0 && (
          <p className="text-xs text-white/40">No readers registered yet.</p>
        )}

        {readers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/40 border-b border-white/10">
                  <th className="text-left pb-2 pr-4">Company / Store</th>
                  <th className="text-left pb-2 pr-4">IP</th>
                  <th className="text-left pb-2 pr-4">Device ID</th>
                  <th className="text-left pb-2 pr-4">Name</th>
                  <th className="text-left pb-2 pr-4">Zone</th>
                  <th className="text-left pb-2 pr-4">Last Seen</th>
                  <th className="text-left pb-2">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {readers.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-4 text-white/60">{r.company_name} / {r.store_id}</td>
                    <td className="py-2 pr-4 font-mono text-white/80">{r.reader_ip}</td>
                    <td className="py-2 pr-4 font-mono text-white/60">{r.device_id}</td>
                    <td className="py-2 pr-4 text-white/60">{r.reader_name || "—"}</td>
                    <td className="py-2 pr-4 text-white/60">{r.zone_id}</td>
                    <td className="py-2 pr-4 text-white/40">
                      {r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : "Never"}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${r.is_active ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/40"}`}>
                        {r.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2 flex gap-2 justify-end">
                      <button
                        onClick={() => handleToggleReader(r.id, r.is_active)}
                        className="text-white/40 hover:text-white/70 transition-colors"
                      >
                        {r.is_active ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() => handleDeleteReader(r.id)}
                        className="text-red-400/60 hover:text-red-400 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
