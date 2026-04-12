import api from './api';
import { getAuthSession } from './session';

export type AuditTagRecord = {
  rfid: string;
  barcode: string;
  itemName: string;
  sku: string;
  brand: string;
  sizeLabel: string;
  found?: boolean;
};

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

export const getAuditTagDetails = async (
  rfids: string[],
): Promise<AuditTagRecord[]> => {
  const storeId = await requireStoreId();
  const normalizedRfids = normalizeRfids(rfids);

  const response = await api.post('/catalog/lookup/batch', {
    store_id: storeId,
    epcs: normalizedRfids,
  });

  const items = Array.isArray(response.data?.items) ? response.data.items : [];

  return items.map((item: any) => ({
    rfid: String(item.epc || '').trim().toUpperCase(),
    barcode: String(item.barcode || 'UNMATCHED').trim().toUpperCase(),
    itemName: String(item.product_name || 'Unknown Item').trim(),
    sku: String(item.sku || 'NOT-MAPPED').trim(),
    brand: String(item.brand || 'Unbranded').trim(),
    sizeLabel: String(item.size_label || 'Unspecified').trim(),
    found: Boolean(item.found),
  }));
};

export const filterAuditItemsByBarcode = async (
  barcode: string,
  scannedItems: AuditTagRecord[],
): Promise<AuditTagRecord[]> => {
  return new Promise((resolve, reject) => {
    const normalizedBarcode = String(barcode || '').trim().toUpperCase();
    const matchingItems = (Array.isArray(scannedItems) ? scannedItems : []).filter(
      (item) => String(item.barcode || '').trim().toUpperCase() === normalizedBarcode,
    );

    if (matchingItems.length === 0) {
      reject(new Error('No scanned items found for this barcode.'));
      return;
    }

    resolve(matchingItems);
  });
};
