// src/components/Transactions.jsx
import React, { useEffect, useState } from 'react';
import API_BASE from "@/config/api";


export default function Transactions({ query = '' }) {
  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null);

  async function load(q = '') {
    try {
      const r = await fetch(`${API_BASE}/pos/transactions${q}`);
      const json = await r.json();
      // json might be { rows: [...] } or array — adjust if needed
      setRows(Array.isArray(json) ? json : (json.rows || []));
    } catch (e) {
      console.error('transactions load', e);
      setRows([]);
    }
  }

  async function openDetail(id) {
    try {
      const r = await fetch(`${API_BASE}/pos/transactions/${id}`);
      const j = await r.json();
      setDetail(j);
    } catch (e) {
      console.error('openDetail error', e);
    }
  }

  useEffect(() => {
    load(query);
  }, [query]);

  return (
    <div>
      <h3>Transactions</h3>
      <table>
        <thead><tr><th>ID</th><th>Total</th></tr></thead>
        <tbody>
          {rows.map(r => <tr key={r.id}><td><a onClick={() => openDetail(r.id)}>{r.id}</a></td><td>{r.total || r.total_amount}</td></tr>)}
        </tbody>
      </table>
      {detail && <pre>{JSON.stringify(detail, null, 2)}</pre>}
    </div>
  );
}
