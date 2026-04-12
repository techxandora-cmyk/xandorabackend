import api from './api';
import {
  getAccessibleStores,
  getAuthSession,
} from './session';

function normalizeRfids(values: string[]): string[] {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

export const getStores = async () => {
  const session = await getAuthSession();
  return getAccessibleStores(session?.user);
};

export const assignToStore = async (data: {
  rfids: string[];
  storeId: string;
  deviceId?: string | null;
}) => {
  const session = await getAuthSession();
  const sourceStoreId =
    session?.currentStoreId ||
    session?.user?.default_store_id ||
    session?.user?.store_ids?.[0] ||
    '';

  if (!sourceStoreId) {
    throw new Error('No source store is assigned to this handheld account');
  }

  const destinationStoreId = String(data.storeId || '').trim().toUpperCase();
  if (!destinationStoreId) {
    throw new Error('Destination store is required');
  }

  const response = await api.post('/catalog/transfer', {
    source_store_id: sourceStoreId,
    destination_store_id: destinationStoreId,
    epcs: normalizeRfids(data.rfids),
    device_id: String(data.deviceId || '').trim() || null,
  });

  return response.data?.transfer || response.data;
};
