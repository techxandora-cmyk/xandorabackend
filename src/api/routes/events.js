// src/api/routes/events.js
const express = require('express');
const router = express.Router();

const clients = new Set();        // active SSE clients
let totalPushed = 0;

// ---- helpers
function sseHeaders(res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // if you already use cors() globally you can drop the next line:
    'Access-Control-Allow-Origin': '*',
  });
  // flush headers
  res.flushHeaders?.();
}

function send(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(eventObj) {
  totalPushed += 1;
  for (const c of clients) {
    try {
      send(c, 'scan', eventObj);
    } catch (_) { /* ignore */ }
  }
}

// ---- GET /api/v1/events/stream (SSE)
router.get('/stream', (req, res) => {
  sseHeaders(res);
  clients.add(res);

  // hello event for client-side ready state
  send(res, 'hello', { ok: true, now: Date.now(), clients: clients.size });

  // keep-alive ping (prevents proxies from closing)
  const keep = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(keep);
    clients.delete(res);
    try { res.end(); } catch (_) {}
  });
});

// ---- POST /api/v1/events/simulate (push one event from scripts)
router.post('/simulate', express.json(), (req, res) => {
  const { tag = `EPC-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
          device_id = 'HANDHELD-01',
          location = 'ZONE-A',
          type = 'read' } = req.body || {};

  const event = {
    id: `${Date.now()}-${Math.floor(Math.random()*1000)}`,
    t: new Date().toISOString(),
    tag, device_id, location, type
  };
  broadcast(event);
  res.json({ ok: true, pushed: 1, event });
});

// ---- GET /api/v1/events/health
router.get('/health', (_req, res) => {
  res.json({ ok: true, clients: clients.size, totalPushed });
});

// Optional autosim (env flag): SIMULATE_SCANS=1
if (process.env.SIMULATE_SCANS === '1') {
  const pools = ['ENTRY', 'SHELF-1', 'SHELF-2', 'BACKROOM', 'CASHIER', 'EXIT'];
  setInterval(() => {
    const event = {
      id: `${Date.now()}-${Math.floor(Math.random()*1000)}`,
      t: new Date().toISOString(),
      tag: `EPC-${(Math.random()*1e8|0).toString(16).toUpperCase()}`,
      device_id: Math.random() > 0.5 ? 'HANDHELD-01' : 'GATE-01',
      location: pools[(Math.random()*pools.length)|0],
      type: Math.random() > 0.9 ? 'exit' : 'read'
    };
    broadcast(event);
  }, 2500);
}

module.exports = router;
