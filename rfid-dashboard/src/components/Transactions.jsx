import { useEffect, useState, useCallback } from 'react';
import { getJSON } from '../lib/api';

export default function Transactions() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    setRows(await getJSON(`/api/v1/pos/transactions${q}`));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => setDetail(await getJSON(`/api/v1/pos/transactions/${id}`));

  return (
    <div className="p-3 grid gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold">Transactions</h2>
        <select className="bg-black/30 border rounded-lg px-2 py-1" value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">All</option>
          <option>RESERVED</option>
          <option>CONFIRMED</option>
          <option>REFUNDED</option>
        </select>
        <button className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20" onClick={load}>Refresh</button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr>
              <th className="text-left p-2">Txn</th>
              <th className="text-left p-2">Store</th>
              <th className="text-left p-2">User</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Total</th>
              <th className="text-left p-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r=>(
              <tr key={r.pos_txn_id} className="border-t border-white/10 hover:bg-white/5 cursor-pointer" onClick={()=>openDetail(r.pos_txn_id)}>
                <td className="p-2 font-mono">{r.pos_txn_id}</td>
                <td className="p-2">{r.store_id}</td>
                <td className="p-2">{r.user_id}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">{r.total_amount?.toFixed?.(2) ?? r.total_amount}</td>
                <td className="p-2">{new Date(r.updated_at).toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-3 opacity-60" colSpan={6}>No transactions.</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="rounded-xl border p-3 bg-neutral-900/40">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Transaction {detail.pos_txn_id}</h3>
            <button className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20" onClick={()=>setDetail(null)}>Close</button>
          </div>
          <div className="grid md:grid-cols-3 gap-3 mt-2 text-sm">
            <div><div className="opacity-60">Store</div>{detail.store_id}</div>
            <div><div className="opacity-60">User</div>{detail.user_id}</div>
            <div><div className="opacity-60">Status</div>{detail.status}</div>
            <div><div className="opacity-60">Total</div>{detail.total_amount}</div>
            <div><div className="opacity-60">Updated</div>{new Date(detail.updated_at).toLocaleString()}</div>
          </div>
          <div className="mt-3">
            <div className="opacity-60 text-sm mb-1">Items</div>
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5"><tr><th className="text-left p-2">EPC</th><th className="text-left p-2">Price</th></tr></thead>
                <tbody>
                  {(detail.items||[]).map((i,idx)=>(
                    <tr key={idx} className="border-t border-white/10">
                      <td className="p-2 font-mono">{i.epc}</td>
                      <td className="p-2">{i.price ?? '—'}</td>
                    </tr>
                  ))}
                  {(detail.items||[]).length===0 && <tr><td className="p-2 opacity-60" colSpan={2}>No items.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
