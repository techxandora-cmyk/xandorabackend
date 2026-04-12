import api from './api';
import { getAuthSession } from './session';

export type LaundrySummary = {
  total_items: number;
  item_types: number;
  in_stock: number;
  out_with_customer: number;
  in_wash: number;
  damaged_items: number;
  lost_items: number;
  retired_items: number;
  nearing_end_of_life: number;
  exceeded_cycles: number;
  avg_wash_cycles: number;
};

export type LaundryItemType = {
  id: number;
  company_name?: string | null;
  code?: string | null;
  name?: string | null;
  category?: string | null;
  fabric_type?: string | null;
  size_label?: string | null;
  unit_price?: number | null;
  max_wash_cycles?: number;
  warning_cycle_threshold?: number;
  notes?: string | null;
  created_at?: string | null;
  asset_count?: number;
  avg_wash_cycles?: number;
};

export type LaundryItem = {
  id: number;
  epc: string;
  item_type_id?: number | null;
  item_code?: string | null;
  item_name?: string | null;
  item_category?: string | null;
  fabric_type?: string | null;
  size_label?: string | null;
  unit_price?: number | null;
  status?: string | null;
  current_location?: string | null;
  assigned_to?: string | null;
  wash_cycle_count?: number;
  max_wash_cycles?: number;
  warning_cycle_threshold?: number;
  last_event_at?: string | null;
  created_at?: string | null;
  remaining_cycles?: number;
  lifecycle_state?: string | null;
  cycle_utilization_pct?: number;
  type_name?: string | null;
  type_code?: string | null;
};

export type LaundryEvent = {
  id: number;
  epc: string;
  event_type?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  cycle_increment?: number;
  wash_cycle_after?: number;
  location_label?: string | null;
  assigned_to?: string | null;
  reference_no?: string | null;
  notes?: string | null;
  actor_email?: string | null;
  created_at?: string | null;
  item_name?: string | null;
  item_category?: string | null;
};

export type LaundryAction =
  | 'receive'
  | 'audit'
  | 'wash_start'
  | 'wash_complete'
  | 'checkout'
  | 'dispatch'
  | 'mark_damaged'
  | 'mark_lost'
  | 'retire';

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

function normalizeSummary(row: any): LaundrySummary {
  return {
    total_items: Number(row?.total_items || 0),
    item_types: Number(row?.item_types || 0),
    in_stock: Number(row?.in_stock || 0),
    out_with_customer: Number(row?.out_with_customer || 0),
    in_wash: Number(row?.in_wash || 0),
    damaged_items: Number(row?.damaged_items || 0),
    lost_items: Number(row?.lost_items || 0),
    retired_items: Number(row?.retired_items || 0),
    nearing_end_of_life: Number(row?.nearing_end_of_life || 0),
    exceeded_cycles: Number(row?.exceeded_cycles || 0),
    avg_wash_cycles: Number(row?.avg_wash_cycles || 0),
  };
}

function normalizeItemType(row: any): LaundryItemType {
  return {
    id: Number(row?.id || 0),
    company_name: row?.company_name || null,
    code: row?.code || null,
    name: row?.name || null,
    category: row?.category || null,
    fabric_type: row?.fabric_type || null,
    size_label: row?.size_label || null,
    unit_price:
      row?.unit_price != null && Number.isFinite(Number(row.unit_price))
        ? Number(row.unit_price)
        : null,
    max_wash_cycles: Number(row?.max_wash_cycles || 0),
    warning_cycle_threshold: Number(row?.warning_cycle_threshold || 0),
    notes: row?.notes || null,
    created_at: row?.created_at || null,
    asset_count: Number(row?.asset_count || 0),
    avg_wash_cycles: Number(row?.avg_wash_cycles || 0),
  };
}

function normalizeItem(row: any): LaundryItem {
  return {
    id: Number(row?.id || 0),
    epc: normalizeTag(row?.epc),
    item_type_id:
      row?.item_type_id != null && Number.isFinite(Number(row.item_type_id))
        ? Number(row.item_type_id)
        : null,
    item_code: row?.item_code || null,
    item_name: row?.item_name || null,
    item_category: row?.item_category || null,
    fabric_type: row?.fabric_type || null,
    size_label: row?.size_label || null,
    unit_price:
      row?.unit_price != null && Number.isFinite(Number(row.unit_price))
        ? Number(row.unit_price)
        : null,
    status: row?.status || null,
    current_location: row?.current_location || null,
    assigned_to: row?.assigned_to || null,
    wash_cycle_count: Number(row?.wash_cycle_count || 0),
    max_wash_cycles: Number(row?.max_wash_cycles || 0),
    warning_cycle_threshold: Number(row?.warning_cycle_threshold || 0),
    last_event_at: row?.last_event_at || null,
    created_at: row?.created_at || null,
    remaining_cycles: Number(row?.remaining_cycles || 0),
    lifecycle_state: row?.lifecycle_state || null,
    cycle_utilization_pct: Number(row?.cycle_utilization_pct || 0),
    type_name: row?.type_name || null,
    type_code: row?.type_code || null,
  };
}

function normalizeEvent(row: any): LaundryEvent {
  return {
    id: Number(row?.id || 0),
    epc: normalizeTag(row?.epc),
    event_type: row?.event_type || null,
    from_status: row?.from_status || null,
    to_status: row?.to_status || null,
    cycle_increment: Number(row?.cycle_increment || 0),
    wash_cycle_after: Number(row?.wash_cycle_after || 0),
    location_label: row?.location_label || null,
    assigned_to: row?.assigned_to || null,
    reference_no: row?.reference_no || null,
    notes: row?.notes || null,
    actor_email: row?.actor_email || null,
    created_at: row?.created_at || null,
    item_name: row?.item_name || null,
    item_category: row?.item_category || null,
  };
}

export async function getLaundrySummary(storeIdOverride?: string | null): Promise<LaundrySummary> {
  const storeId = normalizeStoreId(storeIdOverride) || (await requireStoreId());
  const response = await api.get('/laundry/summary', {
    params: { store_id: storeId },
  });

  return normalizeSummary(response.data?.summary || {});
}

export async function getLaundryItemTypes(
  storeIdOverride?: string | null,
): Promise<LaundryItemType[]> {
  const storeId = normalizeStoreId(storeIdOverride) || (await requireStoreId());
  const response = await api.get('/laundry/item-types', {
    params: { store_id: storeId },
  });

  return Array.isArray(response.data?.item_types)
    ? response.data.item_types.map((row: any) => normalizeItemType(row))
    : [];
}

export async function createLaundryItemType({
  storeId,
  name,
  fabricType,
  sizeLabel,
  maxWashCycles,
  warningCycleThreshold,
  notes,
}: {
  storeId?: string | null;
  name: string;
  fabricType?: string;
  sizeLabel?: string;
  maxWashCycles?: number;
  warningCycleThreshold?: number;
  notes?: string;
}): Promise<LaundryItemType> {
  const resolvedStoreId = normalizeStoreId(storeId) || (await requireStoreId());
  const response = await api.post('/laundry/item-types', {
    store_id: resolvedStoreId,
    name: String(name || '').trim(),
    fabric_type: String(fabricType || '').trim() || undefined,
    size_label: String(sizeLabel || '').trim() || undefined,
    max_wash_cycles:
      maxWashCycles != null && Number.isFinite(Number(maxWashCycles))
        ? Number(maxWashCycles)
        : undefined,
    warning_cycle_threshold:
      warningCycleThreshold != null && Number.isFinite(Number(warningCycleThreshold))
        ? Number(warningCycleThreshold)
        : undefined,
    notes: String(notes || '').trim() || undefined,
  });

  return normalizeItemType(response.data?.item_type || {});
}

export async function getLaundryItems({
  storeId,
  query,
  status,
  limit = 50,
}: {
  storeId?: string | null;
  query?: string;
  status?: string;
  limit?: number;
} = {}): Promise<LaundryItem[]> {
  const resolvedStoreId = normalizeStoreId(storeId) || (await requireStoreId());
  const params: Record<string, string | number> = {
    store_id: resolvedStoreId,
    limit: Math.max(Number(limit) || 50, 1),
  };

  if (String(query || '').trim()) {
    params.q = String(query).trim();
  }
  if (String(status || '').trim()) {
    params.status = String(status).trim().toUpperCase();
  }

  const response = await api.get('/laundry/items', { params });
  return Array.isArray(response.data?.items)
    ? response.data.items.map((row: any) => normalizeItem(row))
    : [];
}

export async function getLaundryEvents(
  storeIdOverride?: string | null,
  limit = 20,
): Promise<LaundryEvent[]> {
  const storeId = normalizeStoreId(storeIdOverride) || (await requireStoreId());
  const response = await api.get('/laundry/events', {
    params: {
      store_id: storeId,
      limit: Math.max(Number(limit) || 20, 1),
    },
  });

  return Array.isArray(response.data?.events)
    ? response.data.events.map((row: any) => normalizeEvent(row))
    : [];
}

export async function getLaundryItemStatus(epc: string): Promise<LaundryItem | null> {
  const normalizedEpc = normalizeTag(epc);
  if (!normalizedEpc) {
    throw new Error('RFID is required');
  }

  const items = await getLaundryItems({
    query: normalizedEpc,
    limit: 25,
  });

  const exactMatch =
    items.find(item => normalizeTag(item.epc) === normalizedEpc) ||
    items[0] ||
    null;

  return exactMatch;
}

export async function runLaundryAction({
  action,
  epcs,
  storeId,
  locationLabel,
  assignedTo,
  referenceNo,
  notes,
  cycleIncrement,
}: {
  action: LaundryAction;
  epcs: string[];
  storeId?: string | null;
  locationLabel?: string;
  assignedTo?: string;
  referenceNo?: string;
  notes?: string;
  cycleIncrement?: number;
}): Promise<{
  action: LaundryAction;
  processed: number;
  items: LaundryItem[];
}> {
  const resolvedStoreId = normalizeStoreId(storeId) || (await requireStoreId());
  const normalizedEpcs = normalizeTags(epcs);

  if (!normalizedEpcs.length) {
    throw new Error('At least one RFID is required');
  }

  const response = await api.post('/laundry/actions', {
    store_id: resolvedStoreId,
    action,
    epcs: normalizedEpcs,
    location_label: String(locationLabel || '').trim() || undefined,
    assigned_to: String(assignedTo || '').trim() || undefined,
    reference_no: String(referenceNo || '').trim() || undefined,
    notes: String(notes || '').trim() || undefined,
    cycle_increment:
      cycleIncrement != null && Number.isFinite(Number(cycleIncrement))
        ? Number(cycleIncrement)
        : undefined,
  });

  return {
    action: String(response.data?.action || action).trim().toLowerCase() as LaundryAction,
    processed: Number(response.data?.processed || 0),
    items: Array.isArray(response.data?.items)
      ? response.data.items.map((row: any) => normalizeItem(row))
      : [],
  };
}

export async function registerLaundryItems({
  itemTypeId,
  epcs,
  storeId,
  currentLocation = 'Laundry stock',
  notes,
}: {
  itemTypeId: number;
  epcs: string[];
  storeId?: string | null;
  currentLocation?: string;
  notes?: string;
}): Promise<{
  processed: number;
  items: LaundryItem[];
  failed: { epc: string; error: string }[];
}> {
  const resolvedStoreId = normalizeStoreId(storeId) || (await requireStoreId());
  const normalizedEpcs = normalizeTags(epcs);

  if (!Number.isInteger(Number(itemTypeId)) || Number(itemTypeId) <= 0) {
    throw new Error('Select a fabric type first');
  }

  if (!normalizedEpcs.length) {
    throw new Error('Scan at least one RFID label first');
  }

  const items: LaundryItem[] = [];
  const failed: { epc: string; error: string }[] = [];

  for (const epc of normalizedEpcs) {
    try {
      const response = await api.post('/laundry/items/register', {
        store_id: resolvedStoreId,
        epc,
        item_type_id: Number(itemTypeId),
        current_location: String(currentLocation || '').trim() || undefined,
        notes: String(notes || '').trim() || undefined,
      });

      if (response.data?.item) {
        items.push(normalizeItem(response.data.item));
      }
    } catch (error: any) {
      failed.push({
        epc,
        error:
          error?.response?.data?.error ||
          error?.message ||
          'Could not register this RFID label',
      });
    }
  }

  return {
    processed: items.length,
    items,
    failed,
  };
}
