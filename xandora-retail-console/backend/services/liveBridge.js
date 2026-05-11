const http = require("http");
const https = require("https");

const RECONNECT_DELAY_MS = 5000;
const RECONNECT_DELAY_MAX_MS = 60000;

class LiveBridge {
  constructor({ mainApiUrl, dataStore, zoneTracker, broadcast }) {
    this.mainApiUrl = String(mainApiUrl || "").replace(/\/$/, "");
    this.dataStore = dataStore;
    this.zoneTracker = zoneTracker;
    this.broadcast = broadcast;
    this.connected = false;
    this.lastScanAt = null;
    this.totalScans = 0;
    this._req = null;
    this._reconnectTimer = null;
    this._reconnectDelay = RECONNECT_DELAY_MS;
    this._stopped = false;
  }

  start() {
    this._stopped = false;
    this._connect();
  }

  stop() {
    this._stopped = true;
    this._clearReconnect();
    if (this._req) {
      this._req.destroy();
      this._req = null;
    }
    this.connected = false;
  }

  status() {
    return {
      configured: Boolean(this.mainApiUrl),
      connected: this.connected,
      totalScans: this.totalScans,
      lastScanAt: this.lastScanAt,
      mainApiUrl: this.mainApiUrl || null,
    };
  }

  _connect() {
    if (this._stopped || !this.mainApiUrl) return;

    let url;
    try {
      url = new URL("/api/v1/events/stream", this.mainApiUrl);
    } catch (_err) {
      console.error("[liveBridge] Invalid MAIN_API_URL:", this.mainApiUrl);
      return;
    }

    const lib = url.protocol === "https:" ? https : http;

    const req = lib.get(
      url.toString(),
      { headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          this._scheduleReconnect();
          return;
        }

        this.connected = true;
        this._reconnectDelay = RECONNECT_DELAY_MS;
        this.broadcast({ type: "bridge.connected", at: Date.now() });
        console.log("[liveBridge] Connected to", url.toString());

        let buffer = "";

        res.setEncoding("utf8");

        res.on("data", (chunk) => {
          buffer += chunk;
          const parts = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n\n");
          buffer = parts.pop();

          for (const block of parts) {
            let eventName = null;
            let dataStr = null;

            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataStr = (dataStr === null ? "" : dataStr) + line.slice(5).trim();
              }
            }

            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);
              this._handleEvent(eventName || "message", data);
            } catch (_) {}
          }
        });

        res.on("end", () => {
          this.connected = false;
          console.log("[liveBridge] Stream ended, reconnecting...");
          this.broadcast({ type: "bridge.disconnected", at: Date.now() });
          this._scheduleReconnect();
        });

        res.on("error", (err) => {
          this.connected = false;
          console.error("[liveBridge] Stream error:", err.message);
          this._scheduleReconnect();
        });
      }
    );

    req.on("error", (err) => {
      this.connected = false;
      console.error("[liveBridge] Connection error:", err.message);
      this._scheduleReconnect();
    });

    req.setTimeout(0);
    this._req = req;
  }

  _scheduleReconnect() {
    if (this._stopped) return;
    this._clearReconnect();
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, RECONNECT_DELAY_MAX_MS);
      this._connect();
    }, this._reconnectDelay);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _handleEvent(eventName, data) {
    if (eventName === "dwell_heartbeat") {
      const epc = String(data.epc || "").trim().toUpperCase();
      if (!epc) return;
      const resolved = this.dataStore.resolveByEpc(epc);
      if (resolved) this.zoneTracker.touch(resolved, Date.now());
      return;
    }

    if (eventName !== "scan") return;

    const epc = String(data.tag || "").trim().toUpperCase();
    if (!epc) return;

    this.lastScanAt = Date.now();
    this.totalScans += 1;

    const resolved = this.dataStore.resolveOrAssignByEpc(epc, { persist: true });
    if (!resolved?.item) return;

    this.zoneTracker.touch(resolved.item, Date.now());

    this.broadcast({
      type: "live.scan",
      epc,
      sku: resolved.item.sku,
      name: resolved.item.name,
      device_id: data.device_id || "RFID_READER",
      store_id: data.store_id || "",
      autoAssigned: resolved.autoAssigned,
      at: Date.now(),
    });
  }
}

module.exports = { LiveBridge };
