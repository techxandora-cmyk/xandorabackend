import React, { useMemo, useRef, useState } from 'react';
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
import { brand } from '../theme/brand';
import {
  getLaundryEvents,
  getLaundryItemStatus,
  LaundryEvent,
  LaundryItem,
} from '../services/laundryService';

type StatusMode = 'single' | 'batch';
type BatchFilter = 'all' | 'known' | 'in_wash' | 'attention';

type BatchEntry = {
  epc: string;
  item: LaundryItem | null;
  error?: string;
};

type WashWarningStage = 'OK' | 'WARNING_1' | 'WARNING_2' | 'WARNING_3' | 'EXCEEDED';

function formatTime(value?: string | null): string {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No timestamp';
  return date.toLocaleString();
}

function lifecycleTone(theme: any, value?: string | null) {
  const key = String(value || '').toUpperCase();
  if (key === 'EXCEEDED') {
    return { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', textColor: '#991B1B' };
  }
  if (key === 'NEAR_LIMIT') {
    return { backgroundColor: '#FEF3C7', borderColor: '#FCD34D', textColor: '#92400E' };
  }
  return {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
    textColor: '#166534',
  };
}

function washWarningStage(item?: LaundryItem | null): WashWarningStage {
  const cycles = Number(item?.wash_cycle_count || 0);
  const maxCycles = Number(item?.max_wash_cycles || 200) || 200;

  if (cycles >= maxCycles) return 'EXCEEDED';
  if (cycles >= 195) return 'WARNING_3';
  if (cycles >= 190) return 'WARNING_2';
  if (cycles >= 170) return 'WARNING_1';
  return 'OK';
}

function washWarningTone(theme: any, stage: WashWarningStage) {
  if (stage === 'EXCEEDED') {
    return { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', textColor: '#991B1B' };
  }
  if (stage === 'WARNING_3') {
    return { backgroundColor: '#FEF3C7', borderColor: '#F59E0B', textColor: '#92400E' };
  }
  if (stage === 'WARNING_2') {
    return { backgroundColor: '#FEF3C7', borderColor: '#FCD34D', textColor: '#A16207' };
  }
  if (stage === 'WARNING_1') {
    return { backgroundColor: '#FFF7ED', borderColor: '#FDBA74', textColor: '#C2410C' };
  }
  return {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    textColor: theme.textMuted,
  };
}

function washWarningLabel(stage: WashWarningStage): string {
  if (stage === 'WARNING_1') return 'Warning 1';
  if (stage === 'WARNING_2') return 'Warning 2';
  if (stage === 'WARNING_3') return 'Warning 3';
  if (stage === 'EXCEEDED') return 'Exceeded';
  return 'OK';
}

function statusTone(theme: any, value?: string | null) {
  const key = String(value || '').toUpperCase();
  if (key === 'IN_STOCK') {
    return { backgroundColor: '#DCFCE7', borderColor: '#86EFAC', textColor: '#166534' };
  }
  if (key === 'IN_WASH') {
    return { backgroundColor: '#DBEAFE', borderColor: '#93C5FD', textColor: '#1D4ED8' };
  }
  if (key === 'DAMAGED') {
    return { backgroundColor: '#FEF3C7', borderColor: '#FCD34D', textColor: '#92400E' };
  }
  if (key === 'LOST' || key === 'RETIRED') {
    return { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', textColor: '#991B1B' };
  }
  return {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    textColor: theme.textMuted,
  };
}

function DetailRow({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: any;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function MetricCard({
  label,
  value,
  theme,
}: {
  label: string;
  value: string | number;
  theme: any;
}) {
  return (
    <View
      style={[
        styles.metricCard,
        { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
      ]}
    >
      <Text style={[styles.metricLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function BatchMetricButton({
  label,
  value,
  theme,
  selected,
  onPress,
}: {
  label: string;
  value: string | number;
  theme: any;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.metricCard,
        {
          backgroundColor: selected ? `${theme.primary}12` : theme.surfaceAlt,
          borderColor: selected ? `${theme.primary}45` : theme.border,
        },
      ]}
      onPress={onPress}
    >
      <Text style={[styles.metricLabel, { color: selected ? theme.primary : theme.textMuted }]}>
        {label}
      </Text>
      <Text style={[styles.metricValue, { color: selected ? theme.primary : theme.text }]}>
        {value}
      </Text>
    </TouchableOpacity>
  );
}

export default function LaundryStatusScreen({ navigation }: any) {
  const { scannerConnected } = useScanner();
  const { theme } = useAppTheme();
  const inputRef = useRef<TextInput>(null);
  const [mode, setMode] = useState<StatusMode>('single');
  const [query, setQuery] = useState('');
  const [scanReady, setScanReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<LaundryItem | null>(null);
  const [events, setEvents] = useState<LaundryEvent[]>([]);
  const [batchEntries, setBatchEntries] = useState<BatchEntry[]>([]);
  const [expectedCountInput, setExpectedCountInput] = useState('');
  const [activeBatchFilter, setActiveBatchFilter] = useState<BatchFilter>('all');
  const [error, setError] = useState('');

  const statusPill = statusTone(theme, item?.status);
  const lifecyclePill = lifecycleTone(theme, item?.lifecycle_state);
  const warningStage = washWarningStage(item);
  const warningPill = washWarningTone(theme, warningStage);

  const filteredEvents = useMemo(() => {
    if (!item) return [];
    return events.filter(event => String(event.epc || '').trim().toUpperCase() === item.epc);
  }, [events, item]);

  const batchSummary = useMemo(() => {
    const known = batchEntries.filter(entry => entry.item).length;
    const inStock = batchEntries.filter(entry => entry.item?.status === 'IN_STOCK').length;
    const inWash = batchEntries.filter(entry => entry.item?.status === 'IN_WASH').length;
    const flagged = batchEntries.filter(entry => {
      const status = String(entry.item?.status || '').toUpperCase();
      return (
        !entry.item ||
        ['DAMAGED', 'LOST', 'RETIRED'].includes(status) ||
        washWarningStage(entry.item) !== 'OK'
      );
    }).length;

    return {
      scanned: batchEntries.length,
      known,
      inStock,
      inWash,
      flagged,
    };
  }, [batchEntries]);
  const filteredBatchEntries = useMemo(() => {
    if (activeBatchFilter === 'known') {
      return batchEntries.filter(entry => entry.item);
    }
    if (activeBatchFilter === 'in_wash') {
      return batchEntries.filter(entry => entry.item?.status === 'IN_WASH');
    }
    if (activeBatchFilter === 'attention') {
      return batchEntries.filter(entry => {
        const status = String(entry.item?.status || '').toUpperCase();
        return (
          !entry.item ||
          ['DAMAGED', 'LOST', 'RETIRED'].includes(status) ||
          washWarningStage(entry.item) !== 'OK'
        );
      });
    }
    return batchEntries;
  }, [activeBatchFilter, batchEntries]);
  const activeBatchFilterLabel =
    activeBatchFilter === 'known'
      ? 'Known Items'
      : activeBatchFilter === 'in_wash'
      ? 'In Wash'
      : activeBatchFilter === 'attention'
      ? 'Attention'
      : 'All Scanned';
  const expectedCount = Math.max(Number(expectedCountInput || 0) || 0, 0);
  const batchMatched = expectedCount > 0 && batchEntries.length === expectedCount;
  const batchOver = expectedCount > 0 && batchEntries.length > expectedCount;
  const batchProgressLabel =
    expectedCount > 0
      ? batchMatched
        ? 'Batch matched'
        : batchOver
        ? 'Over target'
        : 'In progress'
      : 'Set target';
  const batchProgressColor = batchMatched
    ? theme.success
    : batchOver
    ? '#EF4444'
    : theme.primary;
  const batchProgressBackground = batchMatched
    ? `${theme.success}12`
    : batchOver
    ? '#FEE2E2'
    : theme.surfaceAlt;
  const batchProgressBorder = batchMatched
    ? `${theme.success}45`
    : batchOver
    ? '#FCA5A5'
    : theme.border;
  const batchProgressWidth = `${Math.max(
    expectedCount > 0
      ? Math.min((batchEntries.length / expectedCount) * 100, 100)
      : batchEntries.length
      ? 24
      : 0,
    0,
  )}%` as `${number}%`;

  const heroTitle = mode === 'single' ? 'Check one fabric fast' : 'Check a batch quickly';
  const heroHelper =
    mode === 'single'
      ? 'Scan one RFID to see where the fabric is, how many wash cycles it has used, and whether it needs attention.'
      : 'Scan several RFIDs to review laundry status in one pass, similar to a small stock take.';

  const runSingleLookup = async (value: string) => {
    const epc = String(value || '').trim().toUpperCase();
    if (!epc) {
      setError('Scan or enter one laundry RFID first.');
      setItem(null);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [nextItem, nextEvents] = await Promise.all([
        getLaundryItemStatus(epc),
        getLaundryEvents(undefined, 40),
      ]);

      if (!nextItem) {
        setItem(null);
        setEvents([]);
        setError('This RFID is not registered in the current laundry store.');
        return;
      }

      setQuery(epc);
      setItem(nextItem);
      setEvents(nextEvents);
    } catch (err: any) {
      setItem(null);
      setEvents([]);
      setError(err?.response?.data?.error || err?.message || 'Could not check laundry status');
    } finally {
      setLoading(false);
      setScanReady(false);
    }
  };

  const addBatchLookup = async (value: string) => {
    const epc = String(value || '').trim().toUpperCase();
    if (!epc) {
      setError('Scan or enter one laundry RFID first.');
      return;
    }
    if (expectedCount <= 0) {
      setError('Set the expected batch count first, then start scanning.');
      return;
    }
    if (batchEntries.some(entry => entry.epc === epc)) {
      Alert.alert('Duplicate RFID', 'This fabric tag is already in the current batch check.');
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError('');

    try {
      const nextItem = await getLaundryItemStatus(epc);
      setBatchEntries(prev => [
        {
          epc,
          item: nextItem,
          error: nextItem ? undefined : 'Not registered in the current laundry store.',
        },
        ...prev,
      ]);
      setQuery('');
      inputRef.current?.focus();
    } catch (err: any) {
      setBatchEntries(prev => [
        {
          epc,
          item: null,
          error: err?.response?.data?.error || err?.message || 'Lookup failed',
        },
        ...prev,
      ]);
      setQuery('');
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const startScannerLookup = () => {
    if (!scannerConnected) {
      Alert.alert('Scanner offline', 'Connect the scanner first, then scan a laundry RFID.');
      return;
    }
    if (mode === 'batch' && expectedCount <= 0) {
      Alert.alert('Expected count required', 'Set the expected batch count first, then start scanning.');
      return;
    }

    setScanReady(true);
    setError('');
    inputRef.current?.focus();
  };

  useScannerInput(
    payload => {
      if (!scanReady) {
        return;
      }

      if (mode === 'batch') {
        addBatchLookup(payload).catch(() => undefined);
        return;
      }

      runSingleLookup(payload).catch(() => undefined);
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
        title="Fabric Status"
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
          if (mode === 'batch') {
            addBatchLookup(event.nativeEvent.text);
          } else {
            runSingleLookup(event.nativeEvent.text);
          }
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
            <Text style={[styles.heroPillText, { color: theme.textMuted }]}>Laundry status</Text>
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

        <Text style={[styles.heroTitle, { color: theme.text }]}>{heroTitle}</Text>
        <Text style={[styles.heroHelper, { color: theme.textMuted }]}>{heroHelper}</Text>

        <View style={styles.modeGrid}>
          {[
            {
              key: 'single' as const,
              label: 'One Fabric',
              subtitle: 'Open one RFID with full details and recent activity.',
              accent: brand.colors.blue,
            },
            {
              key: 'batch' as const,
              label: 'Batch Check',
              subtitle: 'Scan multiple RFIDs and review the laundry status mix.',
              accent: brand.colors.blue,
            },
          ].map(option => {
            const selected = option.key === mode;
            return (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.modeCard,
                  {
                    backgroundColor: selected ? `${option.accent}12` : theme.surfaceAlt,
                    borderColor: selected ? `${option.accent}55` : theme.border,
                  },
                ]}
                onPress={() => {
                  setMode(option.key);
                  setError('');
                  setScanReady(false);
                  if (option.key === 'single') {
                    setExpectedCountInput('');
                    setBatchEntries([]);
                    setActiveBatchFilter('all');
                  }
                }}
              >
                <View style={styles.modeHeader}>
                  <Text
                    style={[
                      styles.modeTitle,
                      { color: selected ? option.accent : theme.text },
                    ]}
                  >
                    {option.label}
                  </Text>
                  {selected ? (
                    <View
                      style={[
                        styles.modeBadge,
                        {
                          backgroundColor: `${option.accent}18`,
                          borderColor: `${option.accent}40`,
                        },
                      ]}
                    >
                      <Text style={[styles.modeBadgeText, { color: option.accent }]}>
                        Active
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.modeSubtitle, { color: theme.textMuted }]}>
                  {option.subtitle}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[
            styles.scanButton,
            { backgroundColor: scannerConnected ? theme.primary : theme.surfaceStrong },
          ]}
          onPress={startScannerLookup}
          disabled={!scannerConnected}
        >
          <Text style={styles.scanButtonText}>
            {scanReady
              ? mode === 'batch'
                ? 'Scanner Ready For Batch'
                : 'Scanner Ready'
              : mode === 'batch'
              ? 'Scan Laundry RFIDs'
              : 'Scan Laundry RFID'}
          </Text>
        </TouchableOpacity>

        <View style={styles.manualRow}>
          <TextInput
            style={[
              styles.textInput,
              styles.queryInput,
              {
                borderColor: theme.border,
                color: theme.text,
                backgroundColor: theme.surfaceAlt,
              },
            ]}
            autoCapitalize="characters"
            placeholder={mode === 'batch' ? 'Enter RFID / EPC to add' : 'Enter RFID / EPC'}
            placeholderTextColor={theme.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => {
              if (mode === 'batch') {
                addBatchLookup(query);
              } else {
                runSingleLookup(query);
              }
            }}
          />
          <TouchableOpacity
            style={[
              styles.checkButton,
              { backgroundColor: loading ? theme.surfaceStrong : theme.primary },
            ]}
            onPress={() => {
              if (mode === 'batch') {
                addBatchLookup(query);
              } else {
                runSingleLookup(query);
              }
            }}
            disabled={loading}
          >
            <Text style={styles.checkButtonText}>
              {loading ? 'Working...' : mode === 'batch' ? 'Add' : 'Check'}
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'batch' ? (
          <View
            style={[
              styles.targetCard,
              {
                backgroundColor: batchProgressBackground,
                borderColor: batchProgressBorder,
              },
            ]}
          >
            <Text style={[styles.cardKicker, { color: theme.textMuted }]}>Expected count</Text>
            <Text style={[styles.targetHint, { color: theme.textMuted }]}>
              Set how many fabrics should be in this batch, then scan until the count matches.
            </Text>

            <View style={styles.counterRow}>
              <TouchableOpacity
                style={[
                  styles.counterButton,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
                onPress={() => setExpectedCountInput(String(Math.max(expectedCount - 1, 0) || ''))}
              >
                <Text style={[styles.counterButtonText, { color: theme.text }]}>-</Text>
              </TouchableOpacity>

              <TextInput
                style={[
                  styles.counterInput,
                  {
                    borderColor: theme.border,
                    color: theme.text,
                    backgroundColor: theme.surface,
                  },
                ]}
                value={expectedCountInput}
                onChangeText={value => setExpectedCountInput(value.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={theme.textMuted}
              />

              <TouchableOpacity
                style={[
                  styles.counterButton,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
                onPress={() => setExpectedCountInput(String(expectedCount + 1))}
              >
                <Text style={[styles.counterButtonText, { color: theme.text }]}>+</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.progressTrack, { backgroundColor: theme.surface }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: batchProgressColor, width: batchProgressWidth },
                ]}
              />
            </View>

            <Text style={[styles.targetHint, { color: theme.textMuted }]}>
              {expectedCount > 0
                ? batchMatched
                  ? 'This batch count is complete.'
                  : batchOver
                  ? 'This batch is over target. Remove extra tags or clear and restart.'
                  : `${Math.max(expectedCount - batchEntries.length, 0)} more fabric${
                      expectedCount - batchEntries.length === 1 ? '' : 's'
                    } needed to match the batch.`
                : 'Set the expected count before scanning.'}
            </Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={[styles.errorPanel, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {mode === 'single' && item ? (
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
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderCopy}>
              <Text style={[styles.cardKicker, { color: theme.textMuted }]}>Tracked fabric</Text>
              <Text style={[styles.cardTitle, { color: theme.text }]}>
                {item.item_name || item.type_name || 'Unnamed fabric'}
              </Text>
            </View>
            <View
              style={[
                styles.epcPill,
                { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.epcPillText, { color: theme.text }]}>
                {String(item.epc || '').slice(-8)}
              </Text>
            </View>
          </View>

          <View style={styles.pillRow}>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: statusPill.backgroundColor, borderColor: statusPill.borderColor },
              ]}
            >
              <Text style={[styles.statusPillText, { color: statusPill.textColor }]}>
                {String(item.status || 'UNKNOWN').replace(/_/g, ' ')}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor: lifecyclePill.backgroundColor,
                  borderColor: lifecyclePill.borderColor,
                },
              ]}
            >
              <Text style={[styles.statusPillText, { color: lifecyclePill.textColor }]}>
                {String(item.lifecycle_state || 'OK').replace(/_/g, ' ')}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor: warningPill.backgroundColor,
                  borderColor: warningPill.borderColor,
                },
              ]}
            >
              <Text style={[styles.statusPillText, { color: warningPill.textColor }]}>
                {washWarningLabel(warningStage)}
              </Text>
            </View>
          </View>

          <View style={styles.metricGrid}>
            <MetricCard
              label="Current location"
              value={item.current_location || 'No location'}
              theme={theme}
            />
            <MetricCard
              label="Cycle usage"
              value={`${Number(item.wash_cycle_count || 0)} / ${Number(item.max_wash_cycles || 0)}`}
              theme={theme}
            />
            <MetricCard label="Wash warning" value={washWarningLabel(warningStage)} theme={theme} />
          </View>

          <DetailRow label="RFID" value={item.epc} theme={theme} />
          <DetailRow
            label="Category"
            value={item.fabric_type || item.item_category || 'Unassigned'}
            theme={theme}
          />
          <DetailRow label="Size" value={item.size_label || 'Unassigned'} theme={theme} />
          <DetailRow label="Assigned To" value={item.assigned_to || 'Not assigned'} theme={theme} />
          <DetailRow
            label="Last Activity"
            value={formatTime(item.last_event_at || item.created_at)}
            theme={theme}
          />
        </View>
      ) : null}

      {mode === 'single' && item ? (
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
          <Text style={[styles.cardTitle, { color: theme.text }]}>Recent activity</Text>
          {filteredEvents.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              No recent laundry events were found for this RFID.
            </Text>
          ) : (
            filteredEvents.slice(0, 5).map(event => (
              <View
                key={event.id}
                style={[
                  styles.eventCard,
                  {
                    backgroundColor: theme.surfaceAlt,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Text style={[styles.eventTitle, { color: theme.text }]}>
                  {String(event.event_type || 'EVENT').replace(/_/g, ' ')}
                </Text>
                <Text style={[styles.eventMeta, { color: theme.textMuted }]}>
                  {formatTime(event.created_at)}
                </Text>
                <Text style={[styles.eventMeta, { color: theme.textMuted }]}>
                  Location {event.location_label || 'No location'}
                </Text>
                <Text style={[styles.eventMeta, { color: theme.textMuted }]}>
                  Cycle after {Number(event.wash_cycle_after || 0)}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}

      {mode === 'batch' ? (
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
          <View style={styles.batchHeader}>
            <View>
              <Text style={[styles.cardKicker, { color: theme.textMuted }]}>Batch summary</Text>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Batch check</Text>
            </View>
            <View
              style={[
                styles.summaryBadge,
                { backgroundColor: batchProgressBackground, borderColor: batchProgressBorder },
              ]}
            >
              <Text style={[styles.summaryBadgeValue, { color: batchProgressColor }]}>
                {expectedCount > 0 ? `${batchEntries.length}/${expectedCount}` : batchEntries.length}
              </Text>
              <Text style={[styles.summaryBadgeLabel, { color: theme.textMuted }]}>
                {batchProgressLabel}
              </Text>
            </View>
          </View>

          <View style={styles.metricGrid}>
            <BatchMetricButton
              label="Scanned"
              value={batchSummary.scanned}
              theme={theme}
              selected={activeBatchFilter === 'all'}
              onPress={() => setActiveBatchFilter('all')}
            />
            <BatchMetricButton
              label="Known"
              value={batchSummary.known}
              theme={theme}
              selected={activeBatchFilter === 'known'}
              onPress={() => setActiveBatchFilter('known')}
            />
            <BatchMetricButton
              label="In Wash"
              value={batchSummary.inWash}
              theme={theme}
              selected={activeBatchFilter === 'in_wash'}
              onPress={() => setActiveBatchFilter('in_wash')}
            />
            <BatchMetricButton
              label="Attention"
              value={batchSummary.flagged}
              theme={theme}
              selected={activeBatchFilter === 'attention'}
              onPress={() => setActiveBatchFilter('attention')}
            />
          </View>

          {batchEntries.length ? (
            <Text style={[styles.filterLabel, { color: theme.textMuted }]}>
              Showing: {activeBatchFilterLabel}
            </Text>
          ) : null}

          {batchEntries.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              Set the expected count, then scan several laundry RFIDs to build a quick status check.
            </Text>
          ) : filteredBatchEntries.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              No scanned fabrics match this filter yet.
            </Text>
          ) : (
            filteredBatchEntries.map(entry => {
              const entryStatus = statusTone(theme, entry.item?.status);
              const entryLifecycle = lifecycleTone(theme, entry.item?.lifecycle_state);
              const entryWarningStage = washWarningStage(entry.item);
              const entryWarningTone = washWarningTone(theme, entryWarningStage);
              return (
                <View
                  key={entry.epc}
                  style={[
                    styles.batchItemCard,
                    {
                      backgroundColor: theme.surfaceAlt,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <View style={styles.batchItemHeader}>
                    <View style={styles.batchItemCopy}>
                      <Text style={[styles.batchItemTitle, { color: theme.text }]}>
                        {entry.item?.item_name || entry.item?.type_name || entry.epc}
                      </Text>
                      <Text style={[styles.batchItemMeta, { color: theme.textMuted }]}>
                        RFID {entry.epc}
                      </Text>
                    </View>
                    <View style={styles.batchPillWrap}>
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor: entry.item
                              ? entryStatus.backgroundColor
                              : '#FEE2E2',
                            borderColor: entry.item ? entryStatus.borderColor : '#FCA5A5',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusPillText,
                            { color: entry.item ? entryStatus.textColor : '#991B1B' },
                          ]}
                        >
                          {entry.item
                            ? String(entry.item.status || 'UNKNOWN').replace(/_/g, ' ')
                            : 'UNKNOWN'}
                        </Text>
                      </View>
                      {entry.item ? (
                        <View
                          style={[
                            styles.statusPill,
                            {
                              backgroundColor: entryLifecycle.backgroundColor,
                              borderColor: entryLifecycle.borderColor,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusPillText,
                              { color: entryLifecycle.textColor },
                            ]}
                          >
                            {String(entry.item.lifecycle_state || 'OK').replace(/_/g, ' ')}
                          </Text>
                        </View>
                      ) : null}
                      {entry.item ? (
                        <View
                          style={[
                            styles.statusPill,
                            {
                              backgroundColor: entryWarningTone.backgroundColor,
                              borderColor: entryWarningTone.borderColor,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusPillText,
                              { color: entryWarningTone.textColor },
                            ]}
                          >
                            {washWarningLabel(entryWarningStage)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  {entry.item ? (
                    <>
                      <Text style={[styles.batchItemMeta, { color: theme.textMuted }]}>
                        Location {entry.item.current_location || 'No location'}
                      </Text>
                      <Text style={[styles.batchItemMeta, { color: theme.textMuted }]}>
                        Cycles {Number(entry.item.wash_cycle_count || 0)} /{' '}
                        {Number(entry.item.max_wash_cycles || 0)}
                      </Text>
                    </>
                  ) : (
                    <Text style={[styles.batchItemError, { color: '#991B1B' }]}>
                      {entry.error || 'Not registered in the current laundry store.'}
                    </Text>
                  )}
                </View>
              );
            })
          )}

          {batchEntries.length ? (
            <TouchableOpacity
              style={[
                styles.clearBatchButton,
                { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
              ]}
              onPress={() => {
                setBatchEntries([]);
                setExpectedCountInput('');
                setActiveBatchFilter('all');
                setError('');
                setScanReady(false);
              }}
            >
              <Text style={[styles.clearBatchText, { color: theme.text }]}>Clear Batch</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
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
    alignItems: 'center',
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
  modeGrid: {
    gap: 10,
    marginBottom: 12,
  },
  modeCard: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  modeTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  modeSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  modeBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  scanButton: {
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  targetCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
  },
  targetHint: {
    fontSize: 13,
    lineHeight: 18,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    marginBottom: 12,
  },
  counterButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterButtonText: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 24,
  },
  counterInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
  },
  progressTrack: {
    height: 12,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 10,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontWeight: '600',
  },
  queryInput: {
    flex: 1,
  },
  checkButton: {
    minWidth: 108,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  errorPanel: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  card: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    marginBottom: 16,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  cardHeaderCopy: {
    flex: 1,
  },
  cardKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 24,
  },
  epcPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  epcPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  metricCard: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  detailRow: {
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  eventCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  eventMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  batchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  summaryBadge: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 92,
  },
  summaryBadgeValue: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 2,
  },
  summaryBadgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  clearBatchButton: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
    alignItems: 'center',
  },
  clearBatchText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  batchItemCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
  },
  batchItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  batchItemCopy: {
    flex: 1,
  },
  batchItemTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  batchItemMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  batchPillWrap: {
    gap: 8,
    alignItems: 'flex-end',
  },
  batchItemError: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
});
