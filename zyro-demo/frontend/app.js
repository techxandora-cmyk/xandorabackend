(function () {
  const $ = (id) => document.getElementById(id);

  const state = {
    cart: { items: [], count: 0, total: 0, currency: "LKR" },
    inZone: [],
    inventory: [],
    stocktake: { items: [], summary: { uniqueEpcs: 0, totalScanEvents: 0 } },
    simulatorRunning: false,
    logLines: [],
    events: null,
    liveRefreshTimer: null,
  };

  const refs = {
    apiStatus: $("api-status"),
    simStatus: $("sim-status"),
    simToggleBtn: $("sim-toggle-btn"),
    tabPos: $("tab-pos"),
    tabInventory: $("tab-inventory"),
    posView: $("pos-view"),
    inventoryView: $("inventory-view"),
    inZoneBody: $("in-zone-body"),
    cartBody: $("cart-body"),
    inventoryBody: $("inventory-body"),
    metricCartCount: $("metric-cart-count"),
    metricCartTotal: $("metric-cart-total"),
    metricStocktakeUnique: $("metric-stocktake-unique"),
    metricStocktakeTotal: $("metric-stocktake-total"),
    manualEpc: $("manual-epc"),
    manualScanBtn: $("manual-scan-btn"),
    manualStocktakeBtn: $("manual-stocktake-btn"),
    refreshBtn: $("refresh-btn"),
    clearCartBtn: $("clear-cart-btn"),
    clearStocktakeBtn: $("clear-stocktake-btn"),
    closeDemoBtn: $("close-demo-btn"),
    stocktakeBody: $("stocktake-body"),
    eventLog: $("event-log"),
  };

  function formatMoney(amount, currency = "LKR") {
    try {
      return new Intl.NumberFormat("en-LK", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      }).format(Number(amount || 0));
    } catch (_err) {
      return `${currency} ${Number(amount || 0).toFixed(2)}`;
    }
  }

  function formatAge(ageSec) {
    return `${Number(ageSec || 0).toFixed(1)}s ago`;
  }

  function setApiOnline(isOnline) {
    refs.apiStatus.textContent = isOnline ? "API Online" : "API Offline";
    refs.apiStatus.className = `pill ${isOnline ? "ok" : "danger"}`;
  }

  function setSimulatorBadge(isRunning) {
    state.simulatorRunning = !!isRunning;
    refs.simStatus.textContent = isRunning ? "Simulator Running" : "Simulator Stopped";
    refs.simStatus.className = `pill ${isRunning ? "ok" : "muted"}`;
    refs.simToggleBtn.textContent = isRunning ? "Stop Sim" : "Start Sim";
  }

  function pushLog(message) {
    const ts = new Date().toLocaleTimeString();
    state.logLines.unshift(`[${ts}] ${message}`);
    state.logLines = state.logLines.slice(0, 40);
    refs.eventLog.textContent = state.logLines.join("\n");
  }

  async function apiGet(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text || res.statusText}`);
    }
    return res.json();
  }

  async function apiPost(path, body = {}) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text || res.statusText}`);
    }
    return res.json();
  }

  function renderInZone() {
    if (!state.inZone.length) {
      refs.inZoneBody.innerHTML = `<tr><td colspan="6" class="empty-row">No items in zone</td></tr>`;
      return;
    }

    refs.inZoneBody.innerHTML = state.inZone
      .map(
        (item) => `
      <tr>
        <td>${item.epc}</td>
        <td>${item.name}</td>
        <td>${item.category}</td>
        <td>${formatMoney(item.price, item.currency)}</td>
        <td>${formatAge(item.ageSec)}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-small action-add" data-epc="${item.epc}" type="button">Add</button>
            <button class="btn btn-small btn-outline action-remove-live" data-epc="${item.epc}" type="button">Remove</button>
          </div>
        </td>
      </tr>`
      )
      .join("");
  }

  function renderCart() {
    refs.metricCartCount.textContent = String(state.cart.count || 0);
    refs.metricCartTotal.textContent = formatMoney(state.cart.total, state.cart.currency || "LKR");

    if (!state.cart.items.length) {
      refs.cartBody.innerHTML = `<tr><td colspan="5" class="empty-row">Cart is empty</td></tr>`;
      return;
    }

    refs.cartBody.innerHTML = state.cart.items
      .map(
        (item) => `
      <tr>
        <td>${item.epc}</td>
        <td>${item.name}</td>
        <td>${item.category}</td>
        <td>${formatMoney(item.price, item.currency)}</td>
        <td>
          <button class="btn btn-small btn-outline action-remove-cart" data-epc="${item.epc}" type="button">Remove</button>
        </td>
      </tr>`
      )
      .join("");
  }

  function renderInventory() {
    if (!state.inventory.length) {
      refs.inventoryBody.innerHTML = `<tr><td colspan="8" class="empty-row">No products loaded</td></tr>`;
      return;
    }

    refs.inventoryBody.innerHTML = state.inventory
      .map(
        (row) => `
      <tr>
        <td>${row.sku}</td>
        <td>${row.name}</td>
        <td>${row.category}</td>
        <td>${formatMoney(row.unitPrice, row.currency)}</td>
        <td>${row.stock}</td>
        <td>${row.inZone}</td>
        <td>${row.stocktakeScanned || 0}</td>
        <td>${row.available}</td>
      </tr>`
      )
      .join("");
  }

  function renderStocktake() {
    const summary = state.stocktake.summary || {};
    refs.metricStocktakeUnique.textContent = String(summary.uniqueEpcs || 0);
    refs.metricStocktakeTotal.textContent = String(summary.totalScanEvents || 0);

    const rows = state.stocktake.items || [];
    if (!rows.length) {
      refs.stocktakeBody.innerHTML = `<tr><td colspan="7" class="empty-row">No handheld stocktake scans yet</td></tr>`;
      return;
    }

    refs.stocktakeBody.innerHTML = rows
      .map(
        (row) => `
      <tr>
        <td>${new Date(row.at_iso || row.at || Date.now()).toLocaleTimeString()}</td>
        <td>${row.epc}</td>
        <td>${row.name}</td>
        <td>${row.category}</td>
        <td>${row.device_id || "-"}</td>
        <td>${row.store_id || "-"}</td>
        <td>${row.scans || 0}</td>
      </tr>`
      )
      .join("");
  }

  async function refreshHealthAndStatus() {
    try {
      const [health, status] = await Promise.all([apiGet("/api/health"), apiGet("/api/demo/status")]);
      setApiOnline(Boolean(health.ok));
      setSimulatorBadge(Boolean(status.simulatorRunning));
    } catch (_err) {
      setApiOnline(false);
      setSimulatorBadge(false);
    }
  }

  async function refreshInZone() {
    const data = await apiGet("/api/live/in-zone");
    state.inZone = data.items || [];
    renderInZone();
  }

  async function refreshCart() {
    state.cart = await apiGet("/api/pos/cart");
    renderCart();
  }

  async function refreshInventory() {
    const data = await apiGet("/api/inventory/summary");
    state.inventory = data.items || [];
    renderInventory();
  }

  async function refreshStocktake() {
    const data = await apiGet("/api/inventory/stocktake/recent?limit=80");
    state.stocktake = {
      items: data.items || [],
      summary: data.summary || { uniqueEpcs: 0, totalScanEvents: 0 },
    };
    renderStocktake();
  }

  async function refreshAll() {
    try {
      await Promise.all([
        refreshHealthAndStatus(),
        refreshInZone(),
        refreshCart(),
        refreshInventory(),
        refreshStocktake(),
      ]);
    } catch (err) {
      pushLog(`Refresh failed: ${err.message}`);
      setApiOnline(false);
    }
  }

  function scheduleLiveRefresh() {
    if (state.liveRefreshTimer) return;
    state.liveRefreshTimer = setTimeout(() => {
      state.liveRefreshTimer = null;
      refreshInZone().catch(() => {});
      refreshInventory().catch(() => {});
      refreshStocktake().catch(() => {});
    }, 180);
  }

  function connectEvents() {
    if (state.events) {
      state.events.close();
    }
    state.events = new EventSource("/api/live/events");
    state.events.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        const type = data.type || "event";
        pushLog(type);
        if (type === "demo.simulator.started") setSimulatorBadge(true);
        if (type === "demo.simulator.stopped") setSimulatorBadge(false);
        if (type.startsWith("live.") || type.startsWith("inventory.")) {
          scheduleLiveRefresh();
        }
      } catch (_err) {
        pushLog("Invalid event payload");
      }
    };
    state.events.onerror = () => {
      pushLog("Live stream disconnected, retrying...");
      setApiOnline(false);
    };
  }

  async function toggleSimulator() {
    try {
      if (state.simulatorRunning) {
        await apiPost("/api/demo/simulator/stop");
        setSimulatorBadge(false);
      } else {
        await apiPost("/api/demo/simulator/start");
        setSimulatorBadge(true);
      }
      await refreshInZone();
      await refreshInventory();
      await refreshStocktake();
    } catch (err) {
      pushLog(`Simulator error: ${err.message}`);
    }
  }

  function activateTab(tabName) {
    const isPos = tabName === "pos";
    refs.tabPos.classList.toggle("active", isPos);
    refs.tabInventory.classList.toggle("active", !isPos);
    refs.posView.classList.toggle("active", isPos);
    refs.inventoryView.classList.toggle("active", !isPos);
  }

  function bindUi() {
    refs.tabPos.addEventListener("click", () => activateTab("pos"));
    refs.tabInventory.addEventListener("click", () => activateTab("inventory"));
    refs.refreshBtn.addEventListener("click", () => refreshAll());
    refs.clearCartBtn.addEventListener("click", async () => {
      try {
        state.cart = await apiPost("/api/pos/cart/clear");
        renderCart();
        pushLog("Cart cleared");
      } catch (err) {
        pushLog(`Cart clear failed: ${err.message}`);
      }
    });
    refs.clearStocktakeBtn.addEventListener("click", async () => {
      try {
        await apiPost("/api/inventory/stocktake/clear");
        pushLog("Stocktake list cleared");
        await refreshStocktake();
        await refreshInventory();
      } catch (err) {
        pushLog(`Stocktake clear failed: ${err.message}`);
      }
    });
    refs.simToggleBtn.addEventListener("click", toggleSimulator);
    refs.closeDemoBtn.addEventListener("click", async () => {
      const confirmed = window.confirm("Close Xandora Demo now?");
      if (!confirmed) return;
      try {
        await apiPost("/api/demo/shutdown");
      } catch (_err) {
        // If shutdown succeeds, request may be interrupted by server stop.
      }
      pushLog("Demo shutdown requested.");
      setTimeout(() => {
        window.close();
      }, 250);
    });

    refs.manualScanBtn.addEventListener("click", async () => {
      const epc = refs.manualEpc.value.trim();
      if (!epc) return;
      try {
        await apiPost("/api/live/scan", { epc });
        refs.manualEpc.value = "";
        pushLog(`Manual scan injected: ${epc}`);
        await refreshInZone();
        await refreshInventory();
      } catch (err) {
        pushLog(`Manual scan failed: ${err.message}`);
      }
    });
    refs.manualStocktakeBtn.addEventListener("click", async () => {
      const epc = refs.manualEpc.value.trim();
      if (!epc) return;
      try {
        await apiPost("/api/inventory/stocktake/scan", { epc });
        refs.manualEpc.value = "";
        pushLog(`Handheld stocktake scan: ${epc}`);
        await refreshStocktake();
        await refreshInventory();
      } catch (err) {
        pushLog(`Stocktake inject failed: ${err.message}`);
      }
    });

    refs.inZoneBody.addEventListener("click", async (evt) => {
      const addBtn = evt.target.closest(".action-add");
      if (addBtn) {
        const epc = addBtn.getAttribute("data-epc");
        try {
          state.cart = await apiPost("/api/pos/cart/add", { epc });
          renderCart();
          pushLog(`Added to cart: ${epc}`);
        } catch (err) {
          pushLog(`Add to cart failed: ${err.message}`);
        }
        return;
      }

      const removeBtn = evt.target.closest(".action-remove-live");
      if (removeBtn) {
        const epc = removeBtn.getAttribute("data-epc");
        try {
          await apiPost("/api/live/remove", { epc });
          pushLog(`Removed from zone: ${epc}`);
          await refreshInZone();
          await refreshInventory();
        } catch (err) {
          pushLog(`Zone remove failed: ${err.message}`);
        }
      }
    });

    refs.cartBody.addEventListener("click", async (evt) => {
      const removeBtn = evt.target.closest(".action-remove-cart");
      if (!removeBtn) return;
      const epc = removeBtn.getAttribute("data-epc");
      try {
        state.cart = await apiPost("/api/pos/cart/remove", { epc });
        renderCart();
        pushLog(`Removed from cart: ${epc}`);
      } catch (err) {
        pushLog(`Cart remove failed: ${err.message}`);
      }
    });
  }

  async function init() {
    bindUi();
    activateTab("pos");
    connectEvents();
    await refreshAll();
  }

  init().catch((err) => {
    pushLog(`Init failed: ${err.message}`);
    setApiOnline(false);
  });
})();
