import api from './api';
import { getAuthSession } from './session';

export type RetailBillingSummary = {
  expected_items_count: number;
  scanned_items_count: number;
  matched_items_count: number;
  missing_items_count: number;
  accuracy_percent: number;
  total_reads: number;
  duplicate_count: number;
  unknown_count: number;
  already_billed_count: number;
  validation_failed_count: number;
  duration_seconds: number;
  read_rate: number;
};

export type RetailBillingSession = {
  id?: number | null;
  session_id?: string | null;
  store_id?: string | null;
  device_id?: string | null;
  status?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number;
  expected_items_count?: number;
  scanned_items_count?: number;
  matched_items_count?: number;
  missing_items_count?: number;
  accuracy_percent?: number;
  read_rate?: number;
  total_reads?: number;
  metrics_summary?: Partial<RetailBillingSummary> | null;
};

export type RetailValidation = {
  validation_status: string;
  validation_label?: string | null;
  validation_message?: string | null;
  already_billed?: boolean;
  catalog_item?: {
    epc?: string | null;
    sku?: string | null;
    product_name?: string | null;
    price_lkr?: number | null;
  } | null;
};

export type RetailScanRecord = {
  epc: string;
  read_count?: number;
  device_id?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  validation_status?: string | null;
  validation_label?: string | null;
  validation_message?: string | null;
  sku?: string | null;
  product_name?: string | null;
  price_lkr?: number | null;
};

export type RetailDevice = {
  id?: number | null;
  device_id?: string | null;
  name?: string | null;
  display_name?: string | null;
  device_type?: string | null;
  store_id?: string | null;
  location?: string | null;
  location_label?: string | null;
  zone?: string | null;
  zone_label?: string | null;
  status?: string | null;
  last_seen?: string | null;
  last_heartbeat?: string | null;
  updated_at?: string | null;
  section_profile?: string | null;
  provisioning_state?: string | null;
  connectivity_state?: string | null;
  lifecycle_state?: string | null;
  reader_identity?: Record<string, unknown> | null;
  connectivity?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type RetailSectionProfile = {
  id: string;
  label: string;
  description?: string | null;
  default_zone_role?: string | null;
};

export type RetailCatalogItem = {
  store_id: string;
  epc: string;
  barcode?: string | null;
  sku?: string | null;
  product_name?: string | null;
  brand?: string | null;
  category?: string | null;
  size_label?: string | null;
  color?: string | null;
  price_lkr?: number | null;
  updated_at?: string | null;
  found?: boolean;
};

export type RetailItemStatusResult =
  | {
      kind: 'epc';
      query: string;
      found: true;
      item: RetailCatalogItem;
      matched_store_id: string;
      current_store_id: string;
      status_label: string;
      status_detail: string;
    }
  | {
      kind: 'epc';
      query: string;
      found: false;
      current_store_id: string;
      status_label: string;
      status_detail: string;
    }
  | {
      kind: 'barcode';
      query: string;
      count: number;
      current_store_id: string;
      items: RetailCatalogItem[];
      status_label: string;
      status_detail: string;
    };

type BillingState = {
  session: RetailBillingSession | null;
  summary: RetailBillingSummary;
  scans: RetailScanRecord[];
  source: string;
};

const EMPTY_SUMMARY: RetailBillingSummary = {
  expected_items_count: 0,
  scanned_items_count: 0,
  matched_items_count: 0,
  missing_items_count: 0,
  accuracy_percent: 0,
  total_reads: 0,
  duplicate_count: 0,
  unknown_count: 0,
  already_billed_count: 0,
  validation_failed_count: 0,
  duration_seconds: 0,
  read_rate: 0,
};

function normalizeStoreId(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeEpc(value: unknown): string {
  return String(value || '').trim().toUpperCase();
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

function normalizeSummary(summary: Partial<RetailBillingSummary> | null | undefined): RetailBillingSummary {
  return {
    ...EMPTY_SUMMARY,
    ...(summary || {}),
  };
}

function normalizeBarcode(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeCatalogItem(row: any): RetailCatalogItem {
  return {
    store_id: normalizeStoreId(row?.store_id),
    epc: normalizeEpc(row?.epc),
    barcode: row?.barcode ? normalizeBarcode(row.barcode) : null,
    sku: row?.sku || null,
    product_name: row?.product_name || null,
    brand: row?.brand || null,
    category: row?.category || null,
    size_label: row?.size_label || null,
    color: row?.color || null,
    price_lkr:
      row?.price_lkr != null && Number.isFinite(Number(row.price_lkr))
        ? Number(row.price_lkr)
        : null,
    updated_at: row?.updated_at || null,
    found: row?.found !== false,
  };
}

function normalizeScans(rows: unknown): RetailScanRecord[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row: any) => ({
    epc: normalizeEpc(row?.epc || row?.tag),
    read_count: Number(row?.read_count || 0),
    device_id: row?.device_id || null,
    first_seen: row?.first_seen || null,
    last_seen: row?.last_seen || null,
    validation_status: row?.validation_status || null,
    validation_label: row?.validation_label || null,
    validation_message: row?.validation_message || null,
    sku: row?.sku || null,
    product_name: row?.product_name || null,
    price_lkr:
      row?.price_lkr != null && Number.isFinite(Number(row.price_lkr))
        ? Number(row.price_lkr)
        : null,
  }));
}

export function retailHandheldDeviceId(storeId?: string | null): string {
  const suffix = normalizeStoreId(storeId || '').replace(/[^A-Z0-9_]/g, '');
  return suffix ? `HANDHELD_RETAIL_${suffix}` : 'HANDHELD_RETAIL_APP';
}

export async function getRetailBillingState(): Promise<BillingState> {
  const storeId = await requireStoreId();
  const [summaryRes, scansRes] = await Promise.all([
    api.get('/billing/summary', {
      params: { store_id: storeId },
    }),
    api.get('/billing/scans', {
      params: { store_id: storeId },
    }),
  ]);

  const session =
    (summaryRes.data?.session as RetailBillingSession | null | undefined) ||
    (scansRes.data?.session as RetailBillingSession | null | undefined) ||
    null;

  return {
    session,
    summary: normalizeSummary(summaryRes.data?.summary),
    scans: normalizeScans(scansRes.data?.scans),
    source: String(scansRes.data?.source || 'active_session'),
  };
}

export async function startRetailBillingSession(expectedItemsCount = 0) {
  const storeId = await requireStoreId();
  const response = await api.post('/billing/start', {
    store_id: storeId,
    expected_items_count: Math.max(Number(expectedItemsCount) || 0, 0),
    device_id: retailHandheldDeviceId(storeId),
  });
  return response.data?.session as RetailBillingSession | null;
}

export async function scanRetailBillingEpc(epc: string) {
  const storeId = await requireStoreId();
  const response = await api.post('/billing/scan', {
    store_id: storeId,
    epc: normalizeEpc(epc),
    device_id: retailHandheldDeviceId(storeId),
  });

  return {
    session: (response.data?.session as RetailBillingSession | null | undefined) || null,
    validation: (response.data?.validation as RetailValidation | null | undefined) || null,
    scan: (response.data?.scan as RetailScanRecord | null | undefined) || null,
  };
}

export async function completeRetailBillingSession() {
  const storeId = await requireStoreId();
  const response = await api.post('/billing/complete', {
    store_id: storeId,
  });
  return response.data?.session as RetailBillingSession | null;
}

export async function cancelRetailBillingSession() {
  const storeId = await requireStoreId();
  const response = await api.post('/billing/cancel', {
    store_id: storeId,
  });
  return response.data?.session as RetailBillingSession | null;
}

export async function getRetailDevices(
  storeIdOverride?: string | null,
  heartbeatMinutes = 3,
): Promise<RetailDevice[]> {
  const storeId = normalizeStoreId(storeIdOverride) || (await requireStoreId());
  const response = await api.get('/devices', {
    params: {
      store_id: storeId,
      heartbeat_minutes: heartbeatMinutes,
    },
  });

  return Array.isArray(response.data?.devices)
    ? (response.data.devices as RetailDevice[])
    : [];
}

export async function getRetailSectionProfiles(): Promise<RetailSectionProfile[]> {
  const response = await api.get('/devices/section-profiles');
  return Array.isArray(response.data?.profiles)
    ? response.data.profiles.map((profile: any) => ({
        id: String(profile?.id || '').trim().toUpperCase(),
        label: String(profile?.label || '').trim() || 'Unnamed zone',
        description: profile?.description ? String(profile.description).trim() : null,
        default_zone_role: profile?.default_zone_role
          ? String(profile.default_zone_role).trim().toUpperCase()
          : null,
      }))
    : [];
}

export async function assignRetailDeviceZone({
  deviceId,
  storeId,
  sectionProfileId,
  zoneLabel,
  locationLabel,
}: {
  deviceId: string;
  storeId?: string | null;
  sectionProfileId?: string | null;
  zoneLabel?: string | null;
  locationLabel?: string | null;
}): Promise<RetailDevice | null> {
  const resolvedStoreId = normalizeStoreId(storeId) || (await requireStoreId());
  const response = await api.put(`/devices/${encodeURIComponent(deviceId)}/zone-assignment`, {
    store_id: resolvedStoreId,
    section_profile: sectionProfileId ? String(sectionProfileId).trim().toUpperCase() : '',
    zone_label: zoneLabel != null ? String(zoneLabel).trim() : null,
    location_label: locationLabel != null ? String(locationLabel).trim() : null,
  });

  return (response.data?.device as RetailDevice | null | undefined) || null;
}

export async function lookupRetailItemStatusByEpc(epc: string): Promise<RetailItemStatusResult> {
  const session = await getAuthSession();
  const currentStoreId = await requireStoreId();
  const stores = Array.from(
    new Set(
      [
        currentStoreId,
        ...(Array.isArray(session?.user?.store_ids) ? session!.user.store_ids : []),
        session?.user?.default_store_id || '',
      ]
        .map((value) => normalizeStoreId(value))
        .filter(Boolean),
    ),
  );
  const normalizedEpc = normalizeEpc(epc);

  for (const storeId of stores) {
    const response = await api.get('/catalog/lookup', {
      params: {
        store_id: storeId,
        epc: normalizedEpc,
      },
    });

    if (response.data?.found && response.data?.item) {
      const item = normalizeCatalogItem(response.data.item);
      const inCurrentStore = storeId === currentStoreId;
      return {
        kind: 'epc',
        query: normalizedEpc,
        found: true,
        item,
        matched_store_id: storeId,
        current_store_id: currentStoreId,
        status_label: inCurrentStore ? 'Assigned to current store' : 'Assigned to another store',
        status_detail: inCurrentStore
          ? `This RFID is registered in ${currentStoreId}.`
          : `This RFID belongs to ${storeId}, not the current store.`,
      };
    }
  }

  return {
    kind: 'epc',
    query: normalizedEpc,
    found: false,
    current_store_id: currentStoreId,
    status_label: 'Unknown RFID',
    status_detail: 'This RFID was not found in the stores available to this handheld account.',
  };
}

export async function lookupRetailItemStatusByBarcode(barcode: string): Promise<RetailItemStatusResult> {
  const currentStoreId = await requireStoreId();
  const normalizedBarcode = normalizeBarcode(barcode);
  const response = await api.get('/catalog/lookup', {
    params: {
      store_id: currentStoreId,
      barcode: normalizedBarcode,
      limit: 20,
    },
  });

  const items = Array.isArray(response.data?.items)
    ? response.data.items.map((row: any) => normalizeCatalogItem(row))
    : [];
  const count = Number(response.data?.count || items.length || 0);

  return {
    kind: 'barcode',
    query: normalizedBarcode,
    count,
    current_store_id: currentStoreId,
    items,
    status_label: count > 0 ? 'Barcode found' : 'Barcode not found',
    status_detail:
      count > 0
        ? `${count} item${count === 1 ? '' : 's'} match this barcode in ${currentStoreId}.`
        : `No items with this barcode were found in ${currentStoreId}.`,
  };
}
