import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  endStockAuditSession,
  getStockAuditItems,
  getStockAuditProgress,
  startStockAuditSession,
  submitStockAuditScans,
  StockAuditItem,
  StockAuditProgress,
} from '../services/stockAuditService';

type SortMode = 'barcode' | 'brand' | 'size' | 'category';

type GroupedItem = {
  key: string;
  label: string;
  count: number;
  items: StockAuditItem[];
};

const SORT_OPTIONS: Array<{ key: SortMode; label: string }> = [
  { key: 'barcode', label: 'Barcode' },
  { key: 'brand', label: 'Brand' },
  { key: 'size', label: 'Size' },
  { key: 'category', label: 'Category' },
];

function durationLabel(seconds: number): string {
  const total = Math.max(Number(seconds || 0), 0);
  if (!Number.isFinite(total) || total <= 0) return '0s';
  if (total < 60) return `${Math.round(total)}s`;
  const mins = Math.floor(total / 60);
  const secs = Math.round(total % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function getGroupLabel(item: StockAuditItem, sortMode: SortMode): string {
  if (sortMode === 'brand') {
    return String(item.brand || 'Unbranded').trim() || 'Unbranded';
  }
  if (sortMode === 'size') {
    return String(item.size_label || 'Unspecified').trim() || 'Unspecified';
  }
  if (sortMode === 'category') {
    return String(item.category || 'Uncategorised').trim() || 'Uncategorised';
  }
  return String(item.sku || item.product_name || 'UNMATCHED').trim() || 'UNMATCHED';
}

export default function StockAuditCountScreen({ navigation }: any) {
  const { scannerConnected } = useScanner();
  const { theme } = useAppTheme();
  const inputRef = useRef<TextInput>(null);

  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanReady, setScanReady] = useState(false);
  const [expectedCountInput, setExpectedCountInput] = useState('');
  const [actionLoading, setActionLoading] = useState<'start' | 'end' | ''>('');
  const [sortMode, setSortMode] = useState<SortMode>('barcode');
  const [progress, setProgress] = useState<StockAuditProgress | null>(null);
  const [items, setItems] = useState<StockAuditItem[]>([]);
  const [source, setSource] = useState('active_session');
  const [lastScanMessage, setLastScanMessage] = useState('');
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProgress, nextItems] = await Promise.all([
        getStockAuditProgress(),
        getStockAuditItems({ limit: 300 }),
      ]);
      setProgress(nextProgress);
      setItems(nextItems.items);
      setSource(nextItems.source);
      if (!nextProgress.active) {
        setScanReady(false);
      }
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not load live stock-audit data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const unsubscribe = navigation.addListener('focus', loadData);
    return unsubscribe;
  }, [loadData, navigation]);

  useEffect(() => {
    if (!progress?.active) {
      return undefined;
    }

    const timer = setInterval(() => {
      loadData();
    }, 4000);

    return () => {
      clearInterval(timer);
    };
  }, [loadData, progress?.active]);

  const groupedItems = useMemo<GroupedItem[]>(() => {
    const bucket = new Map<string, GroupedItem>();

    items.forEach(item => {
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
  }, [items, sortMode]);

  const unknownCount = useMemo(
    () => items.filter(item => !item.product_name && !item.sku).length,
    [items],
  );

  const focusScanner = () => {
    inputRef.current?.focus();
  };

  const beginScan = () => {
    if (!scannerConnected) {
      Alert.alert('Scanner offline', 'Connect the scanner first, then start the count.');
      return;
    }
    if (!progress?.active) {
      Alert.alert('No active count', 'Start the count first, then begin scanning.');
      return;
    }
    setScanReady(true);
    setError('');
    focusScanner();
  };

  const handleStartCount = async () => {
    setActionLoading('start');
    setError('');
    try {
      await startStockAuditSession({
        expectedCount: Number(expectedCountInput || 0),
      });
      await loadData();
      setScanReady(Boolean(scannerConnected));
      if (scannerConnected) {
        focusScanner();
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not start the count.');
    } finally {
      setActionLoading('');
    }
  };

  const handleFinishCount = async () => {
    setActionLoading('end');
    setError('');
    try {
      await endStockAuditSession();
      setScanReady(false);
      await loadData();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not finish the active count.');
    } finally {
      setActionLoading('');
    }
  };

  const handleScan = async (rawValue: string) => {
    const epc = String(rawValue || '').trim().toUpperCase();
    if (!epc || !scanReady) {
      return;
    }

    if (items.some(item => String(item.epc || '').trim().toUpperCase() === epc)) {
      setLastScanMessage(`${epc} already counted`);
      focusScanner();
      return;
    }

    setScanning(true);
    setError('');
    try {
      const result = await submitStockAuditScans({ epcs: [epc] });
      const [nextProgress, nextItems] = await Promise.all([
        getStockAuditProgress(),
        getStockAuditItems({ limit: 300 }),
      ]);
      setProgress(nextProgress);
      setItems(nextItems.items);
      setSource(nextItems.source);
      setLastScanMessage(result.scans[0]?.epc ? `${result.scans[0].epc} counted` : 'Tag counted');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not add this RFID to the stock-audit session.');
    } finally {
      setScanning(false);
      focusScanner();
    }
  };

  const foundCount = Number(progress?.found || 0);
  const expectedCount = Number(progress?.expected || 0);
  const missingCount = Number(progress?.missing || 0);
  const accuracy = Number(progress?.accuracy || 0);
  const reads = Number(progress?.reads || 0);
  const sessionDuration = Number(progress?.duration_seconds || 0);
  const readRate = Number(progress?.read_rate || 0);

  useScannerInput(
    payload => {
      handleScan(payload).catch(() => undefined);
    },
    scannerConnected,
  );

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Count Items"
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
          styles.heroCard,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            shadowColor: theme.shadow,
          },
        ]}
      >
        <View style={styles.heroTopRow}>
          <View
            style={[
              styles.heroPill,
              { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.heroPillText, { color: theme.textMuted }]}>Live count</Text>
          </View>
          <View
            style={[
              styles.heroPill,
              {
                backgroundColor: scannerConnected ? `${theme.success}12` : theme.surfaceAlt,
                borderColor: scannerConnected ? `${theme.success}45` : theme.border,
              },
            ]}
          >
            <Text
              style={[
                styles.heroPillText,
                { color: scannerConnected ? theme.success : theme.textMuted },
              ]}
            >
              {scannerConnected ? 'Scanner online' : 'Scanner offline'}
            </Text>
          </View>
        </View>

        <Text style={[styles.heroTitle, { color: theme.text }]}>Count in one place</Text>
        <Text style={[styles.heroHelper, { color: theme.textMuted }]}>
          Start the count, scan RFID tags, and finish the session here once the area is done.
        </Text>

        {!progress?.active ? (
          <View style={styles.setupRow}>
            <TextInput
              value={expectedCountInput}
              onChangeText={setExpectedCountInput}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.expectedInput,
                {
                  backgroundColor: theme.surfaceAlt,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
            />
            <TouchableOpacity
              style={[styles.startButton, { backgroundColor: theme.primary }]}
              onPress={handleStartCount}
              disabled={actionLoading === 'start'}
            >
              <Text style={styles.startButtonText}>
                {actionLoading === 'start' ? 'Starting...' : 'Start Count'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.activeActions}>
            <TouchableOpacity
              style={[
                styles.scanButton,
                { backgroundColor: scannerConnected ? theme.primary : theme.surfaceStrong },
              ]}
              onPress={beginScan}
              disabled={!scannerConnected}
            >
              <Text style={styles.scanButtonText}>
                {scanReady ? 'Scanner Ready' : 'Start Scanning'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.finishButton, { backgroundColor: theme.danger }]}
              onPress={handleFinishCount}
              disabled={actionLoading === 'end'}
            >
              <Text style={styles.finishButtonText}>
                {actionLoading === 'end' ? 'Finishing...' : 'Finish Count'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {lastScanMessage ? (
          <Text style={[styles.lastScanText, { color: theme.textMuted }]}>{lastScanMessage}</Text>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            Loading live count...
          </Text>
        </View>
      ) : null}

      {error ? (
        <View
          style={[
            styles.errorPanel,
            { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
          ]}
        >
          <Text style={[styles.errorText, { color: '#991B1B' }]}>{error}</Text>
        </View>
      ) : null}

      {!loading && !progress?.active ? (
        <View
          style={[
            styles.emptyPanel,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.emptyTitle, { color: theme.text }]}>Ready to begin</Text>
          <Text style={[styles.emptyText, { color: theme.textMuted }]}>
            Enter the expected total above if you know it, then start the count and begin scanning.
          </Text>
        </View>
      ) : null}

      <View style={styles.metricGrid}>
        {[
          ['Found', `${foundCount}`],
          ['Expected', `${expectedCount}`],
          ['Missing', `${missingCount}`],
          ['Unknown', `${unknownCount}`],
        ].map(([label, value]) => (
          <View
            key={label}
            style={[
              styles.metricCard,
              { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.metricLabel, { color: theme.textMuted }]}>{label}</Text>
            <Text style={[styles.metricValue, { color: theme.text }]}>{value}</Text>
          </View>
        ))}
      </View>

      <View
        style={[
          styles.sessionPanel,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            shadowColor: theme.shadow,
          },
        ]}
      >
        <Text style={[styles.panelTitle, { color: theme.text }]}>Count summary</Text>
        <Text style={[styles.panelText, { color: theme.textMuted }]}>
          Accuracy {accuracy.toFixed(1)}% | Reads {reads} | {durationLabel(sessionDuration)} | {readRate.toFixed(2)}/s
        </Text>
        <Text style={[styles.panelText, { color: theme.textMuted }]}>
          Source {String(source || 'active_session').replace(/_/g, ' ')}
        </Text>
      </View>

      <View
        style={[
          styles.panel,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            shadowColor: theme.shadow,
          },
        ]}
      >
        <View style={styles.sortHeader}>
          <View>
              <Text style={[styles.panelTitle, { color: theme.text }]}>Grouped results</Text>
            <Text style={[styles.panelText, { color: theme.textMuted }]}>
              Group by barcode, brand, size, or category.
            </Text>
          </View>
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

        {scanning ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.primary} />
            <Text style={[styles.loadingText, { color: theme.textMuted }]}>
              Updating live count...
            </Text>
          </View>
        ) : null}

        {items.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.textMuted }]}>
            No counted items yet. Start scanning to build the live audit set.
          </Text>
        ) : (
          groupedItems.map(group => {
            const lead = group.items[0];
            return (
              <View
                key={group.key}
                style={[
                  styles.groupCard,
                  { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
                ]}
              >
                <View style={styles.groupHeader}>
                  <View style={styles.groupCopy}>
                    <Text style={[styles.groupTitle, { color: theme.text }]} numberOfLines={1}>
                      {group.label}
                    </Text>
                    <Text style={[styles.groupMeta, { color: theme.textMuted }]} numberOfLines={1}>
                      {lead.product_name || lead.sku || 'Unmatched item group'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.groupBadge,
                      { backgroundColor: `${theme.success}18` },
                    ]}
                  >
                    <Text style={[styles.groupBadgeText, { color: theme.success }]}>
                      {group.count}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.groupInfo, { color: theme.textMuted }]}>
                  SKU {lead.sku || 'Unmatched'} | Brand {lead.brand || 'Unbranded'}
                </Text>
                <Text style={[styles.groupInfo, { color: theme.textMuted }]}>
                  Category {lead.category || 'Uncategorised'} | Size {lead.size_label || 'Unspecified'}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 28 },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  heroCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 22,
    marginBottom: 16,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  heroPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  heroPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
    marginBottom: 8,
  },
  heroHelper: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  setupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  expectedInput: {
    width: 92,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 13,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  startButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  activeActions: {
    gap: 10,
  },
  scanButton: {
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  finishButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  lastScanText: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
  },
  errorPanel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  emptyPanel: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  emptyButton: {
    marginTop: 14,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  metricCard: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  sessionPanel: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  panel: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  panelText: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  sortHeader: {
    marginBottom: 10,
  },
  sortControl: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  sortChip: {
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  groupCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  groupCopy: {
    flex: 1,
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  groupMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  groupBadge: {
    minWidth: 44,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupBadgeText: {
    fontSize: 16,
    fontWeight: '800',
  },
  groupInfo: {
    fontSize: 12,
    lineHeight: 18,
  },
});
