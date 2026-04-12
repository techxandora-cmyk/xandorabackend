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
import { PermissionsAndroid, Platform } from 'react-native';
import RNBluetoothClassic, {
  BluetoothDevice,
  BluetoothEventSubscription,
} from 'react-native-bluetooth-classic';

const SCANNER_DEVICE_KEY = 'xandoraScannerDeviceAddress';
const SCANNER_CONNECTION_OPTIONS = {
  connectionType: 'delimited',
  delimiter: '\n',
  charset: 'utf-8',
  readSize: 1024,
  secureSocket: false,
};

export type ScannerDeviceInfo = {
  id: string;
  name: string;
  address: string;
  bonded: boolean;
  connected: boolean;
  type: string;
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
  scannerPickerVisible: boolean;
  connectScanner: (address?: string) => Promise<void>;
  disconnectScanner: () => Promise<void>;
  refreshScannerDevices: () => Promise<void>;
  discoverScannerDevices: () => Promise<void>;
  requestBluetoothReady: () => Promise<boolean>;
  openScannerPicker: () => void;
  closeScannerPicker: () => void;
  openBluetoothSettings: () => void;
  addScanListener: (listener: (payload: string) => void) => () => void;
};

const ScannerContext = createContext<ScannerContextValue | undefined>(undefined);

function normalizeDevice(
  device: Partial<BluetoothDevice> | null | undefined,
  connected = false,
): ScannerDeviceInfo | null {
  if (!device?.address) {
    return null;
  }

  return {
    id: String(device.id || device.address),
    name: String(device.name || device.address),
    address: String(device.address),
    bonded: Boolean(device.bonded),
    connected,
    type: String(device.type || 'UNKNOWN'),
  };
}

function mergeDevices(
  pairedDevices: ScannerDeviceInfo[],
  discoveredDevices: ScannerDeviceInfo[],
  connectedAddress?: string | null,
): ScannerDeviceInfo[] {
  const bucket = new Map<string, ScannerDeviceInfo>();

  [...pairedDevices, ...discoveredDevices].forEach(device => {
    const existing = bucket.get(device.address);
    bucket.set(device.address, {
      ...existing,
      ...device,
      connected: device.address === connectedAddress || existing?.connected || false,
      bonded: device.bonded || existing?.bonded || false,
    });
  });

  return Array.from(bucket.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
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
  const [scannerConnected, setScannerConnected] = useState(false);
  const [scannerConnecting, setScannerConnecting] = useState(false);
  const [scannerDiscovering, setScannerDiscovering] = useState(false);
  const [scannerAvailable, setScannerAvailable] = useState(false);
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [connectedDevice, setConnectedDevice] = useState<ScannerDeviceInfo | null>(null);
  const [pairedDevices, setPairedDevices] = useState<ScannerDeviceInfo[]>([]);
  const [discoveredDevices, setDiscoveredDevices] = useState<ScannerDeviceInfo[]>([]);
  const [scannerPickerVisible, setScannerPickerVisible] = useState(false);

  const scanListenersRef = useRef(new Set<(payload: string) => void>());
  const connectedDeviceRef = useRef<BluetoothDevice | null>(null);
  const dataSubscriptionRef = useRef<BluetoothEventSubscription | null>(null);
  const deviceDisconnectedRef = useRef<BluetoothEventSubscription | null>(null);
  const stateChangedRef = useRef<BluetoothEventSubscription | null>(null);
  const deviceConnectedRef = useRef<BluetoothEventSubscription | null>(null);

  const emitScanPayload = useCallback((rawValue: string) => {
    const values = String(rawValue || '')
      .split(/[\r\n]+/)
      .map(value => value.trim())
      .filter(Boolean);

    values.forEach(value => {
      scanListenersRef.current.forEach(listener => {
        try {
          listener(value);
        } catch {
          // Keep scanner fan-out resilient even if one screen listener fails.
        }
      });
    });
  }, []);

  const addScanListener = useCallback((listener: (payload: string) => void) => {
    scanListenersRef.current.add(listener);
    return () => {
      scanListenersRef.current.delete(listener);
    };
  }, []);

  const detachDeviceReadListener = useCallback(() => {
    dataSubscriptionRef.current?.remove();
    dataSubscriptionRef.current = null;
  }, []);

  const attachDeviceReadListener = useCallback(
    (device: BluetoothDevice | null) => {
      detachDeviceReadListener();

      if (!device) {
        return;
      }

      dataSubscriptionRef.current = device.onDataReceived(event => {
        emitScanPayload(event.data);
      });
    },
    [detachDeviceReadListener, emitScanPayload],
  );

  const refreshScannerDevices = useCallback(async () => {
    try {
      const paired = await RNBluetoothClassic.getBondedDevices();
      const currentConnectedAddress = connectedDeviceRef.current?.address || null;
      const normalizedPaired = paired
        .map(device => normalizeDevice(device, device.address === currentConnectedAddress))
        .filter((device): device is ScannerDeviceInfo => Boolean(device));

      setPairedDevices(normalizedPaired);
      setDiscoveredDevices(current =>
        mergeDevices(normalizedPaired, current, currentConnectedAddress).filter(
          device => !normalizedPaired.some(pairedDevice => pairedDevice.address === device.address),
        ),
      );
    } catch (error: any) {
      setScannerError(
        error?.message || 'Could not load paired Bluetooth scanners.',
      );
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

      await refreshScannerDevices();
      setScannerError('');
      return true;
    } catch (error: any) {
      setScannerError(error?.message || 'Bluetooth is not ready.');
      return false;
    }
  }, [refreshScannerDevices]);

  const setConnectedDeviceState = useCallback(
    (device: BluetoothDevice | null) => {
      connectedDeviceRef.current = device;
      const normalized = normalizeDevice(device, Boolean(device));
      setConnectedDevice(normalized);
      setScannerConnected(Boolean(normalized));
      attachDeviceReadListener(device);
    },
    [attachDeviceReadListener],
  );

  const disconnectScanner = useCallback(async () => {
    try {
      const device = connectedDeviceRef.current;
      if (device) {
        await device.disconnect();
      }
    } catch {
      // Swallow disconnect errors to keep UI consistent.
    } finally {
      await AsyncStorage.removeItem(SCANNER_DEVICE_KEY);
      setConnectedDeviceState(null);
      await refreshScannerDevices();
      setScannerPickerVisible(false);
    }
  }, [refreshScannerDevices, setConnectedDeviceState]);

  const connectScanner = useCallback(
    async (address?: string) => {
      if (!address) {
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

        if (
          connectedDeviceRef.current &&
          connectedDeviceRef.current.address !== address
        ) {
          await connectedDeviceRef.current.disconnect();
          setConnectedDeviceState(null);
        }

        const device = await RNBluetoothClassic.connectToDevice(
          address,
          SCANNER_CONNECTION_OPTIONS,
        );

        setConnectedDeviceState(device);
        await AsyncStorage.setItem(SCANNER_DEVICE_KEY, address);
        await refreshScannerDevices();
        setScannerPickerVisible(false);
      } catch (error: any) {
        setScannerError(
          error?.message || 'Could not connect to this Bluetooth scanner.',
        );
      } finally {
        setScannerConnecting(false);
      }
    },
    [refreshScannerDevices, requestBluetoothReady, setConnectedDeviceState],
  );

  const discoverScannerDevices = useCallback(async () => {
    setScannerDiscovering(true);
    setScannerError('');

    try {
      const ready = await requestBluetoothReady();
      if (!ready) {
        return;
      }

      const discovered = await RNBluetoothClassic.startDiscovery();
      const currentConnectedAddress = connectedDeviceRef.current?.address || null;
      const normalizedDiscovered = discovered
        .map(device =>
          normalizeDevice(device, device.address === currentConnectedAddress),
        )
        .filter((device): device is ScannerDeviceInfo => Boolean(device));

      setDiscoveredDevices(current =>
        mergeDevices(pairedDevices, [...current, ...normalizedDiscovered], currentConnectedAddress).filter(
          device =>
            !pairedDevices.some(
              pairedDevice => pairedDevice.address === device.address,
            ),
        ),
      );
    } catch (error: any) {
      setScannerError(
        error?.message || 'Could not discover Bluetooth scanners.',
      );
    } finally {
      setScannerDiscovering(false);
    }
  }, [pairedDevices, requestBluetoothReady]);

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

    const bootstrap = async () => {
      const ready = await requestBluetoothReady();
      if (!active || !ready) {
        return;
      }

      const storedAddress = await AsyncStorage.getItem(SCANNER_DEVICE_KEY);
      const alreadyConnected = await RNBluetoothClassic.getConnectedDevices();
      const matchingConnected =
        alreadyConnected.find(device => device.address === storedAddress) ||
        alreadyConnected[0];

      if (matchingConnected && active) {
        setConnectedDeviceState(matchingConnected);
        await refreshScannerDevices();
        return;
      }

      if (storedAddress && active) {
        await connectScanner(storedAddress);
      }
    };

    bootstrap();

    stateChangedRef.current = RNBluetoothClassic.onStateChanged(event => {
      if (!active) {
        return;
      }
      setBluetoothEnabled(Boolean(event.enabled));
      if (!event.enabled) {
        setConnectedDeviceState(null);
      }
    });

    deviceDisconnectedRef.current =
      RNBluetoothClassic.onDeviceDisconnected(event => {
        if (!active) {
          return;
        }
        if (event.device?.address === connectedDeviceRef.current?.address) {
          setConnectedDeviceState(null);
        }
        refreshScannerDevices();
      });

    deviceConnectedRef.current = RNBluetoothClassic.onDeviceConnected(event => {
      if (!active) {
        return;
      }
      if (event.device?.address === connectedDeviceRef.current?.address) {
        refreshScannerDevices();
      }
    });

    return () => {
      active = false;
      detachDeviceReadListener();
      stateChangedRef.current?.remove();
      deviceDisconnectedRef.current?.remove();
      deviceConnectedRef.current?.remove();
    };
  }, [
    connectScanner,
    detachDeviceReadListener,
    refreshScannerDevices,
    requestBluetoothReady,
    setConnectedDeviceState,
  ]);

  const value = useMemo(
    () => ({
      scannerConnected,
      scannerConnecting,
      scannerDiscovering,
      scannerAvailable,
      bluetoothEnabled,
      scannerError,
      connectedDevice,
      pairedDevices,
      discoveredDevices,
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
    }),
    [
      addScanListener,
      bluetoothEnabled,
      connectScanner,
      connectedDevice,
      discoveredDevices,
      disconnectScanner,
      discoverScannerDevices,
      openBluetoothSettings,
      openScannerPicker,
      closeScannerPicker,
      pairedDevices,
      refreshScannerDevices,
      requestBluetoothReady,
      scannerAvailable,
      scannerConnected,
      scannerConnecting,
      scannerDiscovering,
      scannerError,
      scannerPickerVisible,
    ],
  );

  return (
    <ScannerContext.Provider value={value}>{children}</ScannerContext.Provider>
  );
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
  const { addScanListener } = useScanner();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    return addScanListener(payload => {
      handlerRef.current(payload);
    });
  }, [addScanListener, enabled]);
}
