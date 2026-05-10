import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type ZebraRfidReader = {
  id: string;
  name: string;
  address: string;
  bonded: boolean;
  connected: boolean;
  type: string;
  backend: 'zebra_rfid';
};

export type ZebraRfidScanEvent = {
  data?: string | null;
  source?: string | null;
  readerName?: string | null;
  readerAddress?: string | null;
  receivedAt?: number | null;
};

export type ZebraRfidStatusEvent = {
  status?: string | null;
  inventoryRunning?: boolean;
  emittedAt?: number | null;
  device?: ZebraRfidReader | null;
};

type ZebraRfidNativeModule = {
  isAvailable: () => Promise<boolean>;
  getAvailableReaders: () => Promise<ZebraRfidReader[]>;
  connect: (address: string) => Promise<ZebraRfidReader>;
  disconnect: () => Promise<boolean>;
  startInventory: () => Promise<boolean>;
  stopInventory: () => Promise<boolean>;
};

const nativeModule: ZebraRfidNativeModule | null =
  Platform.OS === 'android' && NativeModules.XandoraZebraRfid
    ? (NativeModules.XandoraZebraRfid as ZebraRfidNativeModule)
    : null;

const eventEmitter = nativeModule ? new NativeEventEmitter(NativeModules.XandoraZebraRfid) : null;

export async function isZebraRfidAvailable(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  try {
    return Boolean(await nativeModule.isAvailable());
  } catch {
    return false;
  }
}

export async function getAvailableZebraReaders(): Promise<ZebraRfidReader[]> {
  if (!nativeModule) {
    return [];
  }

  const readers = await nativeModule.getAvailableReaders();
  return Array.isArray(readers) ? readers : [];
}

export async function connectZebraReader(address: string) {
  if (!nativeModule) {
    throw new Error('Zebra RFID native module is not available on this platform.');
  }

  return nativeModule.connect(String(address || '').trim());
}

export async function disconnectZebraReader() {
  if (!nativeModule) {
    return false;
  }

  return nativeModule.disconnect();
}

export async function startZebraInventory() {
  if (!nativeModule) {
    return false;
  }

  return nativeModule.startInventory();
}

export async function stopZebraInventory() {
  if (!nativeModule) {
    return false;
  }

  return nativeModule.stopInventory();
}

export function addZebraScanListener(listener: (event: ZebraRfidScanEvent) => void) {
  if (!eventEmitter) {
    return { remove() {} };
  }

  return eventEmitter.addListener('xandora.zebra.scan', listener);
}

export function addZebraStatusListener(listener: (event: ZebraRfidStatusEvent) => void) {
  if (!eventEmitter) {
    return { remove() {} };
  }

  return eventEmitter.addListener('xandora.zebra.status', listener);
}
