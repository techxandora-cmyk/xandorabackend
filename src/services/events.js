// Lightweight app-wide event bus + optional SSE helper.
// Nothing external required.

const { EventEmitter } = require("events");
const bus = new EventEmitter();

// Optional, keep listeners sane
bus.setMaxListeners(100);

/** Publish an event anywhere in the app */
function publish(event, payload) {
  try {
    bus.emit(event, payload);
  } catch (e) {
    // Never let event errors kill the request
    console.error("[events] publish error", event, e.message);
  }
}

/** Subscribe to an event (returns unsubscribe fn) */
function subscribe(event, handler) {
  bus.on(event, handler);
  return () => bus.off(event, handler);
}

/**
 * Very small SSE endpoint handler (optional).
 * Use: app.get("/api/v1/events/stream", sse);
 */
function sse(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Forward a couple of useful events
  const onPosConfirmed = (data) => send("pos_confirmed", data);
  const onScansBatch = (data) => send("scans_batch", data);

  bus.on("pos.confirmed", onPosConfirmed);
  bus.on("scans.batch", onScansBatch);

  // initial hello
  send("hello", { ok: true });

  req.on("close", () => {
    bus.off("pos.confirmed", onPosConfirmed);
    bus.off("scans.batch", onScansBatch);
    res.end();
  });
}

module.exports = {
  bus,
  publish,
  subscribe,
  sse,
};
