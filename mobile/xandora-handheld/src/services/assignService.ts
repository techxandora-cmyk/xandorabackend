import api from './api';
import { getAuthSession } from './session';

function normalizeBarcode(value: string): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeRfids(values: string[]): string[] {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim().toUpperCase())
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

  return storeId;
}

export const verifyBarcode = async (barcode: string) => {
  const storeId = await requireStoreId();
  const normalizedBarcode = normalizeBarcode(barcode);

  const response = await api.get('/catalog/lookup', {
    params: {
      store_id: storeId,
      barcode: normalizedBarcode,
      limit: 250,
    },
  });

  return {
    storeId,
    barcode: normalizedBarcode,
    totalQuantity: Number(response.data?.count || 0),
    items: Array.isArray(response.data?.items) ? response.data.items : [],
  };
};

export const submitAssignment = async (data: {
  barcode: string;
  quantity: number;
  rfids: string[];
  deviceId?: string | null;
}) => {
  const storeId = await requireStoreId();
  const rfids = normalizeRfids(data.rfids);

  const response = await api.post('/catalog/assign-items', {
    store_id: storeId,
    barcode: normalizeBarcode(data.barcode),
    quantity: Number(data.quantity || rfids.length || 0),
    epcs: rfids,
    device_id: String(data.deviceId || '').trim() || null,
  });

  return response.data?.assignment || response.data;
};
