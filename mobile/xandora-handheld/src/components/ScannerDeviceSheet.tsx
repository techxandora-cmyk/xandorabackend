import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useScanner } from '../context/ScannerContext';
import { useAppTheme } from '../context/ThemeContext';

export default function ScannerDeviceSheet() {
  const { theme } = useAppTheme();
  const [refreshing, setRefreshing] = useState(false);
  const {
    bluetoothEnabled,
    closeScannerPicker,
    connectScanner,
    connectedDevice,
    disconnectScanner,
    discoverScannerDevices,
    discoveredDevices,
    openBluetoothSettings,
    pairedDevices,
    rfidReaders,
    refreshScannerDevices,
    scannerConnecting,
    scannerConnected,
    scannerDiscovering,
    scannerError,
    scannerPickerVisible,
  } = useScanner();

  const devices = useMemo(() => {
    const bucket = new Map<string, (typeof pairedDevices)[number]>();

    [...pairedDevices, ...discoveredDevices, ...rfidReaders].forEach(device => {
      const addressKey = String(device.address || '').trim().toUpperCase();
      const existingEntry = Array.from(bucket.values()).find(existing => {
        const existingAddress = String(existing.address || '').trim().toUpperCase();
        return addressKey && existingAddress === addressKey;
      });

      if (!existingEntry) {
        bucket.set(device.id, device);
        return;
      }

      if (device.backend === 'zebra_rfid' && existingEntry.backend !== 'zebra_rfid') {
        bucket.delete(existingEntry.id);
        bucket.set(device.id, device);
        return;
      }

      if (!existingEntry.connected && device.connected) {
        bucket.delete(existingEntry.id);
        bucket.set(device.id, device);
      }
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
  }, [discoveredDevices, pairedDevices, rfidReaders]);

  return (
    <Modal
      visible={scannerPickerVisible}
      transparent
      animationType="slide"
      onRequestClose={closeScannerPicker}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.dismissArea} onPress={closeScannerPicker} />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              shadowColor: theme.shadow,
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={styles.sheetCopy}>
              <Text style={[styles.kicker, { color: theme.textMuted }]}>
                Scanner / RFID Reader
              </Text>
              <Text style={[styles.title, { color: theme.text }]}>
                {scannerConnected
                  ? connectedDevice?.name || 'Scanner connected'
                  : 'Connect a scanner'}
              </Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                Pair the device in Android first if it does not appear here, then connect it in
                Xandora. Zebra RFID readers appear here when the Zebra SDK is bundled in the app.
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.closeButton,
                { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
              ]}
              onPress={closeScannerPicker}
            >
              <Text style={[styles.closeButtonText, { color: theme.text }]}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.primary }]}
              onPress={async () => {
                setRefreshing(true);
                try {
                  await refreshScannerDevices();
                } finally {
                  setRefreshing(false);
                }
              }}
              disabled={refreshing || scannerDiscovering || scannerConnecting}
            >
              <Text style={styles.actionButtonText}>
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.secondary }]}
              onPress={() => {
                discoverScannerDevices();
              }}
            >
              <Text style={styles.actionButtonText}>
                {scannerDiscovering ? 'Discovering...' : 'Discover'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.secondaryButton,
                { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
              ]}
              onPress={openBluetoothSettings}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
                Settings
              </Text>
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.statusPanel,
              {
                backgroundColor: bluetoothEnabled ? `${theme.success}12` : theme.surfaceAlt,
                borderColor: bluetoothEnabled ? `${theme.success}45` : theme.border,
              },
            ]}
          >
            <Text
              style={[
                styles.statusTitle,
                { color: bluetoothEnabled ? theme.success : theme.text },
              ]}
            >
              {bluetoothEnabled ? 'Bluetooth is ready' : 'Bluetooth is off'}
            </Text>
            <Text style={[styles.statusText, { color: theme.textMuted }]}>
              {scannerConnected
                ? `Connected to ${connectedDevice?.name || connectedDevice?.address}`
                : 'Choose a paired scanner, or connect a Zebra RFID reader from the list below.'}
            </Text>
          </View>

          {scannerError ? (
            <View
              style={[
                styles.errorPanel,
                styles.errorPanelDanger,
              ]}
            >
              <Text style={styles.errorText}>{scannerError}</Text>
            </View>
          ) : null}

          <ScrollView
            style={styles.deviceList}
            contentContainerStyle={styles.deviceListContent}
            showsVerticalScrollIndicator={false}
          >
            {!devices.length ? (
              <View
                style={[
                  styles.emptyPanel,
                  { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
                ]}
              >
                {(scannerDiscovering || scannerConnecting) && (
                  <ActivityIndicator color={theme.primary} style={styles.emptySpinner} />
                )}
                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  No scanners listed yet
                </Text>
                <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                  Make sure the scanner is paired in Android Bluetooth settings, then tap Refresh
                  or Discover. Zebra RFID readers require the Zebra SDK build and a paired RFD40.
                </Text>
              </View>
            ) : (
              devices.map(device => {
                const selected = connectedDevice?.id === device.id;
                const transportLabel =
                  device.backend === 'zebra_rfid'
                    ? 'Zebra RFID'
                    : device.backend === 'datawedge'
                    ? 'DataWedge'
                    : device.bonded
                    ? 'Paired Bluetooth'
                    : 'Discovered Bluetooth';

                return (
                  <View
                    key={device.id}
                    style={[
                      styles.deviceCard,
                      {
                        backgroundColor: selected ? `${theme.primary}10` : theme.surfaceAlt,
                        borderColor: selected ? `${theme.primary}45` : theme.border,
                      },
                    ]}
                  >
                    <View style={styles.deviceHeader}>
                      <View style={styles.deviceCopy}>
                        <Text style={[styles.deviceName, { color: theme.text }]}>
                          {device.name}
                        </Text>
                        <Text style={[styles.deviceMeta, { color: theme.textMuted }]}>
                          {device.address}
                        </Text>
                        <Text style={[styles.deviceMeta, { color: theme.textMuted }]}>
                          {transportLabel} · {device.type}
                        </Text>
                      </View>
                      {selected ? (
                        <View
                          style={[
                            styles.connectedBadge,
                            {
                              backgroundColor: `${theme.success}14`,
                              borderColor: `${theme.success}45`,
                            },
                          ]}
                        >
                          <Text
                            style={[styles.connectedBadgeText, { color: theme.success }]}
                          >
                            Connected
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {selected ? (
                      <TouchableOpacity
                        style={[styles.disconnectButton, { backgroundColor: theme.danger }]}
                        onPress={() => {
                          disconnectScanner();
                        }}
                      >
                        <Text style={styles.actionButtonText}>Disconnect</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.connectButton, { backgroundColor: theme.primary }]}
                        onPress={() => {
                          connectScanner(device.id);
                        }}
                        disabled={scannerConnecting}
                      >
                        <Text style={styles.actionButtonText}>
                          {scannerConnecting ? 'Connecting...' : 'Connect'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.46)',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: 18,
    maxHeight: '78%',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -8 },
    elevation: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  sheetCopy: {
    flex: 1,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
  },
  closeButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  closeButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  actionButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    borderRadius: 14,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  statusPanel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  statusText: {
    fontSize: 13,
    lineHeight: 18,
  },
  errorPanel: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  errorPanelDanger: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
  },
  errorText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
  },
  deviceList: {
    flexGrow: 0,
  },
  deviceListContent: {
    paddingBottom: 24,
    gap: 12,
  },
  emptyPanel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
  },
  emptySpinner: {
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  deviceCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  deviceCopy: {
    flex: 1,
    gap: 4,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '800',
  },
  deviceMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  connectedBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  connectedBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  connectButton: {
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 12,
  },
  disconnectButton: {
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 12,
  },
});
