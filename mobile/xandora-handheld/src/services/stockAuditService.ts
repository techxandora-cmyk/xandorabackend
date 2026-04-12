import api from './api';
import { getAuthSession } from './session';

export type StockAuditSession = {
  id?: number;
  session_id?: string | null;
  store_id?: string | null;
  status?: string | null;
  total_expected?: number;
  total_found?: number;
  total_missing?: number;
  accuracy_percent?: number;
  duration_seconds?: number;
  total_reads?: number;
  read_rate?: number;
  started_at?: string | null;
  ended_at?: string | null;
  operator_label?: string | null;
  created_by_email?: string | null;
  device_id?: string | null;
};

export type StockAuditProgress = {
  active: boolean;
  found: number;
  expected: number;
  missing: number;
  accuracy: number;
  reads: number;
  duration_seconds: number;
  read_rate: number;
  session: StockAuditSession | null;
};

export type StockAuditItem = {
  epc: string;
  read_count: number;
  last_seen?: string | null;
  sku?: string | null;
  product_name?: string | null;
  brand?: string | null;
  category?: string | null;
  size_label?: string | null;
  color?: string | null;
  price_lkr?: number | null;
};

export type StockAuditKpis = {
  sessions_total: number;
  sessions_active: number;
  avg_accuracy_percent: number;
  total_reads: number;
  unique_epcs_total: number;
};

export type StockAuditRiskItem = {
  group_key?: string | null;
  barcode?: string | null;
  sku?: string | null;
  product_name?: string | null;
  brand?: string | null;
  category?: string | null;
  size_label?: string | null;
  total_tags?: number;
  in_stock_count?: number;
  sold_count?: number;
  returned_count?: number;
  scanned_7d_count?: number;
  last_scan_at?: string | null;
  days_since_scan?: number | null;
  return_rate_pct?: number | null;
  risk_low_stock?: boolean;
  risk_out_of_stock?: boolean;
  risk_high_return_rate?: boolean;
  risk_never_scanned_7d?: boolean;
};

export type StockAuditBrandRisk = {
  brand?: string | null;
  low_stock_units?: number;
  out_of_stock_demand_units?: number;
  high_return_sold_units?: number;
  never_scanned_units?: number;
  at_risk_units?: number;
  max_no_scan_days?: number;
};

export type StockAuditInsights = {
  dead_stock: StockAuditRiskItem[];
  risks: {
    low_stock_products?: number;
    out_of_stock_products?: number;
    high_return_rate_products?: number;
    never_scanned_7d_products?: number;
    low_stock_units?: number;
    out_of_stock_demand_units?: number;
    high_return_sold_units?: number;
    never_scanned_units?: number;
    at_risk_units?: number;
  };
  risk_items: StockAuditRiskItem[];
  brand_risks: StockAuditBrandRisk[];
};

function normalizeStoreId(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeTag(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeTags(values: unknown[]): string[] {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map(value => normalizeTag(value))
        .filter(Boolean),
    ),
  );
}

async function requireStoreId(): Promise<string> {
  const session = await getAuthSession();
  const storeId =
    session?.currentStoreId ||
    session?.user?.default_store_id ||
    session?.user?.store_ids?.[0] ||
    '';

  if (!storeId) {
    throw new Error('No store is assigned to this handheld account');
  }

  return normalizeStoreId(storeId);
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSession(row: any): StockAuditSession {
  return {
    id: toNumber(row?.id) || undefined,
    session_id: row?.session_id || null,
    store_id: row?.store_id || null,
    status: row?.status || null,
    total_expected: toNumber(row?.total_expected),
    total_found: toNumber(row?.total_found),
    total_missing: toNumber(row?.total_missing),
    accuracy_percent: toNumber(row?.accuracy_percent),
    duration_seconds: toNumber(row?.duration_seconds),
    total_reads: toNumber(row?.total_reads || row?.metrics_summary?.total_reads),
    read_rate: toNumber(row?.read_rate || row?.metrics_summary?.read_rate),
    started_at: row?.started_at || null,
    ended_at: row?.ended_at || null,
    operator_label: row?.operator_label || null,
    created_by_email: row?.created_by_email || null,
    device_id: row?.device_id || null,
  };
}

function normalizeItem(row: any): StockAuditItem {
  return {
    epc: normalizeTag(row?.epc),
    read_count: toNumber(row?.read_count),
    last_seen: row?.last_seen || null,
    sku: row?.sku || null,
    product_name: row?.product_name || null,
    brand: row?.brand || null,
    category: row?.category || null,
    size_label: row?.size_label || null,
    color: row?.color || null,
    price_lkr: row?.price_lkr != null ? toNumber(row.price_lkr) : null,
  };
}

function normalizeRiskItem(row: any): StockAuditRiskItem {
  return {
    group_key: row?.group_key || null,
    barcode: row?.barcode || null,
    sku: row?.sku || null,
    product_name: row?.product_name || null,
    brand: row?.brand || null,
    category: row?.category || null,
    size_label: row?.size_label || null,
    total_tags: toNumber(row?.total_tags),
    in_stock_count: toNumber(row?.in_stock_count),
    sold_count: toNumber(row?.sold_count),
    returned_count: toNumber(row?.returned_count),
    scanned_7d_count: toNumber(row?.scanned_7d_count),
    last_scan_at: row?.last_scan_at || null,
    days_since_scan: row?.days_since_scan != null ? toNumber(row.days_since_scan) : null,
    return_rate_pct: row?.return_rate_pct != null ? toNumber(row.return_rate_pct) : null,
    risk_low_stock: Boolean(row?.risk_low_stock),
    risk_out_of_stock: Boolean(row?.risk_out_of_stock),
    risk_high_return_rate: Boolean(row?.risk_high_return_rate),
    risk_never_scanned_7d: Boolean(row?.risk_never_scanned_7d),
  };
}

function normalizeBrandRisk(row: any): StockAuditBrandRisk {
  return {
    brand: row?.brand || null,
    low_stock_units: toNumber(row?.low_stock_units),
    out_of_stock_demand_units: toNumber(row?.out_of_stock_demand_units),
    high_return_sold_units: toNumber(row?.high_return_sold_units),
    never_scanned_units: toNumber(row?.never_scanned_units),
    at_risk_units: toNumber(row?.at_risk_units),
    max_no_scan_days: toNumber(row?.max_no_scan_days),
  };
}

export async function getStockAuditActiveSession(
  storeIdOverride?: string | null,
): Promise<StockAuditSession | null> {
  const storeId = normalizeStoreId(storeIdOverride) || (await requireStoreId());
  const response = await api.get('/inventory/active', {
    params: { store_id: storeId },
  });
  return response.data?.session ? normalizeSession(response.data.session) : null;
}

export async function getStockAuditProgress(
  storeIdOverride?: string | null,
): Promise<StockAuditProgress> {
  const storeId = normalizeStoreId(storeIdOverride) || (await requireStoreId());
  const response = await api.get('/inventory/progress', {
    params: { store_id: storeId },
  });
  return {
    active: Boolean(response.data?.active),
    found: toNumber(response.data?.found),
    expected: toNumber(response.data?.expected),
    missing: toNumber(response.data?.missing),
    accuracy: toNumber(response.data?.accuracy),
    reads: toNumber(response.data?.reads),
    duration_seconds: toNumber(response.data?.duration_seconds),
    read_rate: toNumber(response.data?.read_rate),
    session: response.data?.session ? normalizeSession(response.data.session) : null,
  };
}

export async function startStockAuditSession({
  expectedCount = 0,
  deviceId,
}: {
  expectedCount?: number;
  deviceId?: string | null;
} = {}): Promise<StockAuditSession> {
  const storeId = await requireStoreId();
  const response = await api.post('/inventory/start', {
    store_id: storeId,
    total_expected: Math.max(toNumber(expectedCount), 0),
    device_id: String(deviceId || '').trim() || undefined,
  });
  return normalizeSession(response.data?.session || {});
}

export async function endStockAuditSession(): Promise<StockAuditSession> {
  const storeId = await requireStoreId();
  const response = await api.post('/inventory/end', {
    store_id: storeId,
  });
  return normalizeSession(response.data?.session || {});
}

export async function submitStockAuditScans({
  epcs,
  deviceId,
}: {
  epcs: string[];
  deviceId?: string | null;
}): Promise<{
  scanned_count: number;
  session: StockAuditSession | null;
  scans: Array<{ epc: string; read_count: number; last_seen?: string | null }>;
}> {
  const storeId = await requireStoreId();
  const normalizedEpcs = normalizeTags(epcs);
  if (!normalizedEpcs.length) {
    throw new Error('At least one RFID is required');
  }

  const response = await api.post('/inventory/scan', {
    store_id: storeId,
    epcs: normalizedEpcs,
    device_id: String(deviceId || '').trim() || undefined,
  });

  return {
    scanned_count: toNumber(response.data?.scanned_count),
    session: response.data?.session ? normalizeSession(response.data.session) : null,
    scans: Array.isArray(response.data?.scans)
      ? response.data.scans.map((row: any) => ({
          epc: normalizeTag(row?.epc),
          read_count: toNumber(row?.read_count),
          last_seen: row?.last_seen || null,
        }))
      : [],
  };
}

export async function getStockAuditItems({
  limit = 200,
  sessionId,
}: {
  limit?: number;
  sessionId?: number | string | null;
} = {}): Promise<{
  session_id: number | null;
  source: string;
  items: StockAuditItem[];
}> {
  const storeId = await requireStoreId();
  const response = await api.get('/inventory/items', {
    params: {
      store_id: storeId,
      limit: Math.max(toNumber(limit), 1),
      session_id: sessionId || undefined,
    },
  });

  return {
    session_id: response.data?.session_id != null ? toNumber(response.data.session_id) : null,
    source: String(response.data?.source || 'active_session'),
    items: Array.isArray(response.data?.items)
      ? response.data.items.map((row: any) => normalizeItem(row))
      : [],
  };
}

export async function getStockAuditHistory(): Promise<StockAuditSession[]> {
  const storeId = await requireStoreId();
  const response = await api.get('/inventory/history', {
    params: { store_id: storeId },
  });
  return Array.isArray(response.data?.sessions)
    ? response.data.sessions.map((row: any) => normalizeSession(row))
    : [];
}

export async function getStockAuditKpis(): Promise<StockAuditKpis> {
  const storeId = await requireStoreId();
  const response = await api.get('/inventory/kpis', {
    params: { store_id: storeId },
  });

  return {
    sessions_total: toNumber(response.data?.kpis?.sessions_total),
    sessions_active: toNumber(response.data?.kpis?.sessions_active),
    avg_accuracy_percent: toNumber(response.data?.kpis?.avg_accuracy_percent),
    total_reads: toNumber(response.data?.kpis?.total_reads),
    unique_epcs_total: toNumber(response.data?.kpis?.unique_epcs_total),
  };
}

export async function getStockAuditInsights({
  limit = 6,
  riskLimit = 40,
}: {
  limit?: number;
  riskLimit?: number;
} = {}): Promise<StockAuditInsights> {
  const storeId = await requireStoreId();
  const response = await api.get('/stock/insights', {
    params: {
      store_id: storeId,
      limit: Math.max(toNumber(limit), 1),
      risk_limit: Math.max(toNumber(riskLimit), 1),
    },
  });

  return {
    dead_stock: Array.isArray(response.data?.dead_stock)
      ? response.data.dead_stock.map((row: any) => normalizeRiskItem(row))
      : [],
    risks: response.data?.risks || {},
    risk_items: Array.isArray(response.data?.risk_items)
      ? response.data.risk_items.map((row: any) => normalizeRiskItem(row))
      : [],
    brand_risks: Array.isArray(response.data?.brand_risks)
      ? response.data.brand_risks.map((row: any) => normalizeBrandRisk(row))
      : [],
  };
}
