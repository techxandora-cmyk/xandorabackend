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
import ScreenHeader from './ScreenHeader';
import { useScanner, useScannerInput } from '../context/ScannerContext';
import { useAppTheme } from '../context/ThemeContext';
import { getAccessibleStores, getAuthSession, setCurrentStoreId } from '../services/session';
import { LaundryAction, LaundryItem, runLaundryAction } from '../services/laundryService';

export type LaundryWorkspaceOption = {
  key: LaundryAction;
  label: string;
  subtitle: string;
  buttonLabel: string;
  locationDefault?: string;
  accent: string;
};

export default function LaundryActionWorkspace({
  navigation,
  title,
  eyebrow,
  helper,
  options,
  requireExpectedCount = false,
  currentStepLabel = 'Current step',
  batchDetailsLabel = 'Batch details',
  latestScansLabel = 'Latest scans',
  emptyStateTitle = 'No RFID in batch yet',
  emptyStateText = 'Scan fabrics into this batch, then run the selected laundry action.',
  errorTitle = 'Action blocked',
  successTitle = 'Batch updated',
  resultsKicker = 'Recent update',
  resultsTitle = 'Recently updated fabrics',
}: {
  navigation: any;
  title: string;
  eyebrow: string;
  helper: string;
  options: LaundryWorkspaceOption[];
  requireExpectedCount?: boolean;
  currentStepLabel?: string;
  batchDetailsLabel?: string;
  latestScansLabel?: string;
  emptyStateTitle?: string;
  emptyStateText?: string;
  errorTitle?: string;
  successTitle?: string;
  resultsKicker?: string;
  resultsTitle?: string;
}) {
  const { scannerConnected } = useScanner();
  const { theme } = useAppTheme();
  const inputRef = useRef<TextInput>(null);
  const [selectedAction, setSelectedAction] = useState<LaundryAction>(options[0]?.key || 'audit');
  const [locationLabel, setLocationLabel] = useState(options[0]?.locationDefault || '');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [epcs, setEpcs] = useState<string[]>([]);
  const [expectedCountInput, setExpectedCountInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [resultItems, setResultItems] = useState<LaundryItem[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [scanReady, setScanReady] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);

  const activeOption = options.find(option => option.key === selectedAction) || options[0];
  const accent = activeOption?.accent || theme.primary;
  const expectedCount = Math.max(Number(expectedCountInput || 0) || 0, 0);
  const isTargetMet = expectedCount > 0 ? epcs.length === expectedCount : epcs.length > 0;
  const isOverTarget = expectedCount > 0 && epcs.length > expectedCount;
  const progressTone = expectedCount > 0 ? (isTargetMet ? 'matched' : isOverTarget ? 'over' : 'pending') : epcs.length ? 'pending' : 'idle';
  const recentTags = useMemo(() => epcs.slice(-6).reverse(), [epcs]);

  useEffect(() => {
    setLocationLabel(activeOption?.locationDefault || '');
  }, [activeOption?.key, activeOption?.locationDefault]);

  useEffect(() => {
    let mounted = true;

    const loadStoreContext = async () => {
      const session = await getAuthSession();
      const availableStores = getAccessibleStores(session?.user);
      const resolvedStoreId = String(
        session?.currentStoreId || availableStores[0]?.id || '',
      )
        .trim()
        .toUpperCase();

      if (!mounted) return;
      setStores(availableStores);
      setStoreId(resolvedStoreId);
    };

    loadStoreContext();

    return () => {
      mounted = false;
    };
  }, []);

  const progressColor =
    progressTone === 'matched' ? theme.success : progressTone === 'over' ? '#EF4444' : accent;
  const progressBackground =
    progressTone === 'matched' ? `${theme.success}12` : progressTone === 'over' ? '#FEE2E2' : `${accent}10`;
  const progressBorder =
    progressTone === 'matched' ? `${theme.success}45` : progressTone === 'over' ? '#FCA5A5' : `${accent}35`;
  const progressWidth = `${Math.max(
    expectedCount > 0 ? Math.min((epcs.length / expectedCount) * 100, 100) : epcs.length ? 24 : 0,
    0,
  )}%` as `${number}%`;
  const progressLabel =
    progressTone === 'matched'
      ? 'Batch matched'
      : progressTone === 'over'
      ? 'Over target'
      : progressTone === 'pending'
      ? 'In progress'
      : 'Ready';

  const startScan = () => {
    if (!scannerConnected) {
      Alert.alert('Scanner offline', 'Connect the scanner first, then scan laundry items.');
      return;
    }
    setScanReady(true);
    setError('');
    inputRef.current?.focus();
  };

  const handleScan = (value: string) => {
    const tag = String(value || '').trim().toUpperCase();
    if (!tag || !scanReady) return;
    if (epcs.includes(tag)) {
      Alert.alert('Duplicate RFID', 'This fabric tag is already in the current batch.');
      inputRef.current?.focus();
      return;
    }
    setEpcs(prev => [...prev, tag]);
    setMessage('');
    setError('');
    inputRef.current?.focus();
  };

  const clearBatch = () => {
    setEpcs([]);
    setExpectedCountInput('');
    setReferenceNo('');
    setNotes('');
    setResultItems([]);
    setMessage('');
    setError('');
    setScanReady(false);
  };

  const submitAction = async () => {
    if (!epcs.length) return setError('Scan at least one RFID before running this action.');
    if (requireExpectedCount && expectedCount <= 0) return setError('Enter how many fabrics should be in this batch first.');
    if (expectedCount > 0 && epcs.length !== expectedCount) {
      return setError(
        isOverTarget
          ? 'Scanned items are over the expected batch count. Remove the extra RFID or clear the batch.'
          : 'Keep scanning until the batch count matches the expected number of fabrics.',
      );
    }

    setProcessing(true);
    setError('');
    setMessage('');
    try {
      const response = await runLaundryAction({
        action: selectedAction,
        epcs,
        storeId: storeId || undefined,
        locationLabel,
        referenceNo,
        notes,
      });
      setResultItems(response.items);
      setMessage(`${activeOption?.label || 'Action'} complete for ${response.processed} item${response.processed === 1 ? '' : 's'}.`);
      setEpcs([]);
      setExpectedCountInput('');
      setReferenceNo('');
      setNotes('');
      setScanReady(false);
    } catch (err: any) {
      const missingEpcs = Array.isArray(err?.response?.data?.missing_epcs) ? err.response.data.missing_epcs.join(', ') : '';
      setError(missingEpcs ? `Missing from Laundry: ${missingEpcs}` : err?.response?.data?.error || err?.message || 'Could not complete this laundry action.');
    } finally {
      setProcessing(false);
    }
  };

  useScannerInput(handleScan, scannerConnected);

  return (
    <ScrollView style={[styles.screen, { backgroundColor: theme.background }]} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader title={title} onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Home'))} />

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

      <View style={[styles.heroCard, { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow }]}>
        <View style={styles.row}>
          <View style={[styles.pill, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
            <Text style={[styles.pillText, { color: theme.textMuted }]}>{eyebrow}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: scannerConnected ? `${theme.success}12` : theme.surfaceAlt, borderColor: scannerConnected ? `${theme.success}45` : theme.border }]}>
            <Text style={[styles.pillText, { color: scannerConnected ? theme.success : theme.textMuted }]}>
              {scannerConnected ? 'Scanner online' : 'Scanner offline'}
            </Text>
          </View>
        </View>
        <Text style={[styles.heroTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.heroHelper, { color: theme.textMuted }]}>{helper}</Text>

        {options.length > 1
          ? options.map(option => {
              const selected = option.key === selectedAction;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.modeCard, { backgroundColor: selected ? `${option.accent}12` : theme.surfaceAlt, borderColor: selected ? `${option.accent}55` : theme.border }]}
                  onPress={() => {
                    setSelectedAction(option.key);
                    setMessage('');
                    setError('');
                  }}
                >
                  <View style={styles.row}>
                    <Text style={[styles.modeTitle, { color: selected ? option.accent : theme.text }]}>{option.label}</Text>
                    {selected ? (
                      <View style={[styles.modeBadge, { backgroundColor: `${option.accent}18`, borderColor: `${option.accent}40` }]}>
                        <Text style={[styles.modeBadgeText, { color: option.accent }]}>Active</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.modeSubtitle, { color: theme.textMuted }]}>{option.subtitle}</Text>
                </TouchableOpacity>
              );
            })
          : (
            <View style={[styles.singleModeCard, { backgroundColor: `${accent}10`, borderColor: `${accent}35` }]}>
              <Text style={[styles.modeTitle, { color: accent }]}>{activeOption?.label || title}</Text>
              <Text style={[styles.modeSubtitle, { color: theme.textMuted }]}>{activeOption?.subtitle}</Text>
            </View>
          )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow }]}>
        <View style={[styles.summaryStrip, { backgroundColor: progressBackground, borderColor: progressBorder }]}>
          <View>
            <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{currentStepLabel}</Text>
            <Text style={[styles.summaryTitle, { color: theme.text }]}>{activeOption?.label || title}</Text>
          </View>
          <View style={styles.summaryMetrics}>
            <Text style={[styles.summaryMetricValue, { color: progressColor }]}>{expectedCount > 0 ? `${epcs.length}/${expectedCount}` : epcs.length}</Text>
            <Text style={[styles.summaryMetricLabel, { color: theme.textMuted }]}>{progressLabel}</Text>
          </View>
        </View>

        <View style={styles.scanRow}>
          <TouchableOpacity style={[styles.primaryScanButton, { backgroundColor: scannerConnected ? accent : theme.surfaceStrong }]} onPress={startScan} disabled={!scannerConnected}>
            <Text style={styles.primaryScanText}>{scanReady ? 'Scanner Ready' : 'Scan Laundry RFID'}</Text>
            <Text style={styles.primaryScanSubtext}>{scanReady ? 'Keep scanning into this batch' : 'Tap once, then start scanning'}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.targetCard, { backgroundColor: progressBackground, borderColor: progressBorder }]}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{requireExpectedCount ? 'Required count' : 'Batch target'}</Text>
          <Text style={[styles.targetHint, { color: theme.textMuted }]}>{requireExpectedCount ? 'Set the planned batch size first, then scan until it matches.' : 'Optional. Use a target only if this batch should match a planned count.'}</Text>
          <View style={styles.counterRow}>
            <TouchableOpacity style={[styles.counterButton, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => setExpectedCountInput(String(Math.max(expectedCount - 1, 0) || ''))}>
              <Text style={[styles.counterButtonText, { color: theme.text }]}>-</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.counterInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
              value={expectedCountInput}
              onChangeText={value => setExpectedCountInput(value.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={theme.textMuted}
            />
            <TouchableOpacity style={[styles.counterButton, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => setExpectedCountInput(String(expectedCount + 1))}>
              <Text style={[styles.counterButtonText, { color: theme.text }]}>+</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: theme.surface }]}>
            <View style={[styles.progressFill, { backgroundColor: progressColor, width: progressWidth }]} />
          </View>
          <Text style={[styles.targetHint, { color: theme.textMuted }]}>
            {expectedCount > 0
              ? isTargetMet
                ? 'This batch is fully matched and ready to process.'
                : isOverTarget
                ? 'This batch is over target. Remove the extra RFID before continuing.'
                : `${Math.max(expectedCount - epcs.length, 0)} more fabric${expectedCount - epcs.length === 1 ? '' : 's'} needed to match the batch.`
              : epcs.length
              ? 'Batch is ready. Add a target only if you need a strict count.'
              : 'Start scanning fabrics to build this batch.'}
          </Text>
        </View>

        <View style={[styles.storeCard, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
          <View style={styles.row}>
            <View style={styles.storeCopy}>
              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>Store</Text>
              <Text style={[styles.storeValue, { color: theme.text }]}>{storeId || 'No store'}</Text>
              <Text style={[styles.storeHint, { color: theme.textMuted }]}>
                Select where this batch was picked up or dropped off.
              </Text>
            </View>
            {stores.length > 1 ? (
              <TouchableOpacity
                style={[styles.pill, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => setStoreMenuOpen(open => !open)}
              >
                <Text style={[styles.pillText, { color: theme.text }]}>
                  {storeMenuOpen ? 'Hide' : 'Change'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {stores.length > 1 && storeMenuOpen
            ? stores.map(store => {
                const selected = store.id === storeId;
                return (
                  <TouchableOpacity
                    key={store.id}
                    style={[
                      styles.storeOption,
                      {
                        backgroundColor: selected ? `${theme.primary}12` : theme.surface,
                        borderColor: selected ? `${theme.primary}45` : theme.border,
                      },
                    ]}
                    onPress={async () => {
                      const nextStoreId = String(store.id || '').trim().toUpperCase();
                      setStoreId(nextStoreId);
                      setStoreMenuOpen(false);
                      await setCurrentStoreId(nextStoreId);
                    }}
                  >
                    <Text style={[styles.storeOptionText, { color: selected ? theme.primary : theme.text }]}>
                      {store.name}
                    </Text>
                    {selected ? (
                      <Text style={[styles.storeOptionBadge, { color: theme.primary }]}>Active</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })
            : null}
        </View>

        <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{batchDetailsLabel}</Text>
        <TextInput style={[styles.input, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, color: theme.text }]} placeholder="Location / handoff point" placeholderTextColor={theme.textMuted} value={locationLabel} onChangeText={setLocationLabel} />
        <TextInput style={[styles.input, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, color: theme.text }]} placeholder="Batch / reference no." placeholderTextColor={theme.textMuted} value={referenceNo} onChangeText={setReferenceNo} />
        <TextInput style={[styles.input, styles.notes, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, color: theme.text }]} placeholder="Optional notes" placeholderTextColor={theme.textMuted} value={notes} onChangeText={setNotes} multiline />

        <View style={[styles.row, { marginBottom: 10 }]}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{latestScansLabel}</Text>
          {epcs.length ? (
            <TouchableOpacity style={[styles.pill, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]} onPress={() => setEpcs(prev => prev.slice(0, -1))}>
              <Text style={[styles.pillText, { color: theme.text }]}>Undo last</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {recentTags.length ? (
          <View style={styles.chipWrap}>
            {recentTags.map(tag => (
              <View key={tag} style={[styles.chip, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
                <Text style={[styles.chipText, { color: theme.text }]}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>{emptyStateTitle}</Text>
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>{emptyStateText}</Text>
          </View>
        )}

        <TouchableOpacity style={[styles.mainButton, { backgroundColor: processing || (requireExpectedCount && !isTargetMet) ? theme.surfaceStrong : accent }]} onPress={submitAction} disabled={processing || (requireExpectedCount && !isTargetMet)}>
          <Text style={styles.mainButtonText}>{processing ? 'Processing...' : activeOption?.buttonLabel || 'Run Action'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.secondaryButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]} onPress={clearBatch}>
          <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Clear Batch</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={[styles.feedback, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}>
          <Text style={styles.errorTitle}>{errorTitle}</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {message ? (
        <View style={[styles.feedback, { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' }]}>
          <Text style={styles.successTitle}>{successTitle}</Text>
          <Text style={styles.successText}>{message}</Text>
        </View>
      ) : null}

      {resultItems.length ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow }]}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{resultsKicker}</Text>
          <Text style={[styles.summaryTitle, { color: theme.text, marginBottom: 12 }]}>{resultsTitle}</Text>
          {resultItems.slice(0, 6).map(item => (
            <View key={`${item.id}-${item.epc}`} style={[styles.resultCard, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
              <Text style={[styles.resultTitle, { color: theme.text }]}>{item.item_name || item.type_name || item.epc}</Text>
              <Text style={[styles.resultMeta, { color: theme.textMuted }]}>RFID {item.epc}</Text>
              <Text style={[styles.resultMeta, { color: theme.textMuted }]}>Status {String(item.status || 'UNKNOWN').replace(/_/g, ' ')}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 28 },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  heroCard: { borderWidth: 1, borderRadius: 24, padding: 22, marginBottom: 16, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  pillText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  heroTitle: { fontSize: 24, fontWeight: '800', lineHeight: 30, marginTop: 14, marginBottom: 8 },
  heroHelper: { fontSize: 14, lineHeight: 21, marginBottom: 16 },
  modeCard: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10 },
  singleModeCard: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10 },
  modeTitle: { flex: 1, fontSize: 15, fontWeight: '800' },
  modeSubtitle: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  modeBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  modeBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  card: { borderRadius: 24, padding: 20, borderWidth: 1, marginBottom: 16, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  summaryStrip: { borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  summaryTitle: { fontSize: 20, fontWeight: '800', lineHeight: 24 },
  summaryMetrics: { alignItems: 'flex-end' },
  summaryMetricValue: { fontSize: 22, fontWeight: '800' },
  summaryMetricLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  scanRow: { marginBottom: 14 },
  primaryScanButton: { borderRadius: 18, minHeight: 86, paddingHorizontal: 16, paddingVertical: 15, justifyContent: 'center' },
  primaryScanText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  primaryScanSubtext: { color: 'rgba(255,255,255,0.82)', fontSize: 12, lineHeight: 16, fontWeight: '600' },
  targetCard: { borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 14 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 6 },
  targetHint: { fontSize: 13, lineHeight: 18 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 12 },
  counterButton: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  counterButtonText: { fontSize: 24, fontWeight: '700', lineHeight: 24 },
  counterInput: { flex: 1, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, textAlign: 'center', fontSize: 18, fontWeight: '800' },
  progressTrack: { height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: '100%', borderRadius: 999 },
  storeCard: { borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 14 },
  storeCopy: { flex: 1 },
  storeValue: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  storeHint: { fontSize: 13, lineHeight: 18 },
  storeOption: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  storeOptionText: { fontSize: 14, fontWeight: '700', flex: 1 },
  storeOptionBadge: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontWeight: '600', marginBottom: 10 },
  notes: { minHeight: 82, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 12, fontWeight: '700' },
  emptyCard: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 16, marginBottom: 14 },
  emptyTitle: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  emptyText: { fontSize: 14, lineHeight: 20 },
  mainButton: { borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  mainButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: { borderWidth: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: 13, fontWeight: '800' },
  feedback: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16 },
  errorTitle: { color: '#991B1B', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  errorText: { color: '#991B1B', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  successTitle: { color: '#166534', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  successText: { color: '#166534', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  resultCard: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 10 },
  resultTitle: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  resultMeta: { fontSize: 13, lineHeight: 18 },
});
