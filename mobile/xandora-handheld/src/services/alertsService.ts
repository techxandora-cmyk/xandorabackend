import api from './api';
import { getAuthSession } from './session';

export type MobileAlert = {
  id: number;
  type: string;
  status: string;
  severity: number;
  entity_type?: string | null;
  entity_id?: string | null;
  last_detected_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

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

export async function getStoreAlerts(limit = 20): Promise<MobileAlert[]> {
  const storeId = await requireStoreId();
  const response = await api.get('/alerts', {
    params: {
      store_id: storeId,
    },
  });

  const alerts = Array.isArray(response.data?.alerts) ? response.data.alerts : [];
  return alerts.slice(0, Math.max(limit, 1));
}
