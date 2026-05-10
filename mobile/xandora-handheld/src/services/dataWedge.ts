import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

type DataWedgeNativeModule = {
  isAvailable: () => Promise<boolean>;
  configureProfile: () => Promise<{
    ok: boolean;
    profileName: string;
    intentAction: string;
  }>;
};

export type DataWedgeScanEvent = {
  data?: string | null;
  source?: string | null;
  labelType?: string | null;
  decodedMode?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
  receivedAt?: number | null;
};

const nativeModule: DataWedgeNativeModule | null =
  Platform.OS === 'android' && NativeModules.XandoraDataWedge
    ? (NativeModules.XandoraDataWedge as DataWedgeNativeModule)
    : null;

const eventEmitter = nativeModule ? new NativeEventEmitter(NativeModules.XandoraDataWedge) : null;

export async function isDataWedgeAvailable(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  try {
    return Boolean(await nativeModule.isAvailable());
  } catch {
    return false;
  }
}

export async function configureDataWedgeProfile() {
  if (!nativeModule) {
    throw new Error('Zebra DataWedge native module is not available on this platform.');
  }

  return nativeModule.configureProfile();
}

export function addDataWedgeScanListener(listener: (event: DataWedgeScanEvent) => void) {
  if (!eventEmitter) {
    return { remove() {} };
  }

  return eventEmitter.addListener('xandora.datawedge.scan', listener);
}
