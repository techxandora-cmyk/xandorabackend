import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { useScanner, useScannerInput } from '../context/ScannerContext';
import { useAppTheme } from '../context/ThemeContext';
import { AuditTagRecord, getAuditTagDetails } from '../services/auditService';
import { getAuthSession } from '../services/session';

type SortMode = 'barcode' | 'brand' | 'size';

type AuditGroup = {
  key: string;
  label: string;
  count: number;
  items: AuditTagRecord[];
};

const SORT_OPTIONS: Array<{ key: SortMode; label: string }> = [
  { key: 'barcode', label: 'Barcode' },
  { key: 'brand', label: 'Brand' },
  { key: 'size', label: 'Size' },
];

function getGroupLabel(item: AuditTagRecord, sortMode: SortMode): string {
  if (sortMode === 'brand') {
    return String(item.brand || 'Unbranded').trim() || 'Unbranded';
  }

  if (sortMode === 'size') {
    return String(item.sizeLabel || 'Unspecified').trim() || 'Unspecified';
  }

  return String(item.barcode || 'UNMATCHED').trim().toUpperCase() || 'UNMATCHED';
}

export default function AuditScreen({ navigation }: any) {
  const { scannerConnected } = useScanner();
  const { theme } = useAppTheme();
  const [screenTitle, setScreenTitle] = useState('Audit');
  const [helperText, setHelperText] = useState(
    'Scan RFID tags to build the live count. Then group the captured items by barcode, brand, or size.',
  );
  const [scanMode, setScanMode] = useState<'rfid' | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('barcode');
  const [rfidList, setRfidList] = useState<string[]>([]);
  const [scannedItems, setScannedItems] = useState<AuditTagRecord[]>([]);
  const [isResolvingScan, setIsResolvingScan] = useState(false);

  const inputRef = useRef<TextInput>(null);

  const auditReady = rfidList.length > 0;
  const uniqueBarcodeCount = useMemo(
    () =>
      new Set(scannedItems.map(item => String(item.barcode || '').trim().toUpperCase()).filter(Boolean))
        .size,
    [scannedItems],
  );

  const groupedItems = useMemo<AuditGroup[]>(() => {
    const bucket = new Map<string, AuditGroup>();

    scannedItems.forEach(item => {
      const label = getGroupLabel(item, sortMode);
      const existing = bucket.get(label);

      if (existing) {
        existing.count += 1;
        existing.items.push(item);
        return;
      }

      bucket.set(label, {
        key: `${sortMode}:${label}`,
        label,
        count: 1,
        items: [item],
      });
    });

    return Array.from(bucket.values()).sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label);
    });
  }, [scannedItems, sortMode]);

  const focusScanner = () => {
    inputRef.current?.focus();
  };

  useEffect(() => {
    const resolveCopy = async () => {
      const session = await getAuthSession();
      const productKey = String(session?.user?.product_key || '').trim().toLowerCase();

      if (productKey === 'retail') {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.replace('Home');
        }
        return;
      }

      if (productKey === 'stock_audit') {
        setScreenTitle('Count Verification');
        setHelperText(
          'Scan RFID tags first, then group the captured items to review the count set faster.',
        );
      }
    };

    resolveCopy();
  }, [navigation]);

  const handleScan = async (value: string) => {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed || scanMode !== 'rfid') {
      return;
    }

    if (rfidList.includes(trimmed)) {
      Alert.alert('Duplicate RFID', 'This tag has already been captured in this count.');
      focusScanner();
      return;
    }

    const updatedRfids = [...rfidList, trimmed];
    setIsResolvingScan(true);

    try {
      const tagDetails = await getAuditTagDetails(updatedRfids);
      setRfidList(updatedRfids);
      setScannedItems(tagDetails);
    } catch (error: any) {
      Alert.alert(
        'Scan sync failed',
        error?.message || 'The handheld could not refresh this count. Try scanning again.',
      );
    } finally {
      setIsResolvingScan(false);
      focusScanner();
    }
  };

  const startRfidScan = () => {
    if (!scannerConnected) {
      Alert.alert('Connect Scanner First');
      return;
    }

    setScanMode('rfid');
    focusScanner();
  };

  const clearAudit = () => {
    setScanMode(null);
    setRfidList([]);
    setScannedItems([]);
    setSortMode('barcode');
  };

  useScannerInput(
    payload => {
      handleScan(payload).catch(() => undefined);
    },
    scannerConnected,
  );

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title={screenTitle}
        onBack={() =>
          navigation.canGoBack() ? navigation.goBack() : navigation.replace('Home')
        }
      />

      <TextInput
        ref={inputRef}
        style={styles.hiddenInput}
        blurOnSubmit={false}
        showSoftInputOnFocus={false}
        onSubmitEditing={event => {
          handleScan(event.nativeEvent.text);
          inputRef.current?.clear();
        }}
      />

      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            shadowColor: theme.shadow,
          },
        ]}
      >
        <Text style={[styles.helperText, { color: theme.textMuted }]}>{helperText}</Text>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: theme.primary }]}
            onPress={startRfidScan}
          >
            <Text style={styles.primaryButtonText}>
              {scanMode === 'rfid' ? 'Scanner Ready' : 'Start RFID Scan'}
            </Text>
          </TouchableOpacity>

          <View
            style={[
              styles.statusChip,
              {
                backgroundColor: scannerConnected ? `${theme.success}1A` : `${theme.danger}18`,
                borderColor: scannerConnected ? `${theme.success}55` : `${theme.danger}40`,
              },
            ]}
          >
            <Text
              style={[
                styles.statusChipText,
                { color: scannerConnected ? theme.success : theme.danger },
              ]}
            >
              {scannerConnected ? 'Scanner Connected' : 'Scanner Offline'}
            </Text>
          </View>
        </View>

        <View style={styles.statGrid}>
          <View
            style={[
              styles.statCard,
              {
                backgroundColor: auditReady ? `${theme.success}14` : theme.surfaceAlt,
                borderColor: auditReady ? `${theme.success}45` : theme.border,
              },
            ]}
          >
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>Scanned</Text>
            <Text style={[styles.statValue, { color: auditReady ? theme.success : theme.text }]}>
              {rfidList.length}
            </Text>
          </View>

          <View
            style={[
              styles.statCard,
              {
                backgroundColor: theme.surfaceAlt,
                borderColor: theme.border,
              },
            ]}
          >
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>Barcodes</Text>
            <Text style={[styles.statValue, { color: theme.text }]}>{uniqueBarcodeCount}</Text>
          </View>

          <View
            style={[
              styles.statCard,
              {
                backgroundColor: theme.surfaceAlt,
                borderColor: theme.border,
              },
            ]}
          >
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>Groups</Text>
            <Text style={[styles.statValue, { color: theme.text }]}>{groupedItems.length}</Text>
          </View>
        </View>

        <View style={styles.sortHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Sort Count By</Text>
          <Text style={[styles.sortHint, { color: theme.textMuted }]}>
            Barcode, brand, or size
          </Text>
        </View>

        <View
          style={[
            styles.sortControl,
            {
              backgroundColor: theme.surfaceAlt,
              borderColor: theme.border,
            },
          ]}
        >
          {SORT_OPTIONS.map(option => {
            const selected = option.key === sortMode;
            return (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.sortChip,
                  {
                    backgroundColor: selected ? theme.primary : 'transparent',
                    borderColor: selected ? theme.primary : 'transparent',
                  },
                ]}
                onPress={() => setSortMode(option.key)}
              >
                <Text
                  style={[
                    styles.sortChipText,
                    { color: selected ? '#FFFFFF' : theme.textMuted },
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {isResolvingScan ? (
          <View
            style={[
              styles.liveState,
              {
                backgroundColor: `${theme.primary}14`,
                borderColor: `${theme.primary}35`,
              },
            ]}
          >
            <Text style={[styles.liveStateText, { color: theme.primary }]}>
              Refreshing live count...
            </Text>
          </View>
        ) : null}

        {auditReady ? (
          <View style={styles.resultsSection}>
            <Text style={[styles.resultsTitle, { color: theme.text }]}>
              Grouped by {SORT_OPTIONS.find(option => option.key === sortMode)?.label}
            </Text>

            {groupedItems.map(group => {
              const leadItem = group.items[0];
              return (
                <View
                  key={group.key}
                  style={[
                    styles.groupCard,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.surfaceAlt,
                    },
                  ]}
                >
                  <View style={styles.groupTopRow}>
                    <View style={styles.groupTextWrap}>
                      <Text style={[styles.groupLabel, { color: theme.text }]} numberOfLines={1}>
                        {group.label}
                      </Text>
                      <Text
                        style={[styles.groupMeta, { color: theme.textMuted }]}
                        numberOfLines={1}
                      >
                        {leadItem.itemName}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.groupCountBadge,
                        { backgroundColor: `${theme.success}18` },
                      ]}
                    >
                      <Text style={[styles.groupCountText, { color: theme.success }]}>
                        {group.count}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.groupInfoRow}>
                    <Text style={[styles.groupInfoText, { color: theme.textMuted }]}>
                      Barcode {leadItem.barcode}
                    </Text>
                    <Text style={[styles.groupInfoText, { color: theme.textMuted }]}>
                      Brand {leadItem.brand}
                    </Text>
                    <Text style={[styles.groupInfoText, { color: theme.textMuted }]}>
                      Size {leadItem.sizeLabel}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View
            style={[
              styles.emptyState,
              {
                borderColor: theme.border,
                backgroundColor: theme.surfaceAlt,
              },
            ]}
          >
            <Text style={[styles.emptyStateTitle, { color: theme.text }]}>
              No tags counted yet
            </Text>
            <Text style={[styles.emptyStateText, { color: theme.textMuted }]}>
              Start RFID scan to build the live count, then switch between barcode, brand,
              and size views.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.clearButton, { backgroundColor: theme.danger }]}
          onPress={clearAudit}
        >
          <Text style={styles.clearButtonText}>Clear Count</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 28,
  },
  hiddenInput: {
    height: 0,
    width: 0,
  },
  card: {
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  actionRow: {
    marginBottom: 18,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  statusChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  statCard: {
    width: '31.5%',
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '800',
  },
  sortHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sortHint: {
    fontSize: 12,
    fontWeight: '600',
  },
  sortControl: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 6,
    flexDirection: 'row',
    marginBottom: 16,
  },
  sortChip: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  liveState: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  liveStateText: {
    fontSize: 13,
    fontWeight: '700',
  },
  resultsSection: {
    marginBottom: 10,
  },
  resultsTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 12,
  },
  groupCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
  },
  groupTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  groupTextWrap: {
    flex: 1,
  },
  groupLabel: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  groupMeta: {
    fontSize: 13,
    fontWeight: '500',
  },
  groupCountBadge: {
    minWidth: 44,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupCountText: {
    fontSize: 16,
    fontWeight: '800',
  },
  groupInfoRow: {
    gap: 4,
  },
  groupInfoText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  emptyStateText: {
    fontSize: 14,
    lineHeight: 20,
  },
  clearButton: {
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 6,
  },
  clearButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
});
