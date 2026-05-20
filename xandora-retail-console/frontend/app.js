(function () {
  const $ = (id) => document.getElementById(id);
  const SESSION_STORAGE_KEY = "xandora_retail_console_session";
  const REMEMBERED_EMAIL_KEY = "xandora_retail_console_email";
  const THEME_STORAGE_KEY = "xandora_retail_console_theme";
  const LIVE_BIN_MAX_AGE_SEC = 30;

  const state = {
    activeView: "billing",
    runtimeMode: "demo",
    theme: localStorage.getItem(THEME_STORAGE_KEY) || "dark",
    sessionId: localStorage.getItem(SESSION_STORAGE_KEY) || "",
    rememberedEmail: localStorage.getItem(REMEMBERED_EMAIL_KEY) || "",
    session: null,
    pendingStores: [],
    authMode: "login",
    cart: { items: [], count: 0, total: 0, currency: "LKR" },
    lastReceipt: null,
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
    catalogSyncTimer: null,
    livePruneTimer: null,
  };

  const refs = {
    apiStatus: $("api-status"),
    sessionUser: $("session-user"),
    sessionStore: $("session-store"),
    switchStoreBtn: $("switch-store-btn"),
    logoutBtn: $("logout-btn"),
    bridgeStatus: $("bridge-status"),
    simStatus: $("sim-status"),
    themeToggleBtn: $("theme-toggle-btn"),
    themeToggleLabel: $("theme-toggle-label"),
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
    metricCartSubtotal: $("metric-cart-subtotal"),
    metricCartDiscount: $("metric-cart-discount"),
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
    printBillBtn: $("print-bill-btn"),
    returnBtn: $("return-btn"),
    clearCartBtn: $("clear-cart-btn"),
    discountType: $("discount-type"),
    discountValue: $("discount-value"),
    applyDiscountBtn: $("apply-discount-btn"),
    returnReason: $("return-reason"),
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
    checkoutModalPrint: $("checkout-modal-print"),
    checkoutModalCount: $("checkout-modal-count"),
    checkoutModalSubtotal: $("checkout-modal-subtotal"),
    checkoutModalDiscount: $("checkout-modal-discount"),
    checkoutModalTotal: $("checkout-modal-total"),
    checkoutModalCopy: $("checkout-modal-copy"),
    receiptPrintArea: $("receipt-print-area"),
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

  function getLiveAgeSec(item = {}) {
    const lastSeenAt = Number(item.lastSeenAt || 0);
    if (lastSeenAt > 0) {
      return Math.max((Date.now() - lastSeenAt) / 1000, 0);
    }
    return Number(item.ageSec || 0);
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

  function setTheme(theme) {
    const nextTheme = theme === "light" ? "light" : "dark";
    state.theme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    if (refs.themeToggleBtn) {
      const isLight = nextTheme === "light";
      refs.themeToggleBtn.setAttribute("aria-pressed", String(isLight));
      refs.themeToggleBtn.setAttribute(
        "aria-label",
        isLight ? "Switch to dark mode" : "Switch to light mode"
      );
    }
    if (refs.themeToggleLabel) {
      refs.themeToggleLabel.textContent = nextTheme === "light" ? "Light" : "Dark";
    }
  }

  function toggleTheme() {
    setTheme(state.theme === "light" ? "dark" : "light");
  }

  function pushLog(message) {
    const ts = new Date().toLocaleTimeString();
    state.logLines.unshift(`[${ts}] ${message}`);
    state.logLines = state.logLines.slice(0, 44);
    refs.eventLog.textContent = state.logLines.join("\n");
  }

  async function withButtonBusy(button, busyLabel, work) {
    if (!button) return work();
    const idleLabel = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    button.classList.add("is-refreshing");
    try {
      return await work();
    } finally {
      button.disabled = false;
      button.textContent = idleLabel;
      button.classList.remove("is-refreshing");
      button.classList.add("just-refreshed");
      setTimeout(() => button.classList.remove("just-refreshed"), 420);
    }
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
    refs.sessionStore.hidden = true;
    refs.switchStoreBtn.hidden = true;
    refs.logoutBtn.hidden = true;
  }

  function updateSessionChrome() {
    const summary = state.session;
    if (!summary?.authenticated) {
      refs.sessionStore.hidden = true;
      refs.switchStoreBtn.hidden = true;
      refs.logoutBtn.hidden = true;
      return;
    }

    refs.sessionStore.hidden = false;
    refs.sessionStore.textContent = summary.selected_store_id || "Select store";
    refs.switchStoreBtn.hidden = !Array.isArray(summary.stores) || summary.stores.length < 2;
    refs.logoutBtn.hidden = false;
  }

  function applyProductVisibility() {
    const products = Array.isArray(state.session?.products) ? state.session.products : [];
    const hasLaundry = products.includes("laundry");

    refs.tabs.laundry.hidden = !hasLaundry;
    refs.manualLaundryBtn.hidden = !hasLaundry;
    refs.clearLaundryBtn.hidden = !hasLaundry;
    if (!hasLaundry && state.activeView === "laundry") {
      activateTab("billing");
    }
  }

  function setRememberedEmail(email) {
    state.rememberedEmail = String(email || "").trim();
    if (state.rememberedEmail) {
      localStorage.setItem(REMEMBERED_EMAIL_KEY, state.rememberedEmail);
    } else {
      localStorage.removeItem(REMEMBERED_EMAIL_KEY);
    }
  }

  function setAuthMessage(message, isError = false) {
    refs.authMessage.textContent =
      message || "Sign in with your Xandora account to open your customer store.";
    refs.authMessage.classList.toggle("auth-error", Boolean(isError));
  }

  function setAuthBusy(isBusy, label = "Signing in...") {
    refs.authSubmit.disabled = Boolean(isBusy);
    refs.authSubmit.textContent = isBusy ? label : getAuthSubmitLabel();
    refs.authEmail.disabled = Boolean(isBusy || state.pendingStores.length);
    refs.authPassword.disabled = Boolean(isBusy || state.pendingStores.length);
    refs.authStore.disabled = Boolean(isBusy);
  }

  function getAuthSubmitLabel() {
    if (!state.pendingStores.length) return "Sign in";
    return state.authMode === "switch-store" ? "Switch Store" : "Open Store";
  }

  function showAuthModal(message, stores = [], mode = "login") {
    state.authMode = mode;
    state.pendingStores = Array.isArray(stores) ? stores : [];
    setAuthMessage(message, false);
    refs.authStoreWrap.hidden = !state.pendingStores.length;
    refs.authStore.innerHTML = state.pendingStores
      .map((storeId) => `<option value="${escapeHtml(storeId)}">${escapeHtml(storeId)}</option>`)
      .join("");
    refs.authEmail.value = state.rememberedEmail || refs.authEmail.value || "";
    if (!state.pendingStores.length) {
      refs.authPassword.value = "";
    }
    refs.authPassword.disabled = Boolean(state.pendingStores.length);
    refs.authEmail.disabled = Boolean(state.pendingStores.length);
    refs.authStore.disabled = false;
    refs.authSubmit.disabled = false;
    refs.authSubmit.textContent = getAuthSubmitLabel();
    refs.authModal.hidden = false;
    setTimeout(() => {
      if (state.pendingStores.length) {
        refs.authStore.focus();
      } else {
        (refs.authEmail.value ? refs.authPassword : refs.authEmail).focus();
      }
    }, 0);
  }

  function hideAuthModal() {
    refs.authModal.hidden = true;
    refs.authPassword.disabled = false;
    refs.authEmail.disabled = false;
    refs.authStore.disabled = false;
    refs.authSubmit.disabled = false;
    refs.authStoreWrap.hidden = true;
    refs.authStore.innerHTML = "";
    refs.authSubmit.textContent = "Sign in";
    refs.authMessage.classList.remove("auth-error");
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
    startSharedCatalogSync();
    startLiveBinPrune();
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
    return (
      refs.manualEpc.value.trim() ||
      refs.assignEpc.value.trim()
    ).toUpperCase();
  }

  function renderInZone() {
    const visibleItems = state.inZone.filter((item) => getLiveAgeSec(item) <= LIVE_BIN_MAX_AGE_SEC);
    if (visibleItems.length !== state.inZone.length) {
      state.inZone = visibleItems;
    }

    if (!visibleItems.length) {
      refs.inZoneBody.innerHTML = `<tr><td colspan="7" class="empty-row">No items in bin</td></tr>`;
      return;
    }

    refs.inZoneBody.innerHTML = visibleItems
      .map(
        (item) => {
          const ageSec = getLiveAgeSec(item);
          return `
      <tr>
        <td class="mono">${escapeHtml(item.epc)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(item.bin || "-")}</td>
        <td>${formatMoney(item.price, item.currency)}</td>
        <td>${formatAge(ageSec)}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-small action-add" data-epc="${escapeHtml(item.epc)}" type="button">Add to Bill</button>
            <button class="btn btn-small btn-outline action-remove-live" data-epc="${escapeHtml(item.epc)}" type="button">Remove</button>
          </div>
        </td>
      </tr>`;
        }
      )
      .join("");
  }

  function renderCart() {
    const currency = state.cart.currency || "LKR";
    refs.metricCartCount.textContent = String(state.cart.count || 0);
    refs.metricCartSubtotal.textContent = formatMoney(state.cart.subtotal ?? state.cart.total, currency);
    refs.metricCartDiscount.textContent = formatMoney(state.cart.discount?.amount || 0, currency);
    refs.metricCartTotal.textContent = formatMoney(state.cart.total, currency);
    if (refs.discountType) refs.discountType.value = state.cart.discount?.type || "amount";
    if (refs.discountValue && document.activeElement !== refs.discountValue) {
      refs.discountValue.value = String(state.cart.discount?.value || 0);
    }
    if (refs.printBillBtn) {
      refs.printBillBtn.disabled = !state.lastReceipt;
    }

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

  function buildReceiptSnapshot(result, cart) {
    const now = new Date();
    return {
      receiptNo: result.ext_id || result.transaction?.ext_id || `xandora-${now.getTime()}`,
      type: result.receipt_type || (Number(result.total_amount || 0) < 0 ? "RETURN" : "SALE"),
      store: state.session?.selected_store_id || "Xandora Store",
      cashier: state.session?.email || state.rememberedEmail || "",
      issuedAt: now,
      currency: cart.currency || "LKR",
      count: result.items_count || cart.count || 0,
      total: Number(result.total_amount ?? cart.total ?? 0),
      subtotal: Number(result.subtotal_amount ?? cart.subtotal ?? cart.total ?? 0),
      discount: result.discount || cart.discount || { type: "amount", value: 0, amount: 0 },
      items: Array.isArray(cart.items) ? cart.items.map((item) => ({ ...item })) : [],
    };
  }

  function renderReceipt(receipt) {
    if (!refs.receiptPrintArea || !receipt) return;

    const items = receipt.items.length
      ? receipt.items
          .map(
            (item, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>
                  <strong>${escapeHtml(item.name || item.product || "Item")}</strong>
                  <span>${escapeHtml(
                    [
                      item.brand ? `Brand: ${item.brand}` : "",
                      item.size ? `Size: ${item.size}` : "",
                      item.color ? `Color: ${item.color}` : "",
                    ]
                      .filter(Boolean)
                      .join(" | ")
                  )}</span>
                  <span>${escapeHtml(item.sku || item.epc || "")}</span>
                </td>
                <td>${formatMoney(item.price, receipt.currency)}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="3">No item detail available</td></tr>`;

    refs.receiptPrintArea.innerHTML = `
      <section class="receipt-paper">
        <h1>Xandora</h1>
        <p class="receipt-type">${escapeHtml(receipt.type || "SALE")}</p>
        <p>${escapeHtml(receipt.store)}</p>
        <p>${escapeHtml(receipt.issuedAt.toLocaleString())}</p>
        <p>Bill: ${escapeHtml(receipt.receiptNo)}</p>
        ${receipt.cashier ? `<p>Cashier: ${escapeHtml(receipt.cashier)}</p>` : ""}
        <hr />
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${items}</tbody>
        </table>
        <hr />
        <div class="receipt-totals">
          <span>Items</span>
          <strong>${receipt.count}</strong>
          <span>Subtotal</span>
          <strong>${formatMoney(receipt.subtotal, receipt.currency)}</strong>
          <span>Discount</span>
          <strong>${formatMoney(receipt.discount?.amount || 0, receipt.currency)}</strong>
          <span>Total</span>
          <strong>${formatMoney(receipt.total, receipt.currency)}</strong>
        </div>
        <p class="receipt-footer">Thank you</p>
      </section>
    `;
  }

  async function printLastReceipt() {
    if (!state.lastReceipt) {
      pushLog("Print blocked: no completed bill is ready");
      return;
    }
    renderReceipt(state.lastReceipt);
    try {
      const res = await fetch("http://127.0.0.1:4315/print-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt: state.lastReceipt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Print bridge failed (${res.status})`);
      }
      pushLog(`Receipt sent to POS printer: ${state.lastReceipt.receiptNo}`);
    } catch (err) {
      pushLog(`Print bridge unavailable, opening browser print: ${err.message}`);
      window.print();
    }
  }

  function asInZoneItem(item = {}) {
    return {
      epc: String(item.epc || "").toUpperCase(),
      sku: item.sku || "",
      name: item.name || item.product_name || "",
      category: item.category || "",
      bin: item.bin || "",
      size: item.size || item.size_label || "",
      color: item.color || "",
      price: Number(item.price || item.price_lkr || 0),
      currency: item.currency || "LKR",
      ageSec: Number(item.ageSec || 0),
      firstSeenAt: Number(item.firstSeenAt || Date.now()),
      lastSeenAt: Number(item.lastSeenAt || Date.now()),
    };
  }

  function upsertByEpc(rows, nextItem) {
    const item = asInZoneItem(nextItem);
    if (!item.epc) return rows;
    const filtered = rows.filter((row) => row.epc !== item.epc);
    return [item, ...filtered];
  }

  function upsertStocktakeRow(row = {}) {
    const epc = String(row.epc || "").toUpperCase();
    if (!epc) return;
    const next = {
      ...row,
      epc,
      at_iso: row.at_iso || new Date(row.lastSeenAt || Date.now()).toISOString(),
      device_id: row.device_id || row.deviceId || "-",
      scans: Number(row.scans || 1),
    };
    state.stocktake.items = [next, ...(state.stocktake.items || []).filter((item) => item.epc !== epc)];
    state.stocktake.summary = {
      ...(state.stocktake.summary || {}),
      uniqueEpcs: state.stocktake.items.length,
      totalScanEvents: state.stocktake.items.reduce((sum, item) => sum + Number(item.scans || 0), 0),
    };
    renderStocktake();
  }

  function upsertLaundryRow(row = {}) {
    const epc = String(row.epc || "").toUpperCase();
    if (!epc) return;
    const next = {
      ...row,
      epc,
      status: row.status || refs.laundryStatus?.value || "Received",
      last_seen_iso: row.last_seen_iso || new Date(row.lastSeenAt || Date.now()).toISOString(),
      scans: Number(row.scans || 1),
    };
    state.laundry.items = [next, ...(state.laundry.items || []).filter((item) => item.epc !== epc)];
    state.laundry.summary = {
      ...(state.laundry.summary || {}),
      uniqueEpcs: state.laundry.items.length,
      totalScanEvents: state.laundry.items.reduce((sum, item) => sum + Number(item.scans || 0), 0),
    };
    renderLaundry();
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

  function upsertRecentEpc(row = {}) {
    const epc = String(row.epc || "").toUpperCase();
    if (!epc) return;
    const assignedItem = state.assignments.find((item) => item.epc === epc);
    const next = {
      epc,
      source: row.source || "Live reader",
      seenAt: row.seenAt || Date.now(),
      seenAtIso: row.seenAtIso || new Date(row.seenAt || Date.now()).toISOString(),
      assigned: Boolean(row.assigned || assignedItem || row.item),
      item: row.item || assignedItem || null,
    };
    state.recentEpcs = [next, ...state.recentEpcs.filter((item) => item.epc !== epc)].slice(0, 30);
    renderRecentEpcs();
  }

  function removeRecentEpc(epc) {
    const normalized = String(epc || "").toUpperCase();
    if (!normalized) return;
    state.recentEpcs = state.recentEpcs.filter((item) => item.epc !== normalized);
    renderRecentEpcs();
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

  async function refreshBilling() {
    await Promise.all([refreshInZone(), refreshCart(), refreshRecentEpcs()]);
  }

  async function refreshActiveView() {
    try {
      if (state.activeView === "billing") {
        await refreshBilling();
      } else if (state.activeView === "inventory") {
        await refreshBilling();
      } else if (state.activeView === "laundry") {
        await refreshLaundry();
      } else if (state.activeView === "assign") {
        await Promise.all([refreshAssignments(), refreshRecentEpcs()]);
      } else {
        await refreshAll();
      }
    } catch (err) {
      pushLog(`Refresh failed: ${err.message}`);
      setApiOnline(false);
    }
  }

  function syncSharedCatalog() {
    if (!state.sessionId) return;
    Promise.all([refreshAssignments(), refreshRecentEpcs()]).catch(() => {});
  }

  function startSharedCatalogSync() {
    if (state.catalogSyncTimer) {
      clearInterval(state.catalogSyncTimer);
    }
    state.catalogSyncTimer = setInterval(syncSharedCatalog, 5000);
  }

  function startLiveBinPrune() {
    if (state.livePruneTimer) {
      clearInterval(state.livePruneTimer);
    }
    state.livePruneTimer = setInterval(() => {
      if (state.activeView === "billing") {
        renderInZone();
      }
    }, 1000);
  }

  async function refreshAll() {
    try {
      await Promise.all([
        refreshHealthAndStatus(),
        refreshInZone(),
        refreshCart(),
        refreshLaundry(),
        refreshAssignments(),
        refreshRecentEpcs(),
      ]);
    } catch (err) {
      pushLog(`Refresh failed: ${err.message}`);
      setApiOnline(false);
    }
  }

  function scheduleLiveRefresh(scope = "live") {
    if (state.liveRefreshTimer) return;
    state.liveRefreshTimer = setTimeout(() => {
      state.liveRefreshTimer = null;
      if (scope === "pos") {
        refreshCart().catch(() => {});
        refreshInZone().catch(() => {});
        return;
      }
      if (scope === "assignment") {
        refreshAssignments().catch(() => {});
        refreshRecentEpcs().catch(() => {});
        return;
      }
      if (scope === "inventory") {
        refreshInventory().catch(() => {});
        refreshStocktake().catch(() => {});
        return;
      }
      if (scope === "laundry") {
        refreshLaundry().catch(() => {});
        return;
      }
      refreshInZone().catch(() => {});
      refreshRecentEpcs().catch(() => {});
    }, 25);
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
        if (!["live.raw", "live.touch"].includes(type)) {
          pushLog(type);
        }
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
          type.startsWith("pos.") ||
          type.startsWith("inventory.") ||
          type.startsWith("laundry.") ||
          type.startsWith("assignment.")
        ) {
          if (type === "live.raw" && data.epc) {
            upsertRecentEpc({
              epc: data.epc,
              source: data.source || "Live reader",
              seenAt: data.at || Date.now(),
              seenAtIso: new Date(data.at || Date.now()).toISOString(),
              assigned: Boolean(data.assigned || data.item),
              item: data.item || null,
            });
          }
          if ((type === "live.scan" || type === "live.enter" || type === "live.touch") && data.item) {
            state.inZone = upsertByEpc(state.inZone, data.item);
            renderInZone();
          }
          if (type === "live.exit" && data.item?.epc) {
            state.inZone = state.inZone.filter((item) => item.epc !== data.item.epc);
            renderInZone();
            removeRecentEpc(data.item.epc);
          }
          if (type === "live.scan" && data.epc) {
            upsertRecentEpc({
              epc: data.epc,
              source: "Live reader",
              seenAt: data.at || Date.now(),
              seenAtIso: new Date(data.at || Date.now()).toISOString(),
              assigned: Boolean(data.item),
              item: data.item || null,
            });
          }
          if (type === "inventory.stocktake_scan" && data.item) {
            upsertStocktakeRow(data.item);
          }
          if (type === "laundry.scan" && data.item) {
            upsertLaundryRow(data.item);
          }
          if (type === "pos.cart.added" && data.epc) {
            state.inZone = state.inZone.filter((item) => item.epc !== data.epc);
            renderInZone();
          }
          if (type === "pos.cart.removed" && data.item) {
            state.inZone = upsertByEpc(state.inZone, data.item);
            renderInZone();
          }
          if (type === "assignment.saved" && data.item) {
            state.assignments = upsertByEpc(state.assignments, data.item);
            state.inZone = upsertByEpc(state.inZone, {
              ...data.item,
              firstSeenAt: data.at || Date.now(),
              lastSeenAt: data.at || Date.now(),
            });
            renderAssignments();
            renderRecentAssigned();
            renderInZone();
            upsertRecentEpc({
              epc: data.item.epc,
              source: "Assignment saved",
              seenAt: data.at || Date.now(),
              seenAtIso: new Date(data.at || Date.now()).toISOString(),
              assigned: true,
              item: data.item,
            });
          }
          const refreshScope = type.startsWith("pos.")
            ? "pos"
            : type.startsWith("assignment.")
            ? "assignment"
            : type.startsWith("inventory.")
            ? "inventory"
            : type.startsWith("laundry.")
            ? "laundry"
            : "live";
          if (type !== "live.raw") {
            scheduleLiveRefresh(refreshScope);
          }
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
      if (!tab) continue;
      tab.classList.toggle("active", name === tabName);
    }
    for (const [name, view] of Object.entries(refs.views)) {
      if (!view) continue;
      view.classList.toggle("active", name === tabName);
    }
  }

  async function checkoutCart() {
    if (!state.cart.count) {
      pushLog("Checkout blocked: cart is empty");
      return;
    }

    refs.checkoutBtn.disabled = true;
    refs.checkoutBtn.textContent = "Processing...";
    try {
      const checkoutCartSnapshot = {
        ...state.cart,
        items: Array.isArray(state.cart.items) ? state.cart.items.map((item) => ({ ...item })) : [],
      };
      const result = await apiPost("/api/pos/cart/checkout");
      state.lastReceipt = buildReceiptSnapshot(result, checkoutCartSnapshot);
      renderReceipt(state.lastReceipt);
      refs.checkoutModalCount.textContent = String(result.items_count || 0);
      refs.checkoutModalSubtotal.textContent = formatMoney(
        result.subtotal_amount ?? checkoutCartSnapshot.subtotal ?? checkoutCartSnapshot.total,
        checkoutCartSnapshot.currency || "LKR"
      );
      refs.checkoutModalDiscount.textContent = formatMoney(
        result.discount?.amount ?? checkoutCartSnapshot.discount?.amount ?? 0,
        checkoutCartSnapshot.currency || "LKR"
      );
      refs.checkoutModalTotal.textContent = formatMoney(
        result.total_amount,
        checkoutCartSnapshot.currency || "LKR"
      );
      refs.checkoutModalCopy.textContent =
        "Sale recorded in Xandora. Print the bill for the customer, then return to the bill.";
      refs.checkoutModal.hidden = false;
      refs.checkoutModalPrint.focus();
      state.cart = result.cleared_cart || { items: [], count: 0, total: 0, currency: "LKR" };
      renderCart();
      await Promise.all([refreshRecentEpcs(), refreshInZone()]).catch(() => {});
      pushLog(`Checkout completed: ${result.items_count || 0} item(s)`);
    } catch (err) {
      pushLog(`Checkout failed: ${err.message}`);
    } finally {
      refs.checkoutBtn.disabled = false;
      refs.checkoutBtn.textContent = "Checkout";
    }
  }

  async function applyDiscount() {
    try {
      state.cart = await apiPost("/api/pos/cart/discount", {
        type: refs.discountType.value,
        value: refs.discountValue.value,
      });
      renderCart();
      pushLog(`Discount applied: ${state.cart.discount?.type || "amount"} ${state.cart.discount?.value || 0}`);
    } catch (err) {
      pushLog(`Discount failed: ${err.message}`);
    }
  }

  async function returnEpc() {
    const epc = getManualEpc();
    if (!epc) {
      pushLog("Return blocked: enter or scan an EPC first");
      refs.manualEpc.focus();
      return;
    }

    refs.returnBtn.disabled = true;
    refs.returnBtn.textContent = "Returning...";
    try {
      const result = await apiPost("/api/pos/return", {
        epc,
        reason: refs.returnReason.value || "Customer return",
      });
      const item = result.item || { epc, price: Math.abs(Number(result.total_amount || 0)) };
      const returnCart = {
        items: [item],
        count: result.items_count || 1,
        subtotal: Math.abs(Number(result.total_amount || item.price || 0)),
        total: Number(result.total_amount || 0),
        currency: item.currency || "LKR",
        discount: { type: "amount", value: 0, amount: 0 },
      };
      state.lastReceipt = buildReceiptSnapshot(
        { ...result, receipt_type: "RETURN", subtotal_amount: returnCart.subtotal },
        returnCart
      );
      renderReceipt(state.lastReceipt);
      refs.checkoutModalCount.textContent = String(result.items_count || 1);
      refs.checkoutModalSubtotal.textContent = formatMoney(returnCart.subtotal, returnCart.currency);
      refs.checkoutModalDiscount.textContent = formatMoney(0, returnCart.currency);
      refs.checkoutModalTotal.textContent = formatMoney(result.total_amount, returnCart.currency);
      refs.checkoutModalCopy.textContent =
        "Return recorded in Xandora. Print the return bill for the customer, then return to the bill.";
      refs.checkoutModal.hidden = false;
      refs.checkoutModalPrint.focus();
      if (refs.printBillBtn) refs.printBillBtn.disabled = false;
      refs.manualEpc.value = "";
      await Promise.all([refreshAssignments(), refreshRecentEpcs()]).catch(() => {});
      pushLog(`Return completed: ${epc}`);
    } catch (err) {
      pushLog(`Return failed: ${err.message}`);
    } finally {
      refs.returnBtn.disabled = false;
      refs.returnBtn.textContent = "Return EPC";
    }
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
    if (refs.assignLaundryStatus) refs.assignLaundryStatus.value = item.laundryStatus || "Ready";
    if (refs.assignNotes) refs.assignNotes.value = item.notes || "";
  }

  async function handleLoginSubmit(evt) {
    evt.preventDefault();
    if (refs.authSubmit.disabled) return;

    try {
      if (state.pendingStores.length) {
        setAuthBusy(true, "Opening store...");
        const selectedStore = String(refs.authStore.value || "").trim();
        await selectStore(selectedStore);
        return;
      }

      const email = refs.authEmail.value.trim().toLowerCase();
      setAuthMessage("Signing in securely...", false);
      setAuthBusy(true, "Signing in...");

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
      startSharedCatalogSync();
      startLiveBinPrune();
      await refreshAll();
    } catch (err) {
      setAuthMessage(err.message || "Login failed", true);
      (state.pendingStores.length ? refs.authStore : refs.authPassword).focus();
    } finally {
      if (!refs.authModal.hidden) {
        setAuthBusy(false);
      }
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
      if (session?.authenticated && !session.selected_store_id && Array.isArray(session.stores)) {
        if (session.stores.length === 1) {
          await selectStore(session.stores[0]);
        } else {
          showAuthModal("Select the store you want to open.", session.stores || []);
        }
        return false;
      }
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
    refs.themeToggleBtn.addEventListener("click", toggleTheme);
    refs.tabs.billing.addEventListener("click", () => activateTab("billing"));
    if (refs.tabs.inventory) {
      refs.tabs.inventory.addEventListener("click", () => activateTab("inventory"));
    }
    refs.tabs.laundry.addEventListener("click", () => activateTab("laundry"));
    refs.tabs.assign.addEventListener("click", () => activateTab("assign"));
    refs.refreshBtn.addEventListener("click", () =>
      withButtonBusy(refs.refreshBtn, "Refreshing...", async () => {
        await refreshActiveView();
        pushLog("Billing refreshed");
      })
    );
    refs.laundryFilter.addEventListener("change", renderLaundry);
    refs.checkoutBtn.addEventListener("click", checkoutCart);
    if (refs.printBillBtn) {
      refs.printBillBtn.addEventListener("click", printLastReceipt);
    }
    refs.returnBtn.addEventListener("click", returnEpc);
    refs.applyDiscountBtn.addEventListener("click", applyDiscount);
    refs.discountValue.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        applyDiscount();
      }
    });
    refs.checkoutModalClose.addEventListener("click", closeCheckoutModal);
    refs.checkoutModalDone.addEventListener("click", closeCheckoutModal);
    refs.checkoutModalPrint.addEventListener("click", printLastReceipt);
    refs.checkoutModal.addEventListener("click", (evt) => {
      if (evt.target === refs.checkoutModal) closeCheckoutModal();
    });
    refs.assignmentRefreshBtn.addEventListener("click", () =>
      withButtonBusy(refs.assignmentRefreshBtn, "Refreshing...", async () => {
        await Promise.all([refreshAssignments(), refreshRecentEpcs()]);
        pushLog("Assignments refreshed");
      })
    );
    refs.recentEpcsRefreshBtn.addEventListener("click", () =>
      withButtonBusy(refs.recentEpcsRefreshBtn, "Refreshing...", async () => {
        await refreshRecentEpcs();
        pushLog("Recent EPCs refreshed");
      })
    );
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

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) syncSharedCatalog();
    });
    window.addEventListener("focus", syncSharedCatalog);

    refs.manualScanBtn.addEventListener("click", async () => {
      const epc = getManualEpc();
      if (!epc) return;
      try {
        const result = await apiPost("/api/live/scan", { epc });
        if (result.item) {
          state.inZone = upsertByEpc(state.inZone, result.item);
          renderInZone();
        }
        refs.manualEpc.value = "";
        pushLog(`Bin scan: ${epc}`);
        refreshBilling().catch(() => {});
      } catch (err) {
        pushLog(`Bin scan failed: ${err.message}`);
      }
    });

    refs.manualStocktakeBtn.addEventListener("click", async () => {
      const epc = getManualEpc();
      if (!epc) return;
      try {
        const result = await apiPost("/api/inventory/stocktake/scan", { epc });
        if (result.row || result.item) {
          upsertStocktakeRow(result.row || result.item);
        }
        refs.manualEpc.value = "";
        pushLog(`Inventory intake scan: ${epc}`);
        Promise.all([refreshStocktake(), refreshInventory(), refreshAssignments(), refreshRecentEpcs()]).catch(() => {});
      } catch (err) {
        pushLog(`Inventory scan failed: ${err.message}`);
      }
    });

    refs.manualLaundryBtn.addEventListener("click", async () => {
      const epc = getManualEpc();
      if (!epc) return;
      try {
        const result = await apiPost("/api/laundry/scan", {
          epc,
          status: refs.laundryStatus.value,
        });
        if (result.item) {
          upsertLaundryRow(result.item);
        }
        refs.manualEpc.value = "";
        pushLog(`Laundry scan: ${epc}`);
        Promise.all([refreshLaundry(), refreshAssignments(), refreshRecentEpcs()]).catch(() => {});
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
        laundryStatus: refs.assignLaundryStatus?.value || "",
        notes: refs.assignNotes?.value || "",
      };

      try {
        const result = await apiPost("/api/assignments", payload);
        pushLog(`Assigned ${result.item.epc} to ${result.item.name}`);
        refs.manualEpc.value = result.item.epc;
        state.assignments = upsertByEpc(state.assignments, result.item);
        state.inZone = upsertByEpc(state.inZone, {
          ...result.item,
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
        });
        upsertRecentEpc({
          epc: result.item.epc,
          source: "Assignment saved",
          seenAt: Date.now(),
          seenAtIso: new Date().toISOString(),
          assigned: true,
          item: result.item,
        });
        renderAssignments();
        renderRecentAssigned();
        renderInZone();
        Promise.all([refreshAssignments(), refreshRecentEpcs(), refreshInZone()]).catch(() => {});
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
          state.inZone = state.inZone.filter((item) => item.epc !== epc);
          renderInZone();
          renderCart();
          pushLog(`Added to bill: ${epc}`);
          Promise.all([refreshInZone(), refreshCart()]).catch(() => {});
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
          await refreshInZone();
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
        const result = await apiPost("/api/pos/cart/remove", { epc });
        state.cart = result;
        if (result.restored_item) {
          state.inZone = upsertByEpc(state.inZone, result.restored_item);
          renderInZone();
        }
        renderCart();
        pushLog(`Removed from bill: ${epc}`);
        Promise.all([refreshInZone(), refreshCart()]).catch(() => {});
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
    setTheme(state.theme);
    bindUi();
    activateTab("billing");
    const restored = await restoreSession();
    if (!restored) return;
    connectEvents();
    startSharedCatalogSync();
    startLiveBinPrune();
    await refreshAll();
  }

  init().catch((err) => {
    pushLog(`Init failed: ${err.message}`);
    setApiOnline(false);
  });
})();
