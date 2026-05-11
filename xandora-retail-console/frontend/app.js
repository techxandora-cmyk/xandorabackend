(function () {
  const $ = (id) => document.getElementById(id);
  const SESSION_STORAGE_KEY = "xandora_retail_console_session";
  const REMEMBERED_EMAIL_KEY = "xandora_retail_console_email";

  const state = {
    activeView: "billing",
    runtimeMode: "demo",
    sessionId: localStorage.getItem(SESSION_STORAGE_KEY) || "",
    rememberedEmail: localStorage.getItem(REMEMBERED_EMAIL_KEY) || "",
    session: null,
    pendingStores: [],
    authMode: "login",
    cart: { items: [], count: 0, total: 0, currency: "LKR" },
    inZone: [],
    inventory: [],
    stocktake: { items: [], summary: { uniqueEpcs: 0, totalScanEvents: 0 } },
    laundry: { items: [], summary: { uniqueEpcs: 0, totalScanEvents: 0 } },
    assignments: [],
    recentEpcs: [],
    simulatorRunning: false,
    bridgeConnected: false,
    logLines: [],
    events: null,
    liveRefreshTimer: null,
  };

  const refs = {
    apiStatus: $("api-status"),
    sessionUser: $("session-user"),
    sessionStore: $("session-store"),
    switchStoreBtn: $("switch-store-btn"),
    logoutBtn: $("logout-btn"),
    bridgeStatus: $("bridge-status"),
    simStatus: $("sim-status"),
    simToggleBtn: $("sim-toggle-btn"),
    tabs: {
      billing: $("tab-billing"),
      inventory: $("tab-inventory"),
      laundry: $("tab-laundry"),
      assign: $("tab-assign"),
    },
    views: {
      billing: $("billing-view"),
      inventory: $("inventory-view"),
      laundry: $("laundry-view"),
      assign: $("assign-view"),
    },
    inZoneBody: $("in-zone-body"),
    cartBody: $("cart-body"),
    inventoryBody: $("inventory-body"),
    stocktakeBody: $("stocktake-body"),
    laundryBody: $("laundry-body"),
    assignmentsBody: $("assignments-body"),
    recentAssignedList: $("recent-assigned-list"),
    recentEpcsBody: $("recent-epcs-body"),
    metricCartCount: $("metric-cart-count"),
    metricCartTotal: $("metric-cart-total"),
    metricStocktakeUnique: $("metric-stocktake-unique"),
    metricStocktakeTotal: $("metric-stocktake-total"),
    metricLaundryUnique: $("metric-laundry-unique"),
    metricLaundryTotal: $("metric-laundry-total"),
    manualEpc: $("manual-epc"),
    manualScanBtn: $("manual-scan-btn"),
    manualStocktakeBtn: $("manual-stocktake-btn"),
    manualLaundryBtn: $("manual-laundry-btn"),
    laundryStatus: $("laundry-status"),
    laundryFilter: $("laundry-filter"),
    refreshBtn: $("refresh-btn"),
    checkoutBtn: $("checkout-btn"),
    clearCartBtn: $("clear-cart-btn"),
    clearStocktakeBtn: $("clear-stocktake-btn"),
    clearLaundryBtn: $("clear-laundry-btn"),
    closeDemoBtn: $("close-demo-btn"),
    assignmentRefreshBtn: $("assignment-refresh-btn"),
    recentEpcsRefreshBtn: $("recent-epcs-refresh-btn"),
    assignmentForm: $("assignment-form"),
    assignEpc: $("assign-epc"),
    assignSku: $("assign-sku"),
    assignName: $("assign-name"),
    assignCategory: $("assign-category"),
    assignBin: $("assign-bin"),
    assignSize: $("assign-size"),
    assignColor: $("assign-color"),
    assignPrice: $("assign-price"),
    assignStock: $("assign-stock"),
    assignLaundryStatus: $("assign-laundry-status"),
    assignNotes: $("assign-notes"),
    checkoutModal: $("checkout-modal"),
    checkoutModalClose: $("checkout-modal-close"),
    checkoutModalDone: $("checkout-modal-done"),
    checkoutModalCount: $("checkout-modal-count"),
    checkoutModalTotal: $("checkout-modal-total"),
    eventLog: $("event-log"),
    authModal: $("auth-modal"),
    authMessage: $("auth-message"),
    authForm: $("auth-form"),
    authEmail: $("auth-email"),
    authPassword: $("auth-password"),
    authStoreWrap: $("auth-store-wrap"),
    authStore: $("auth-store"),
    authSubmit: $("auth-submit"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

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

  function setBridgeBadge(isConnected) {
    state.bridgeConnected = !!isConnected;
    refs.bridgeStatus.hidden = false;
    refs.bridgeStatus.textContent = isConnected ? "Live Reader" : "Reader Offline";
    refs.bridgeStatus.className = `pill ${isConnected ? "ok" : "danger"}`;
  }

  function setSimulatorBadge(isRunning) {
    state.simulatorRunning = !!isRunning;
    if (state.runtimeMode === "real") {
      refs.simStatus.textContent = "Live Data Mode";
      refs.simStatus.className = "pill ok";
      refs.simToggleBtn.hidden = true;
      return;
    }

    refs.simStatus.textContent = isRunning ? "Demo Feed Running" : "Demo Feed Stopped";
    refs.simStatus.className = `pill ${isRunning ? "ok" : "muted"}`;
    refs.simToggleBtn.hidden = false;
    refs.simToggleBtn.textContent = isRunning ? "Stop Demo Feed" : "Start Demo Feed";
  }

  function pushLog(message) {
    const ts = new Date().toLocaleTimeString();
    state.logLines.unshift(`[${ts}] ${message}`);
    state.logLines = state.logLines.slice(0, 44);
    refs.eventLog.textContent = state.logLines.join("\n");
  }

  function setStoredSessionId(sessionId) {
    state.sessionId = String(sessionId || "").trim();
    if (state.sessionId) {
      localStorage.setItem(SESSION_STORAGE_KEY, state.sessionId);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  function clearSessionState() {
    setStoredSessionId("");
    state.session = null;
    state.pendingStores = [];
    state.authMode = "login";
    if (state.events) {
      state.events.close();
      state.events = null;
    }
    refs.sessionUser.hidden = true;
    refs.sessionStore.hidden = true;
    refs.switchStoreBtn.hidden = true;
    refs.logoutBtn.hidden = true;
  }

  function updateSessionChrome() {
    const summary = state.session;
    if (!summary?.authenticated) {
      refs.sessionUser.hidden = true;
      refs.sessionStore.hidden = true;
      refs.switchStoreBtn.hidden = true;
      refs.logoutBtn.hidden = true;
      return;
    }

    refs.sessionUser.hidden = false;
    refs.sessionUser.textContent = summary.user?.email || "Signed in";
    refs.sessionStore.hidden = false;
    refs.sessionStore.textContent = summary.selected_store_id || "Select store";
    refs.switchStoreBtn.hidden = !Array.isArray(summary.stores) || summary.stores.length < 2;
    refs.logoutBtn.hidden = false;
  }

  function applyProductVisibility() {
    const products = Array.isArray(state.session?.products) ? state.session.products : [];
    const hasLaundry = products.includes("laundry");
    const hasStockAudit = products.includes("stock_audit");

    refs.tabs.laundry.hidden = !hasLaundry;
    refs.manualLaundryBtn.hidden = !hasLaundry;
    refs.clearLaundryBtn.hidden = !hasLaundry;
    if (!hasLaundry && state.activeView === "laundry") {
      activateTab("billing");
    }

    refs.manualStocktakeBtn.disabled = !hasStockAudit;
    refs.clearStocktakeBtn.disabled = !hasStockAudit;
  }

  function setRememberedEmail(email) {
    state.rememberedEmail = String(email || "").trim();
    if (state.rememberedEmail) {
      localStorage.setItem(REMEMBERED_EMAIL_KEY, state.rememberedEmail);
    } else {
      localStorage.removeItem(REMEMBERED_EMAIL_KEY);
    }
  }

  function showAuthModal(message, stores = [], mode = "login") {
    refs.authMessage.textContent =
      message || "Sign in with your Xandora account to open your customer store.";
    state.authMode = mode;
    state.pendingStores = Array.isArray(stores) ? stores : [];
    refs.authStoreWrap.hidden = !state.pendingStores.length;
    refs.authStore.innerHTML = state.pendingStores
      .map((storeId) => `<option value="${escapeHtml(storeId)}">${escapeHtml(storeId)}</option>`)
      .join("");
    refs.authEmail.value = state.rememberedEmail || refs.authEmail.value || "";
    refs.authPassword.value = "";
    refs.authPassword.disabled = Boolean(state.pendingStores.length);
    refs.authEmail.disabled = Boolean(state.pendingStores.length);
    refs.authSubmit.textContent = state.pendingStores.length
      ? mode === "switch-store"
        ? "Switch Store"
        : "Open Store"
      : "Sign in";
    refs.authModal.hidden = false;
  }

  function hideAuthModal() {
    refs.authModal.hidden = true;
    refs.authPassword.disabled = false;
    refs.authEmail.disabled = false;
    refs.authStoreWrap.hidden = true;
    refs.authStore.innerHTML = "";
    refs.authSubmit.textContent = "Sign in";
    state.authMode = "login";
  }

  async function selectStore(storeId) {
    const session = await apiPost("/api/session/select-store", {
      store_id: String(storeId || "").trim(),
    });
    state.session = session;
    hideAuthModal();
    updateSessionChrome();
    applyProductVisibility();
    connectEvents();
    await refreshAll();
  }

  async function apiRequest(method, path, body) {
    const headers = {};
    if (state.sessionId) {
      headers["x-retail-session"] = state.sessionId;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const payload = await res.json().catch(async () => {
        const text = await res.text().catch(() => "");
        return { error: text || res.statusText };
      });
      if (res.status === 401) {
        clearSessionState();
        showAuthModal("Sign in again to continue.");
      }
      const error = new Error(payload?.error || `${res.status} ${res.statusText}`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  const apiGet = (path) => apiRequest("GET", path);
  const apiPost = (path, body = {}) => apiRequest("POST", path, body);

  function getManualEpc() {
    return refs.manualEpc.value.trim().toUpperCase();
  }

  function renderInZone() {
    if (!state.inZone.length) {
      refs.inZoneBody.innerHTML = `<tr><td colspan="7" class="empty-row">No items in bin</td></tr>`;
      return;
    }

    refs.inZoneBody.innerHTML = state.inZone
      .map(
        (item) => `
      <tr>
        <td class="mono">${escapeHtml(item.epc)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(item.bin || "-")}</td>
        <td>${formatMoney(item.price, item.currency)}</td>
        <td>${formatAge(item.ageSec)}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-small action-add" data-epc="${escapeHtml(item.epc)}" type="button">Add to Bill</button>
            <button class="btn btn-small btn-outline action-remove-live" data-epc="${escapeHtml(item.epc)}" type="button">Remove</button>
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
      refs.cartBody.innerHTML = `<tr><td colspan="6" class="empty-row">Cart is empty</td></tr>`;
      return;
    }

    refs.cartBody.innerHTML = state.cart.items
      .map(
        (item) => `
      <tr>
        <td class="mono">${escapeHtml(item.epc)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(item.bin || "-")}</td>
        <td>${formatMoney(item.price, item.currency)}</td>
        <td>
          <button class="btn btn-small btn-outline action-remove-cart" data-epc="${escapeHtml(item.epc)}" type="button">Remove</button>
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
        <td class="mono">${escapeHtml(row.sku)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.category)}</td>
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
      refs.stocktakeBody.innerHTML = `<tr><td colspan="7" class="empty-row">No inventory intake scans yet</td></tr>`;
      return;
    }

    refs.stocktakeBody.innerHTML = rows
      .map(
        (row) => `
      <tr>
        <td>${new Date(row.at_iso || row.at || Date.now()).toLocaleTimeString()}</td>
        <td class="mono">${escapeHtml(row.epc)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.bin || "-")}</td>
        <td>${escapeHtml(row.device_id || "-")}</td>
        <td>${row.scans || 0}</td>
      </tr>`
      )
      .join("");
  }

  function renderLaundry() {
    const summary = state.laundry.summary || {};
    refs.metricLaundryUnique.textContent = String(summary.uniqueEpcs || 0);
    refs.metricLaundryTotal.textContent = String(summary.totalScanEvents || 0);

    const selectedFilter = String(refs.laundryFilter?.value || "All");
    const rows = (state.laundry.items || []).filter((row) => {
      if (selectedFilter === "All") return true;
      return String(row.status || "") === selectedFilter;
    });
    if (!rows.length) {
      refs.laundryBody.innerHTML = `<tr><td colspan="6" class="empty-row">No laundry scans match this view</td></tr>`;
      return;
    }

    refs.laundryBody.innerHTML = rows
      .map(
        (row) => `
      <tr class="laundry-row" data-epc="${escapeHtml(row.epc)}" data-status="${escapeHtml(row.status || "Received")}">
        <td>${new Date(row.last_seen_iso || Date.now()).toLocaleTimeString()}</td>
        <td class="mono">${escapeHtml(row.epc)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.bin || "-")}</td>
        <td><span class="status-chip">${escapeHtml(row.status || "Received")}</span></td>
        <td>${row.scans || 0}</td>
      </tr>`
      )
      .join("");
  }

  function renderAssignments() {
    if (!state.assignments.length) {
      refs.assignmentsBody.innerHTML = `<tr><td colspan="7" class="empty-row">No assigned tags yet</td></tr>`;
      return;
    }

    refs.assignmentsBody.innerHTML = state.assignments
      .map(
        (item) => `
      <tr class="assignment-row" data-epc="${escapeHtml(item.epc)}">
        <td class="mono">${escapeHtml(item.epc)}</td>
        <td class="mono">${escapeHtml(item.sku)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.bin || "-")}</td>
        <td>${escapeHtml(item.size || "-")}</td>
        <td>${escapeHtml(item.color || "-")}</td>
        <td>${formatMoney(item.price, item.currency)}</td>
      </tr>`
      )
      .join("");
  }

  function renderRecentAssigned() {
    const rows = state.assignments.slice(0, 5);
    if (!rows.length) {
      refs.recentAssignedList.innerHTML = `<div class="empty-card">No assignments saved yet</div>`;
      return;
    }

    refs.recentAssignedList.innerHTML = rows
      .map(
        (item) => `
      <button class="recent-assigned-card" data-epc="${escapeHtml(item.epc)}" type="button">
        <span class="recent-assigned-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="mono">${escapeHtml(item.epc)}</span>
        </span>
        <span class="recent-assigned-meta">
          <span>${escapeHtml(item.sku)}</span>
          <span>${escapeHtml(item.bin || "No bin")}</span>
          <span>${formatMoney(item.price, item.currency)}</span>
        </span>
      </button>`
      )
      .join("");
  }

  function renderRecentEpcs() {
    if (!state.recentEpcs.length) {
      refs.recentEpcsBody.innerHTML = `<tr><td colspan="5" class="empty-row">Scan an item to capture its EPC here</td></tr>`;
      return;
    }

    refs.recentEpcsBody.innerHTML = state.recentEpcs
      .map((row) => {
        const itemName = row.item?.name || "Unassigned tag";
        const seen = row.seenAtIso ? new Date(row.seenAtIso).toLocaleTimeString() : "-";
        return `
        <tr class="recent-epc-row" data-epc="${escapeHtml(row.epc)}">
          <td class="mono">${escapeHtml(row.epc)}</td>
          <td>${escapeHtml(row.source || "-")}</td>
          <td>
            <span class="status-chip ${row.assigned ? "status-chip-ok" : "status-chip-warn"}">
              ${row.assigned ? "Assigned" : "Needs details"}
            </span>
          </td>
          <td>${escapeHtml(itemName)}</td>
          <td>${seen}</td>
        </tr>`;
      })
      .join("");
  }

  async function refreshHealthAndStatus() {
    try {
      const [health, session, status] = await Promise.all([
        apiGet("/api/health"),
        apiGet("/api/session/status"),
        apiGet("/api/demo/status"),
      ]);
      state.session = session;
      state.runtimeMode = String(status.mode || "demo").toLowerCase();
      updateSessionChrome();
      applyProductVisibility();
      setApiOnline(Boolean(health.ok));
      setSimulatorBadge(Boolean(status.simulatorRunning));
      if (status.bridge?.configured) {
        setBridgeBadge(Boolean(status.bridge.connected));
      }
      refs.closeDemoBtn.hidden = state.runtimeMode === "real";
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
    if (!Array.isArray(state.session?.products) || !state.session.products.includes("stock_audit")) {
      state.stocktake = {
        items: [],
        summary: { uniqueEpcs: 0, totalScanEvents: 0 },
      };
      renderStocktake();
      return;
    }
    const data = await apiGet("/api/inventory/stocktake/recent?limit=80");
    state.stocktake = {
      items: data.items || [],
      summary: data.summary || { uniqueEpcs: 0, totalScanEvents: 0 },
    };
    renderStocktake();
  }

  async function refreshLaundry() {
    if (!Array.isArray(state.session?.products) || !state.session.products.includes("laundry")) {
      state.laundry = {
        items: [],
        summary: { uniqueEpcs: 0, totalScanEvents: 0, byStatus: {} },
      };
      renderLaundry();
      return;
    }
    const data = await apiGet("/api/laundry/items?limit=80");
    state.laundry = {
      items: data.items || [],
      summary: data.summary || { uniqueEpcs: 0, totalScanEvents: 0 },
    };
    renderLaundry();
  }

  async function refreshAssignments() {
    const data = await apiGet("/api/assignments");
    state.assignments = data.items || [];
    renderAssignments();
    renderRecentAssigned();
  }

  async function refreshRecentEpcs() {
    const data = await apiGet("/api/assignments/recent-epcs");
    state.recentEpcs = data.items || [];
    renderRecentEpcs();
  }

  async function refreshAll() {
    try {
      await Promise.all([
        refreshHealthAndStatus(),
        refreshInZone(),
        refreshCart(),
        refreshInventory(),
        refreshStocktake(),
        refreshLaundry(),
        refreshAssignments(),
        refreshRecentEpcs(),
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
      refreshLaundry().catch(() => {});
      refreshAssignments().catch(() => {});
      refreshRecentEpcs().catch(() => {});
    }, 180);
  }

  function connectEvents() {
    if (state.events) {
      state.events.close();
    }
    if (!state.sessionId) return;
    state.events = new EventSource(`/api/live/events?session_id=${encodeURIComponent(state.sessionId)}`);
    state.events.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        const type = data.type || "event";
        pushLog(type);
        if (type === "demo.simulator.started") setSimulatorBadge(true);
        if (type === "demo.simulator.stopped") setSimulatorBadge(false);
        if (type === "bridge.connected") {
          setBridgeBadge(true);
          pushLog("Live reader connected");
        }
        if (type === "bridge.disconnected") {
          setBridgeBadge(false);
          pushLog("Live reader disconnected, reconnecting...");
        }
        if (
          type.startsWith("live.") ||
          type.startsWith("inventory.") ||
          type.startsWith("laundry.") ||
          type.startsWith("assignment.")
        ) {
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
    if (state.runtimeMode === "real") {
      pushLog("Live data mode is active; simulator is disabled.");
      return;
    }
    try {
      if (state.simulatorRunning) {
        await apiPost("/api/demo/simulator/stop");
        setSimulatorBadge(false);
        pushLog("Demo feed stopped; working screens cleared");
      } else {
        await apiPost("/api/demo/simulator/start");
        setSimulatorBadge(true);
        pushLog("Demo feed started");
      }
      await refreshAll();
    } catch (err) {
      pushLog(`Demo feed error: ${err.message}`);
    }
  }

  function activateTab(tabName) {
    state.activeView = tabName;
    for (const [name, tab] of Object.entries(refs.tabs)) {
      tab.classList.toggle("active", name === tabName);
    }
    for (const [name, view] of Object.entries(refs.views)) {
      view.classList.toggle("active", name === tabName);
    }
  }

  function openCheckoutModal() {
    refs.checkoutModalCount.textContent = String(state.cart.count || 0);
    refs.checkoutModalTotal.textContent = formatMoney(state.cart.total, state.cart.currency || "LKR");
    refs.checkoutModal.hidden = false;
    refs.checkoutModalDone.focus();
    pushLog("Payment handoff opened");
  }

  function closeCheckoutModal() {
    refs.checkoutModal.hidden = true;
  }

  function fillAssignmentForm(item) {
    refs.assignEpc.value = item.epc || "";
    refs.assignSku.value = item.sku || "";
    refs.assignName.value = item.name || "";
    refs.assignCategory.value = item.category || "";
    refs.assignBin.value = item.bin || "";
    refs.assignSize.value = item.size || "";
    refs.assignColor.value = item.color || "";
    refs.assignPrice.value = item.price || "";
    refs.assignStock.value = item.stock || 1;
    refs.assignLaundryStatus.value = item.laundryStatus || "Ready";
    refs.assignNotes.value = item.notes || "";
  }

  async function handleLoginSubmit(evt) {
    evt.preventDefault();

    try {
      if (state.pendingStores.length) {
        const selectedStore = String(refs.authStore.value || "").trim();
        await selectStore(selectedStore);
        return;
      }

      const email = refs.authEmail.value.trim().toLowerCase();

      const response = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: refs.authPassword.value,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Login failed");
      }

      setRememberedEmail(email);
      setStoredSessionId(body.session_id);
      state.session = body;

      if (body.needs_store_selection) {
        showAuthModal("Select the store you want to open.", body.stores || []);
        return;
      }

      hideAuthModal();
      updateSessionChrome();
      applyProductVisibility();
      connectEvents();
      await refreshAll();
    } catch (err) {
      showAuthModal(err.message || "Login failed");
    }
  }

  async function restoreSession() {
    if (!state.sessionId) {
      showAuthModal();
      return false;
    }

    try {
      const session = await apiGet("/api/session/status");
      state.session = session;
      updateSessionChrome();
      applyProductVisibility();
      hideAuthModal();
      return true;
    } catch (_err) {
      clearSessionState();
      showAuthModal("Sign in with your Xandora account to open your customer store.");
      return false;
    }
  }

  function bindUi() {
    refs.tabs.billing.addEventListener("click", () => activateTab("billing"));
    refs.tabs.inventory.addEventListener("click", () => activateTab("inventory"));
    refs.tabs.laundry.addEventListener("click", () => activateTab("laundry"));
    refs.tabs.assign.addEventListener("click", () => activateTab("assign"));
    refs.refreshBtn.addEventListener("click", () => refreshAll());
    refs.laundryFilter.addEventListener("change", renderLaundry);
    refs.checkoutBtn.addEventListener("click", openCheckoutModal);
    refs.checkoutModalClose.addEventListener("click", closeCheckoutModal);
    refs.checkoutModalDone.addEventListener("click", closeCheckoutModal);
    refs.checkoutModal.addEventListener("click", (evt) => {
      if (evt.target === refs.checkoutModal) closeCheckoutModal();
    });
    refs.assignmentRefreshBtn.addEventListener("click", () => refreshAssignments());
    refs.recentEpcsRefreshBtn.addEventListener("click", () => refreshRecentEpcs());
    refs.simToggleBtn.addEventListener("click", toggleSimulator);
    refs.switchStoreBtn.addEventListener("click", () => {
      const stores = Array.isArray(state.session?.stores) ? state.session.stores : [];
      if (stores.length < 2) return;
      showAuthModal("Choose the store you want to switch to.", stores, "switch-store");
    });
    refs.logoutBtn.addEventListener("click", async () => {
      try {
        if (state.sessionId) {
          await apiPost("/api/session/logout");
        }
      } catch (_err) {}
      clearSessionState();
      showAuthModal("You have been signed out.");
    });
    refs.authForm.addEventListener("submit", handleLoginSubmit);

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
        pushLog("Inventory intake cleared");
        await Promise.all([refreshStocktake(), refreshInventory()]);
      } catch (err) {
        pushLog(`Inventory clear failed: ${err.message}`);
      }
    });

    refs.clearLaundryBtn.addEventListener("click", async () => {
      try {
        await apiPost("/api/laundry/clear");
        pushLog("Laundry list cleared");
        await refreshLaundry();
      } catch (err) {
        pushLog(`Laundry clear failed: ${err.message}`);
      }
    });

    refs.closeDemoBtn.addEventListener("click", async () => {
      const confirmed = window.confirm("Close Xandora Retail Console now?");
      if (!confirmed) return;
      try {
        await apiPost("/api/demo/shutdown");
      } catch (_err) {}
      pushLog("Demo shutdown requested.");
      setTimeout(() => window.close(), 250);
    });

    refs.manualScanBtn.addEventListener("click", async () => {
      const epc = getManualEpc();
      if (!epc) return;
      try {
        await apiPost("/api/live/scan", { epc });
        refs.manualEpc.value = "";
        pushLog(`Bin scan: ${epc}`);
        await Promise.all([refreshInZone(), refreshInventory(), refreshAssignments(), refreshRecentEpcs()]);
      } catch (err) {
        pushLog(`Bin scan failed: ${err.message}`);
      }
    });

    refs.manualStocktakeBtn.addEventListener("click", async () => {
      const epc = getManualEpc();
      if (!epc) return;
      try {
        await apiPost("/api/inventory/stocktake/scan", { epc });
        refs.manualEpc.value = "";
        pushLog(`Inventory intake scan: ${epc}`);
        await Promise.all([refreshStocktake(), refreshInventory(), refreshAssignments(), refreshRecentEpcs()]);
      } catch (err) {
        pushLog(`Inventory scan failed: ${err.message}`);
      }
    });

    refs.manualLaundryBtn.addEventListener("click", async () => {
      const epc = getManualEpc();
      if (!epc) return;
      try {
        await apiPost("/api/laundry/scan", {
          epc,
          status: refs.laundryStatus.value,
        });
        refs.manualEpc.value = "";
        pushLog(`Laundry scan: ${epc}`);
        await Promise.all([refreshLaundry(), refreshAssignments(), refreshRecentEpcs()]);
      } catch (err) {
        pushLog(`Laundry scan failed: ${err.message}`);
      }
    });

    refs.assignmentForm.addEventListener("submit", async (evt) => {
      evt.preventDefault();
      const payload = {
        epc: refs.assignEpc.value,
        sku: refs.assignSku.value,
        name: refs.assignName.value,
        category: refs.assignCategory.value || "Demo Items",
        bin: refs.assignBin.value,
        size: refs.assignSize.value,
        color: refs.assignColor.value,
        price: refs.assignPrice.value || 0,
        stock: refs.assignStock.value || 1,
        laundryStatus: refs.assignLaundryStatus.value,
        notes: refs.assignNotes.value,
      };

      try {
        const result = await apiPost("/api/assignments", payload);
        pushLog(`Assigned ${result.item.epc} to ${result.item.name}`);
        refs.manualEpc.value = result.item.epc;
        await Promise.all([refreshAssignments(), refreshInventory(), refreshRecentEpcs()]);
      } catch (err) {
        pushLog(`Assignment failed: ${err.message}`);
      }
    });

    refs.inZoneBody.addEventListener("click", async (evt) => {
      const addBtn = evt.target.closest(".action-add");
      if (addBtn) {
        const epc = addBtn.getAttribute("data-epc");
        try {
          state.cart = await apiPost("/api/pos/cart/add", { epc });
          renderCart();
          pushLog(`Added to bill: ${epc}`);
        } catch (err) {
          pushLog(`Add to bill failed: ${err.message}`);
        }
        return;
      }

      const removeBtn = evt.target.closest(".action-remove-live");
      if (removeBtn) {
        const epc = removeBtn.getAttribute("data-epc");
        try {
          await apiPost("/api/live/remove", { epc });
          pushLog(`Removed from bin: ${epc}`);
          await Promise.all([refreshInZone(), refreshInventory()]);
        } catch (err) {
          pushLog(`Bin remove failed: ${err.message}`);
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
        pushLog(`Removed from bill: ${epc}`);
      } catch (err) {
        pushLog(`Cart remove failed: ${err.message}`);
      }
    });

    refs.assignmentsBody.addEventListener("click", (evt) => {
      const row = evt.target.closest(".assignment-row");
      if (!row) return;
      const epc = row.getAttribute("data-epc");
      const item = state.assignments.find((entry) => entry.epc === epc);
      if (item) fillAssignmentForm(item);
    });

    refs.recentAssignedList.addEventListener("click", (evt) => {
      const card = evt.target.closest(".recent-assigned-card");
      if (!card) return;
      const epc = card.getAttribute("data-epc");
      const item = state.assignments.find((entry) => entry.epc === epc);
      if (item) {
        fillAssignmentForm(item);
        pushLog(`Loaded assigned item: ${item.name}`);
      }
    });

    refs.recentEpcsBody.addEventListener("click", (evt) => {
      const row = evt.target.closest(".recent-epc-row");
      if (!row) return;
      const epc = row.getAttribute("data-epc");
      const recent = state.recentEpcs.find((entry) => entry.epc === epc);
      const assigned = state.assignments.find((entry) => entry.epc === epc);
      fillAssignmentForm(assigned || recent?.item || { epc });
      refs.assignEpc.focus();
      pushLog(`Loaded EPC for assignment: ${epc}`);
    });

    refs.laundryBody.addEventListener("click", (evt) => {
      const row = evt.target.closest(".laundry-row");
      if (!row) return;
      const epc = row.getAttribute("data-epc");
      const status = row.getAttribute("data-status") || "Received";
      refs.manualEpc.value = epc;
      refs.laundryStatus.value = status;
      pushLog(`Loaded laundry EPC for correction: ${epc}`);
    });
  }

  async function init() {
    bindUi();
    activateTab("billing");
    const restored = await restoreSession();
    if (!restored) return;
    connectEvents();
    await refreshAll();
  }

  init().catch((err) => {
    pushLog(`Init failed: ${err.message}`);
    setApiOnline(false);
  });
})();
