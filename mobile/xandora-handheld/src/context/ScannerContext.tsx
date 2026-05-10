import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import RNBluetoothClassic, {
  BluetoothDevice,
  BluetoothEventSubscription,
} from 'react-native-bluetooth-classic';
import {
  addDataWedgeScanListener,
  configureDataWedgeProfile,
  isDataWedgeAvailable,
} from '../services/dataWedge';
import {
  addZebraScanListener,
  addZebraStatusListener,
  connectZebraReader,
  disconnectZebraReader,
  getAvailableZebraReaders,
  isZebraRfidAvailable,
  startZebraInventory,
  stopZebraInventory,
  type ZebraRfidReader,
  type ZebraRfidStatusEvent,
} from '../services/zebraRfid';

const SCANNER_DEVICE_KEY = 'xandoraScannerDeviceTarget';
const SCANNER_CONNECTION_OPTIONS = {
  connectionType: 'delimited',
  delimiter: '\n',
  charset: 'utf-8',
  readSize: 1024,
  secureSocket: false,
};
const RFID_DEDUPE_WINDOW_MS = 1200;

export type ScannerDeviceBackend = 'bluetooth_classic' | 'datawedge' | 'zebra_rfid';

export type ScannerDeviceInfo = {
  id: string;
  name: string;
  address: string;
  bonded: boolean;
  connected: boolean;
  type: string;
  backend: ScannerDeviceBackend;
};

type StoredScannerTarget = {
  id: string;
  address: string;
  backend: ScannerDeviceBackend;
};

type ScannerContextValue = {
  scannerConnected: boolean;
  scannerConnecting: boolean;
  scannerDiscovering: boolean;
  scannerAvailable: boolean;
  bluetoothEnabled: boolean;
  scannerError: string;
  connectedDevice: ScannerDeviceInfo | null;
  pairedDevices: ScannerDeviceInfo[];
  discoveredDevices: ScannerDeviceInfo[];
  rfidReaders: ScannerDeviceInfo[];
  scannerPickerVisible: boolean;
  connectScanner: (targetId?: string) => Promise<void>;
  disconnectScanner: () => Promise<void>;
  refreshScannerDevices: () => Promise<void>;
  discoverScannerDevices: () => Promise<void>;
  requestBluetoothReady: () => Promise<boolean>;
  openScannerPicker: () => void;
  closeScannerPicker: () => void;
  openBluetoothSettings: () => void;
  addScanListener: (listener: (payload: string) => void) => () => void;
  startScanSession: () => void;
  stopScanSession: () => void;
};

const ScannerContext = createContext<ScannerContextValue | undefined>(undefined);

function buildDeviceId(backend: ScannerDeviceBackend, address: string) {
  switch (backend) {
    case 'bluetooth_classic':
      return `BT::${address}`;
    case 'zebra_rfid':
      return `ZEBRA::${address}`;
    case 'datawedge':
      return 'DATAWEDGE';
    default:
      return address;
  }
}

function createDeviceInfo(input: Partial<ScannerDeviceInfo> & {
  address: string;
  backend: ScannerDeviceBackend;
}): ScannerDeviceInfo {
  const address = String(input.address || '').trim();
  const backend = input.backend;
  return {
    id: String(input.id || buildDeviceId(backend, address)),
    name: String(input.name || address || 'Scanner'),
    address,
    bonded: Boolean(input.bonded),
    connected: Boolean(input.connected),
    type: String(input.type || 'UNKNOWN'),
    backend,
  };
}

function normalizeBluetoothDevice(
  device: Partial<BluetoothDevice> | null | undefined,
  connected = false,
): ScannerDeviceInfo | null {
  if (!device?.address) {
    return null;
  }

  return createDeviceInfo({
    name: String(device.name || device.address),
    address: String(device.address),
    bonded: Boolean(device.bonded),
    connected,
    type: String(device.type || 'UNKNOWN'),
    backend: 'bluetooth_classic',
  });
}

function normalizeZebraReader(
  reader: ZebraRfidReader | null | undefined,
  connected = false,
): ScannerDeviceInfo | null {
  if (!reader?.address) {
    return null;
  }

  return createDeviceInfo({
    id: String(reader.id || buildDeviceId('zebra_rfid', reader.address)),
    name: String(reader.name || reader.address),
    address: String(reader.address),
    bonded: true,
    connected: connected || Boolean(reader.connected),
    type: String(reader.type || 'ZEBRA_RFID'),
    backend: 'zebra_rfid',
  });
}

function mergeDevices(...groups: ScannerDeviceInfo[][]): ScannerDeviceInfo[] {
  const bucket = new Map<string, ScannerDeviceInfo>();

  groups.flat().forEach(device => {
    if (!device) {
      return;
    }

    const existing = bucket.get(device.id);
    bucket.set(device.id, {
      ...existing,
      ...device,
      bonded: Boolean(device.bonded || existing?.bonded),
      connected: Boolean(device.connected || existing?.connected),
    });
  });

  return Array.from(bucket.values()).sort((left, right) => {
    if (left.connected && !right.connected) return -1;
    if (!left.connected && right.connected) return 1;
    if (left.backend === 'zebra_rfid' && right.backend !== 'zebra_rfid') return -1;
    if (left.backend !== 'zebra_rfid' && right.backend === 'zebra_rfid') return 1;
    if (left.bonded && !right.bonded) return -1;
    if (!left.bonded && right.bonded) return 1;
    return left.name.localeCompare(right.name);
  });
}

function serializeStoredTarget(device: ScannerDeviceInfo) {
  return JSON.stringify({
    id: device.id,
    address: device.address,
    backend: device.backend,
  });
}

function parseStoredTarget(value: string | null): StoredScannerTarget | null {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const backend = String(parsed.backend || '').trim() as ScannerDeviceBackend;
      const address = String(parsed.address || '').trim();
      if (backend && address) {
        return {
          backend,
          address,
          id: String(parsed.id || buildDeviceId(backend, address)),
        };
      }
    }
  } catch {
    // Fall through to legacy string support.
  }

  if (raw.startsWith('ZEBRA::')) {
    const address = raw.replace(/^ZEBRA::/, '');
    return { id: raw, address, backend: 'zebra_rfid' };
  }

  if (raw.startsWith('BT::')) {
    const address = raw.replace(/^BT::/, '');
    return { id: raw, address, backend: 'bluetooth_classic' };
  }

  return {
    id: buildDeviceId('bluetooth_classic', raw),
    address: raw,
    backend: 'bluetooth_classic',
  };
}

function looksLikeZebraRfidDevice(device: Pick<ScannerDeviceInfo, 'name' | 'backend'> | null | undefined) {
  if (!device) {
    return false;
  }

  if (device.backend === 'zebra_rfid') {
    return true;
  }

  const name = String(device.name || '').trim();
  return /RFD\d+/i.test(name) || /Zebra RFID/i.test(name);
}

function extractRfdSerialToken(value: string) {
  const match = String(value || '')
    .toUpperCase()
    .match(/([0-9A-F]{10,})/);
  return match?.[1] || '';
}

function samePhysicalScanner(left: ScannerDeviceInfo, right: ScannerDeviceInfo) {
  const leftAddress = String(left.address || '').trim().toUpperCase();
  const rightAddress = String(right.address || '').trim().toUpperCase();
  if (leftAddress && rightAddress && leftAddress === rightAddress) {
    return true;
  }

  const leftSerial = extractRfdSerialToken(left.name);
  const rightSerial = extractRfdSerialToken(right.name);
  return Boolean(leftSerial && rightSerial && leftSerial === rightSerial);
}

function findMatchingZebraReader(
  target: StoredScannerTarget,
  knownDevices: ScannerDeviceInfo[],
  zebraReaders: ScannerDeviceInfo[],
): ScannerDeviceInfo | null {
  const candidate = knownDevices.find(device => {
    if (device.id === target.id) {
      return true;
    }
    return (
      device.backend === target.backend &&
      device.address.toUpperCase() === target.address.toUpperCase()
    );
  });

  if (!looksLikeZebraRfidDevice(candidate)) {
    return null;
  }

  const candidateName = String(candidate?.name || '').trim().toUpperCase();
  const candidateSerial = extractRfdSerialToken(candidateName);

  return (
    zebraReaders.find(reader => {
      const readerName = String(reader.name || '').trim().toUpperCase();
      const readerAddress = String(reader.address || '').trim().toUpperCase();

      if (candidateName && readerName === candidateName) {
        return true;
      }

      if (candidateSerial && (readerName.includes(candidateSerial) || readerAddress.includes(candidateSerial))) {
        return true;
      }

      return false;
    }) || null
  );
}

async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const sdkVersion = Number(Platform.Version || 0);
  const permissions =
    sdkVersion >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const statuses = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every(
    permission => statuses[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
}

export const ScannerProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [scannerConnecting, setScannerConnecting] = useState(false);
  const [scannerDiscovering, setScannerDiscovering] = useState(false);
  const [scannerAvailable, setScannerAvailable] = useState(false);
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [classicConnectedDevice, setClassicConnectedDevice] = useState<ScannerDeviceInfo | null>(null);
  const [dataWedgeAvailable, setDataWedgeAvailable] = useState(false);
  const [dataWedgeReady, setDataWedgeReady] = useState(false);
  const [zebraAvailable, setZebraAvailable] = useState(false);
  const [zebraConnectedDevice, setZebraConnectedDevice] = useState<ScannerDeviceInfo | null>(null);
  const [pairedDevices, setPairedDevices] = useState<ScannerDeviceInfo[]>([]);
  const [discoveredDevices, setDiscoveredDevices] = useState<ScannerDeviceInfo[]>([]);
  const [rfidReaders, setRfidReaders] = useState<ScannerDeviceInfo[]>([]);
  const [scannerPickerVisible, setScannerPickerVisible] = useState(false);

  const scanListenersRef = useRef(new Set<(payload: string) => void>());
  const bluetoothDeviceRef = useRef<BluetoothDevice | null>(null);
  const dataSubscriptionRef = useRef<BluetoothEventSubscription | null>(null);
  const deviceDisconnectedRef = useRef<BluetoothEventSubscription | null>(null);
  const stateChangedRef = useRef<BluetoothEventSubscription | null>(null);
  const deviceConnectedRef = useRef<BluetoothEventSubscription | null>(null);
  const activeScanSessionsRef = useRef(0);
  const zebraInventoryRunningRef = useRef(false);
  const recentScanTimestampsRef = useRef(new Map<string, number>());
  const connectScannerRef = useRef<(targetId?: string) => Promise<void>>(async () => undefined);
  const bootstrapDoneRef = useRef(false);
  const mountedRef = useRef(true);
  const refreshZebraReadersRef = useRef<() => Promise<ScannerDeviceInfo[]>>(async () => []);

  const emitScanPayload = useCallback(
    (
      rawValue: string,
      options: {
        source?: string;
        dedupeWindowMs?: number;
      } = {},
    ) => {
      const dedupeWindowMs = Math.max(Number(options.dedupeWindowMs || 0), 0);
      const source = String(options.source || 'generic').trim().toLowerCase() || 'generic';
      const now = Date.now();

      const values = String(rawValue || '')
        .split(/[\r\n]+/)
        .map(value => value.trim())
        .filter(Boolean);

      values.forEach(value => {
        if (dedupeWindowMs > 0) {
          const key = `${source}:${value}`;
          const previous = recentScanTimestampsRef.current.get(key) || 0;
          if (now - previous < dedupeWindowMs) {
            return;
          }
          recentScanTimestampsRef.current.set(key, now);
        }

        scanListenersRef.current.forEach(listener => {
          try {
            listener(value);
          } catch {
            // Keep scanner fan-out resilient even if one screen listener fails.
          }
        });
      });

      if (recentScanTimestampsRef.current.size > 200) {
        recentScanTimestampsRef.current.forEach((timestamp, key) => {
          if (now - timestamp > dedupeWindowMs + 5000) {
            recentScanTimestampsRef.current.delete(key);
          }
        });
      }
    },
    [],
  );

  const addScanListener = useCallback((listener: (payload: string) => void) => {
    scanListenersRef.current.add(listener);
    return () => {
      scanListenersRef.current.delete(listener);
    };
  }, []);

  const detachBluetoothReadListener = useCallback(() => {
    dataSubscriptionRef.current?.remove();
    dataSubscriptionRef.current = null;
  }, []);

  const attachBluetoothReadListener = useCallback(
    (device: BluetoothDevice | null) => {
      detachBluetoothReadListener();

      if (!device) {
        return;
      }

      dataSubscriptionRef.current = device.onDataReceived(event => {
        emitScanPayload(event.data, { source: 'bluetooth_classic' });
      });
    },
    [detachBluetoothReadListener, emitScanPayload],
  );

  const setClassicConnectedDeviceState = useCallback(
    (device: BluetoothDevice | null) => {
      bluetoothDeviceRef.current = device;
      const normalized = normalizeBluetoothDevice(device, Boolean(device));
      setClassicConnectedDevice(normalized);
      attachBluetoothReadListener(device);
    },
    [attachBluetoothReadListener],
  );

  const refreshBluetoothDevices = useCallback(async () => {
    try {
      const paired = await RNBluetoothClassic.getBondedDevices();
      const currentConnectedAddress = bluetoothDeviceRef.current?.address || null;
      const normalizedPaired = paired
        .map(device => normalizeBluetoothDevice(device, device.address === currentConnectedAddress))
        .filter((device): device is ScannerDeviceInfo => Boolean(device));

      setPairedDevices(normalizedPaired);
      setDiscoveredDevices(current =>
        mergeDevices(
          current.filter(device => device.backend !== 'bluetooth_classic'),
          mergeDevices(current, normalizedPaired).filter(
            device =>
              device.backend === 'bluetooth_classic' &&
              !normalizedPaired.some(pairedDevice => pairedDevice.id === device.id),
          ),
        ),
      );
    } catch (error: any) {
      setScannerError(error?.message || 'Could not load paired Bluetooth scanners.');
    }
  }, []);

  const requestBluetoothReady = useCallback(async (): Promise<boolean> => {
    try {
      const permissionsGranted = await requestBluetoothPermissions();
      if (!permissionsGranted) {
        setScannerError('Bluetooth permission was not granted.');
        return false;
      }

      const available = await RNBluetoothClassic.isBluetoothAvailable();
      setScannerAvailable(available);
      if (!available) {
        setScannerError('Bluetooth is not available on this device.');
        return false;
      }

      let enabled = await RNBluetoothClassic.isBluetoothEnabled();
      if (!enabled && Platform.OS === 'android') {
        enabled = await RNBluetoothClassic.requestBluetoothEnabled();
      }

      setBluetoothEnabled(Boolean(enabled));

      if (!enabled) {
        setScannerError('Bluetooth is turned off.');
        return false;
      }

      await refreshBluetoothDevices();
      return true;
    } catch (error: any) {
      setScannerError(error?.message || 'Bluetooth is not ready.');
      return false;
    }
  }, [refreshBluetoothDevices]);

  const refreshZebraReaders = useCallback(async () => {
    try {
      const available = await isZebraRfidAvailable();
      setZebraAvailable(available);

      if (!available) {
        setRfidReaders([]);
        return [];
      }

      const readers = await getAvailableZebraReaders();
      const normalized = readers
        .map(reader => normalizeZebraReader(reader, zebraConnectedDevice?.address === reader.address))
        .filter((device): device is ScannerDeviceInfo => Boolean(device));

      setRfidReaders(normalized);
      return normalized;
    } catch (error: any) {
      setScannerError(error?.message || 'Could not load Zebra RFID readers.');
      return [];
    }
  }, [zebraConnectedDevice?.address]);

  const refreshScannerDevices = useCallback(async () => {
    setScannerDiscovering(true);
    setScannerError('');

    try {
      const ready = await requestBluetoothReady();
      if (!ready) {
        return;
      }

      await refreshZebraReaders();
    } finally {
      setScannerDiscovering(false);
    }
  }, [refreshZebraReaders, requestBluetoothReady]);

  const ensureZebraInventoryRunning = useCallback(async () => {
    if (!zebraConnectedDevice || activeScanSessionsRef.current <= 0 || zebraInventoryRunningRef.current) {
      return;
    }

    try {
      const started = await startZebraInventory();
      if (started) {
        zebraInventoryRunningRef.current = true;
        setScannerError('');
      }
    } catch (error: any) {
      setScannerError(error?.message || 'RFID inventory failed to start.');
    }
  }, [zebraConnectedDevice]);

  const startScanSession = useCallback(() => {
    activeScanSessionsRef.current += 1;

    if (activeScanSessionsRef.current === 1) {
      ensureZebraInventoryRunning().catch(() => undefined);
    }
  }, [ensureZebraInventoryRunning]);

  const stopScanSession = useCallback(() => {
    activeScanSessionsRef.current = Math.max(activeScanSessionsRef.current - 1, 0);

    if (zebraConnectedDevice && activeScanSessionsRef.current === 0) {
      stopZebraInventory()
        .then(() => {
          zebraInventoryRunningRef.current = false;
        })
        .catch(() => undefined);
    }
  }, [zebraConnectedDevice]);

  useEffect(() => {
    if (!zebraConnectedDevice || activeScanSessionsRef.current <= 0) {
      return;
    }

    ensureZebraInventoryRunning().catch(() => undefined);
  }, [ensureZebraInventoryRunning, zebraConnectedDevice]);

  const disconnectScanner = useCallback(async () => {
    try {
      if (zebraConnectedDevice) {
        await stopZebraInventory().catch(() => false);
        zebraInventoryRunningRef.current = false;
        await disconnectZebraReader();
        setZebraConnectedDevice(null);
        await refreshZebraReaders();
      }

      const bluetoothDevice = bluetoothDeviceRef.current;
      if (bluetoothDevice) {
        await bluetoothDevice.disconnect();
        setClassicConnectedDeviceState(null);
        await refreshBluetoothDevices();
      }
    } catch {
      // Swallow disconnect errors to keep UI consistent.
    } finally {
      await AsyncStorage.removeItem(SCANNER_DEVICE_KEY);
      setScannerPickerVisible(false);
    }
  }, [
    refreshBluetoothDevices,
    refreshZebraReaders,
    setClassicConnectedDeviceState,
    zebraConnectedDevice,
  ]);

  const connectScanner = useCallback(
    async (targetId?: string) => {
      if (!targetId) {
        setScannerPickerVisible(true);
        return;
      }

      const parsedTarget = parseStoredTarget(targetId);
      if (!parsedTarget) {
        setScannerPickerVisible(true);
        return;
      }

      setScannerConnecting(true);
      setScannerError('');

      try {
        const ready = await requestBluetoothReady();
        if (!ready) {
          return;
        }

        const availableZebraReaders = await refreshZebraReaders();
        const knownDevices = mergeDevices(pairedDevices, discoveredDevices);
        const zebraMatch =
          parsedTarget.backend === 'bluetooth_classic'
            ? findMatchingZebraReader(parsedTarget, knownDevices, availableZebraReaders)
            : null;
        const effectiveTarget = zebraMatch
          ? {
              id: zebraMatch.id,
              address: zebraMatch.address,
              backend: 'zebra_rfid' as const,
            }
          : parsedTarget;

        if (effectiveTarget.backend === 'zebra_rfid') {
          const bluetoothDevice = bluetoothDeviceRef.current;
          if (bluetoothDevice) {
            await bluetoothDevice.disconnect();
            setClassicConnectedDeviceState(null);
          }

          if (
            zebraConnectedDevice &&
            zebraConnectedDevice.address !== effectiveTarget.address
          ) {
            await disconnectZebraReader();
            setZebraConnectedDevice(null);
          }

          const resolvedZebraTarget =
            availableZebraReaders.find(reader => samePhysicalScanner(reader, {
              ...effectiveTarget,
              name: zebraMatch?.name || parsedTarget.address,
              bonded: true,
              connected: false,
              type: 'ZEBRA_RFID',
            })) || zebraMatch;

          const reader = await connectZebraReader(
            String(resolvedZebraTarget?.address || effectiveTarget.address),
          );
          const normalized = normalizeZebraReader(reader, true);
          if (!normalized) {
            throw new Error('The Zebra reader did not return a usable connection payload.');
          }

          setZebraConnectedDevice(normalized);
          await AsyncStorage.setItem(SCANNER_DEVICE_KEY, serializeStoredTarget(normalized));
          await refreshZebraReaders();
          setScannerPickerVisible(false);
          return;
        }

        if (zebraConnectedDevice) {
          await stopZebraInventory().catch(() => false);
          zebraInventoryRunningRef.current = false;
          await disconnectZebraReader();
          setZebraConnectedDevice(null);
          await refreshZebraReaders();
        }

        const currentClassicDevice = bluetoothDeviceRef.current;
        if (
          currentClassicDevice &&
          currentClassicDevice.address !== parsedTarget.address
        ) {
          await currentClassicDevice.disconnect();
          setClassicConnectedDeviceState(null);
        }

        const device = await RNBluetoothClassic.connectToDevice(
          parsedTarget.address,
          SCANNER_CONNECTION_OPTIONS,
        );

        setClassicConnectedDeviceState(device);
        const normalized = normalizeBluetoothDevice(device, true);
        if (normalized) {
          await AsyncStorage.setItem(SCANNER_DEVICE_KEY, serializeStoredTarget(normalized));
        }
        await refreshBluetoothDevices();
        setScannerPickerVisible(false);
      } catch (error: any) {
        const msg = String(error?.message || 'Could not connect to this scanner.');
        setScannerError(msg);
        Alert.alert('Scanner connect failed', msg, [{ text: 'OK' }]);
      } finally {
        setScannerConnecting(false);
      }
    },
    [
      discoveredDevices,
      pairedDevices,
      refreshBluetoothDevices,
      refreshZebraReaders,
      requestBluetoothReady,
      setClassicConnectedDeviceState,
      zebraConnectedDevice,
    ],
  );

  useEffect(() => {
    connectScannerRef.current = connectScanner;
  }, [connectScanner]);

  useEffect(() => {
    refreshZebraReadersRef.current = refreshZebraReaders;
  }, [refreshZebraReaders]);

  const discoverScannerDevices = useCallback(async () => {
    setScannerDiscovering(true);
    setScannerError('');

    try {
      const ready = await requestBluetoothReady();
      if (!ready) {
        return;
      }

      const discovered = await RNBluetoothClassic.startDiscovery();
      const currentConnectedAddress = bluetoothDeviceRef.current?.address || null;
      const normalizedDiscovered = discovered
        .map(device => normalizeBluetoothDevice(device, device.address === currentConnectedAddress))
        .filter((device): device is ScannerDeviceInfo => Boolean(device));

      setDiscoveredDevices(current =>
        mergeDevices(
          current.filter(device => device.backend !== 'bluetooth_classic'),
          normalizedDiscovered,
        ),
      );
      await refreshZebraReaders();
    } catch (error: any) {
      setScannerError(error?.message || 'Could not discover Bluetooth scanners.');
    } finally {
      setScannerDiscovering(false);
    }
  }, [refreshZebraReaders, requestBluetoothReady]);

  const openBluetoothSettings = useCallback(() => {
    RNBluetoothClassic.openBluetoothSettings();
  }, []);

  const openScannerPicker = useCallback(() => {
    setScannerPickerVisible(true);
  }, []);

  const closeScannerPicker = useCallback(() => {
    setScannerPickerVisible(false);
  }, []);

  useEffect(() => {
    let active = true;

    const dataWedgeSubscription = addDataWedgeScanListener(event => {
      const payload = String(event?.data || '').trim();
      if (!payload) {
        return;
      }

      emitScanPayload(payload, {
        source: 'datawedge',
        dedupeWindowMs: RFID_DEDUPE_WINDOW_MS,
      });
    });

    const bootstrapDataWedge = async () => {
      const available = await isDataWedgeAvailable();
      if (!active) {
        return;
      }

      setDataWedgeAvailable(available);
      if (!available) {
        setDataWedgeReady(false);
        return;
      }

      try {
        await configureDataWedgeProfile();
        if (!active) {
          return;
        }

        setDataWedgeReady(true);
        setScannerError('');
      } catch (error: any) {
        if (!active) {
          return;
        }

        setDataWedgeReady(false);
        setScannerError(error?.message || 'Could not configure Zebra DataWedge.');
      }
    };

    bootstrapDataWedge();

    return () => {
      active = false;
      dataWedgeSubscription.remove();
    };
  }, [emitScanPayload]);

  useEffect(() => {
    const scanSubscription = addZebraScanListener(event => {
      const payload = String(event?.data || '').trim();
      if (!payload) {
        return;
      }

      emitScanPayload(payload, {
        source: 'zebra_rfid',
        dedupeWindowMs: RFID_DEDUPE_WINDOW_MS,
      });
    });

    const statusSubscription = addZebraStatusListener((event: ZebraRfidStatusEvent) => {
      zebraInventoryRunningRef.current = Boolean(event?.inventoryRunning);

      if (event?.status === 'reader_disconnected') {
        setZebraConnectedDevice(null);
        setScannerError('Zebra RFID reader disconnected.');
        refreshZebraReadersRef.current().catch(() => undefined);
      }

      if (event?.status === 'connect_failed') {
        const detail = (event as any)?.error;
        setScannerError(detail ? `Connect failed: ${detail}` : 'Zebra RFID connect failed.');
      }

      if (event?.status === 'inventory_start_failed') {
        setScannerError('RFID inventory failed to start. Try disconnecting and reconnecting.');
      }

      if (event?.status === 'poll_heartbeat') {
        const result = (event as any)?.getReadTagsResult ?? '?';
        const hasReader = (event as any)?.hasReader;
        if (!hasReader) {
          setScannerError('RFID poll: no reader handle. Reconnect the scanner.');
        } else if (result === 'null' && event.inventoryRunning) {
          setScannerError(`RFID poll running — getReadTags: null (check antenna/tags)`);
        }
      }

      if (event?.status === 'trigger_only_mode') {
        setScannerError('Press the trigger button on the RFD40 to scan tags.');
      }
    });

    return () => {
      scanSubscription.remove();
      statusSubscription.remove();
    };
  }, [emitScanPayload]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      bootstrapDoneRef.current = false;
    };
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      if (bootstrapDoneRef.current) {
        return;
      }
      bootstrapDoneRef.current = true;

      const ready = await requestBluetoothReady();
      if (!mountedRef.current || !ready) {
        return;
      }

      const availableZebraReaders = await refreshZebraReadersRef.current();
      if (!mountedRef.current) {
        return;
      }

      const storedTarget = parseStoredTarget(await AsyncStorage.getItem(SCANNER_DEVICE_KEY));

      if (!storedTarget && availableZebraReaders.length > 0 && mountedRef.current) {
        await connectScannerRef.current(availableZebraReaders[0].id);
        return;
      }

      if (!storedTarget || !mountedRef.current) {
        return;
      }

      if (storedTarget.backend === 'zebra_rfid') {
        await connectScannerRef.current(storedTarget.id);
        return;
      }

      const alreadyConnected = await RNBluetoothClassic.getConnectedDevices();
      const matchingConnected =
        alreadyConnected.find(device => device.address === storedTarget.address) ||
        alreadyConnected[0];

      if (matchingConnected && mountedRef.current) {
        setClassicConnectedDeviceState(matchingConnected);
        await refreshBluetoothDevices();
        return;
      }

      if (storedTarget.address && mountedRef.current) {
        await connectScannerRef.current(storedTarget.id);
      }
    };

    bootstrap();

    stateChangedRef.current = RNBluetoothClassic.onStateChanged(event => {
      if (!mountedRef.current) {
        return;
      }

      setBluetoothEnabled(Boolean(event.enabled));
      if (!event.enabled) {
        setClassicConnectedDeviceState(null);
      }
    });

    deviceDisconnectedRef.current = RNBluetoothClassic.onDeviceDisconnected(event => {
      if (!mountedRef.current) {
        return;
      }

      if (event.device?.address === bluetoothDeviceRef.current?.address) {
        setClassicConnectedDeviceState(null);
      }

      refreshBluetoothDevices().catch(() => undefined);
    });

    deviceConnectedRef.current = RNBluetoothClassic.onDeviceConnected(event => {
      if (!mountedRef.current) {
        return;
      }

      if (event.device?.address === bluetoothDeviceRef.current?.address) {
        refreshBluetoothDevices().catch(() => undefined);
      }
    });

    return () => {
      detachBluetoothReadListener();
      stateChangedRef.current?.remove();
      deviceDisconnectedRef.current?.remove();
      deviceConnectedRef.current?.remove();
    };
  }, [
    detachBluetoothReadListener,
    refreshBluetoothDevices,
    requestBluetoothReady,
    setClassicConnectedDeviceState,
  ]);

  const effectiveConnectedDevice = useMemo(() => {
    if (zebraConnectedDevice) {
      return zebraConnectedDevice;
    }

    if (classicConnectedDevice) {
      return classicConnectedDevice;
    }

    if (dataWedgeReady) {
      return createDeviceInfo({
        name: 'Zebra DataWedge',
        address: 'DEVICE_LOCAL',
        bonded: true,
        connected: true,
        type: 'DATAWEDGE',
        backend: 'datawedge',
      });
    }

    return null;
  }, [classicConnectedDevice, dataWedgeReady, zebraConnectedDevice]);

  const effectiveScannerConnected = Boolean(effectiveConnectedDevice);
  const effectiveScannerAvailable = scannerAvailable || dataWedgeAvailable || zebraAvailable;

  const value = useMemo(
    () => ({
      scannerConnected: effectiveScannerConnected,
      scannerConnecting,
      scannerDiscovering,
      scannerAvailable: effectiveScannerAvailable,
      bluetoothEnabled,
      scannerError,
      connectedDevice: effectiveConnectedDevice,
      pairedDevices,
      discoveredDevices,
      rfidReaders,
      scannerPickerVisible,
      connectScanner,
      disconnectScanner,
      refreshScannerDevices,
      discoverScannerDevices,
      requestBluetoothReady,
      openScannerPicker,
      closeScannerPicker,
      openBluetoothSettings,
      addScanListener,
      startScanSession,
      stopScanSession,
    }),
    [
      addScanListener,
      bluetoothEnabled,
      closeScannerPicker,
      connectScanner,
      discoveredDevices,
      disconnectScanner,
      discoverScannerDevices,
      effectiveConnectedDevice,
      effectiveScannerAvailable,
      effectiveScannerConnected,
      openBluetoothSettings,
      openScannerPicker,
      pairedDevices,
      refreshScannerDevices,
      requestBluetoothReady,
      rfidReaders,
      scannerConnecting,
      scannerDiscovering,
      scannerError,
      scannerPickerVisible,
      startScanSession,
      stopScanSession,
    ],
  );

  return <ScannerContext.Provider value={value}>{children}</ScannerContext.Provider>;
};

export const useScanner = () => {
  const context = useContext(ScannerContext);

  if (!context) {
    throw new Error('useScanner must be used inside ScannerProvider');
  }

  return context;
};

export function useScannerInput(
  handler: (payload: string) => void,
  enabled = true,
) {
  const { addScanListener, startScanSession, stopScanSession } = useScanner();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    startScanSession();
    const unsubscribe = addScanListener(payload => {
      handlerRef.current(payload);
    });

    return () => {
      unsubscribe();
      stopScanSession();
    };
  }, [addScanListener, enabled, startScanSession, stopScanSession]);
}
