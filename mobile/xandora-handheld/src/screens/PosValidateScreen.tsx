import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { useScanner } from '../context/ScannerContext';
import { useAppTheme } from '../context/ThemeContext';
import { getCurrentStoreId } from '../services/session';
import {
  cancelRetailBillingSession,
  completeRetailBillingSession,
  getRetailBillingState,
  RetailBillingSession,
  RetailBillingSummary,
  RetailScanRecord,
  RetailValidation,
  scanRetailBillingEpc,
  startRetailBillingSession,
} from '../services/retailService';

const EMPTY_SUMMARY: RetailBillingSummary = {
  expected_items_count: 0,
  scanned_items_count: 0,
  matched_items_count: 0,
  missing_items_count: 0,
  accuracy_percent: 0,
  total_reads: 0,
  duplicate_count: 0,
  unknown_count: 0,
  already_billed_count: 0,
  validation_failed_count: 0,
  duration_seconds: 0,
  read_rate: 0,
};

const MAX_RECENT_SCANS = 10;
const RFID_DEDUPE_WINDOW_MS = 6000;

function formatDuration(seconds: unknown): string {
  const total = Math.max(Number(seconds || 0), 0);
  if (!Number.isFinite(total) || total <= 0) return '0s';
  if (total < 60) return `${Math.round(total)}s`;
  const minutes = Math.floor(total / 60);
  const remaining = Math.round(total % 60);
  if (minutes < 60) return `${minutes}m ${remaining}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTime(value?: string | null): string {
  if (!value) return 'Waiting';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waiting';
  return date.toLocaleTimeString();
}

function normalizeEpcInput(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function mergeRecentScan(
  current: RetailScanRecord[],
  incoming: RetailScanRecord,
): RetailScanRecord[] {
  const normalizedIncomingEpc = normalizeEpcInput(incoming.epc);
  const remaining = current.filter(
    row => normalizeEpcInput(row.epc) !== normalizedIncomingEpc,
  );
  return [incoming, ...remaining].slice(0, MAX_RECENT_SCANS);
}

function toneByStatus(status?: string | null) {
  switch (String(status || '').toUpperCase()) {
    case 'MATCHED':
      return {
        backgroundColor: '#DCFCE7',
        borderColor: '#86EFAC',
        textColor: '#166534',
      };
    case 'UNKNOWN_EPC':
      return {
        backgroundColor: '#FEF3C7',
        borderColor: '#FCD34D',
        textColor: '#92400E',
      };
    case 'DUPLICATE':
      return {
        backgroundColor: '#DBEAFE',
        borderColor: '#93C5FD',
        textColor: '#1D4ED8',
      };
    case 'ALREADY_BILLED':
      return {
        backgroundColor: '#FCE7F3',
        borderColor: '#F9A8D4',
        textColor: '#9D174D',
      };
    case 'PENDING':
      return {
        backgroundColor: '#F3F4F6',
        borderColor: '#D1D5DB',
        textColor: '#6B7280',
      };
    default:
      return {
        backgroundColor: '#FEE2E2',
        borderColor: '#FCA5A5',
        textColor: '#991B1B',
      };
  }
}

function issueCount(summary: RetailBillingSummary): number {
  return (
    Number(summary.duplicate_count || 0) +
    Number(summary.unknown_count || 0) +
    Number(summary.already_billed_count || 0) +
    Number(summary.validation_failed_count || 0)
  );
}

function SummaryTile({
  label,
  value,
  hint,
  theme,
}: {
  label: string;
  value: string;
  hint?: string;
  theme: any;
}) {
  return (
    <View
      style={[
        styles.summaryTile,
        {
          backgroundColor: theme.surfaceAlt,
          borderColor: theme.border,
        },
      ]}
    >
      <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: theme.text }]}>{value}</Text>
      {hint ? <Text style={[styles.summaryHint, { color: theme.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

export default function PosValidateScreen({ navigation }: any) {
  const {
    addScanListener,
    connectedDevice,
    scannerConnected,
    startScanSession,
    stopScanSession,
  } = useScanner();
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const [storeId, setStoreId] = useState('');
  const [session, setSession] = useState<RetailBillingSession | null>(null);
  const [summary, setSummary] = useState<RetailBillingSummary>(EMPTY_SUMMARY);
  const [scans, setScans] = useState<RetailScanRecord[]>([]);
  const [manualEpc, setManualEpc] = useState('');
  const [expectedCountInput, setExpectedCountInput] = useState('');
  const [lastValidation, setLastValidation] = useState<RetailValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rawScanCount, setRawScanCount] = useState(0);
  const [lastRawScan, setLastRawScan] = useState('');
  const latestSessionRef = useRef<RetailBillingSession | null>(null);
  const sessionIdentityRef = useRef('');
  const pendingRfidQueueRef = useRef<string[]>([]);
  const queuedRfidEpcsRef = useRef(new Set<string>());
  const submittedRfidEpcsRef = useRef(new Set<string>());
  const recentRfidReadsRef = useRef(new Map<string, number>());
  const processingRfidQueueRef = useRef(false);
  const stateRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasActiveSession = String(session?.status || '').toUpperCase() === 'ACTIVE';

  useEffect(() => {
    latestSessionRef.current = session;

    const nextIdentity = String(session?.session_id || session?.id || '');
    if (!nextIdentity || sessionIdentityRef.current === nextIdentity) {
      return;
    }

    sessionIdentityRef.current = nextIdentity;
    pendingRfidQueueRef.current = [];
    queuedRfidEpcsRef.current.clear();
    submittedRfidEpcsRef.current.clear();
    recentRfidReadsRef.current.clear();
  }, [session]);

  useEffect(() => {
    return () => {
      if (stateRefreshTimeoutRef.current) {
        clearTimeout(stateRefreshTimeoutRef.current);
      }
    };
  }, []);

  const loadBillingState = useCallback(async () => {
    try {
      const [state, currentStore] = await Promise.all([
        getRetailBillingState(),
        getCurrentStoreId(),
      ]);
      setSession(state.session);
      setSummary(state.summary || EMPTY_SUMMARY);
      setScans(Array.isArray(state.scans) ? state.scans : []);
      setStoreId(currentStore || '');
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not load retail validation');
      setSession(null);
      setSummary(EMPTY_SUMMARY);
      setScans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBillingState();
  }, [loadBillingState]);

  useEffect(() => {
    if (!hasActiveSession) {
      return undefined;
    }

    const id = setInterval(() => {
      loadBillingState();
    }, 4000);

    return () => clearInterval(id);
  }, [hasActiveSession, loadBillingState]);

  const scheduleBillingStateRefresh = useCallback(() => {
    if (stateRefreshTimeoutRef.current) {
      clearTimeout(stateRefreshTimeoutRef.current);
    }

    stateRefreshTimeoutRef.current = setTimeout(() => {
      loadBillingState().catch(() => undefined);
    }, 350);
  }, [loadBillingState]);

  const handleStartSession = async () => {
    setBusy(true);
    setError('');

    try {
      const nextSession = await startRetailBillingSession(Number(expectedCountInput || 0));
      setSession(nextSession);
      setLastValidation(null);
      await loadBillingState();
    } catch (err: any) {
      console.log('[PosValidate] start session failed', err?.message, err?.response?.status, err?.response?.data);
      setError(err?.response?.data?.error || err?.message || 'Could not start retail validation');
    } finally {
      setBusy(false);
    }
  };

  const submitEpc = useCallback(async (rawValue: string, source: 'manual' | 'rfid' = 'manual') => {
    const epc = normalizeEpcInput(rawValue);
    if (!epc) {
      setError('Enter or scan an EPC first');
      return;
    }

    if (source === 'manual') {
      setBusy(true);
    }
    setError('');

    try {
      if (String(latestSessionRef.current?.status || '').toUpperCase() !== 'ACTIVE') {
        const nextSession = await startRetailBillingSession(Number(expectedCountInput || 0));
        latestSessionRef.current = nextSession;
        setSession(nextSession);
        setLastValidation(null);
      }

      const result = await scanRetailBillingEpc(epc);
      setLastValidation(result.validation);
      setSession(result.session);
      latestSessionRef.current = result.session;
      setManualEpc('');

      if (result.scan || result.validation) {
        const now = new Date().toISOString();
        const incomingScan: RetailScanRecord = {
          epc,
          read_count: Number(result.scan?.read_count || 1),
          device_id: result.scan?.device_id || null,
          first_seen: result.scan?.first_seen || now,
          last_seen: result.scan?.last_seen || now,
          validation_status:
            result.scan?.validation_status ||
            result.validation?.validation_status ||
            null,
          validation_label:
            result.scan?.validation_label ||
            result.validation?.validation_label ||
            null,
          validation_message:
            result.scan?.validation_message ||
            result.validation?.validation_message ||
            null,
          sku: result.scan?.sku || result.validation?.catalog_item?.sku || null,
          product_name:
            result.scan?.product_name ||
            result.validation?.catalog_item?.product_name ||
            null,
          price_lkr:
            result.scan?.price_lkr ??
            result.validation?.catalog_item?.price_lkr ??
            null,
        };

        setScans(current => mergeRecentScan(current, incomingScan));
      }

      scheduleBillingStateRefresh();
    } catch (err: any) {
      console.log('[PosValidate] submit EPC failed', epc, err?.message, err?.response?.status, err?.response?.data);
      setError(err?.response?.data?.error || err?.message || 'Could not validate EPC');
      throw err;
    } finally {
      if (source === 'manual') {
        setBusy(false);
      }
    }
  }, [expectedCountInput, scheduleBillingStateRefresh]);

  const processQueuedRfidScans = useCallback(() => {
    if (processingRfidQueueRef.current) {
      return;
    }

    processingRfidQueueRef.current = true;

    const run = async () => {
      while (pendingRfidQueueRef.current.length > 0) {
        // Submit up to 8 EPCs in parallel when session is active; fall back to serial
        // to avoid a race condition where multiple concurrent calls each try to auto-start the session.
        const sessionActive =
          String(latestSessionRef.current?.status || '').toUpperCase() === 'ACTIVE';
        const batch = pendingRfidQueueRef.current.splice(0, sessionActive ? 8 : 1);
        batch.forEach(epc => queuedRfidEpcsRef.current.delete(epc));

        await Promise.allSettled(
          batch.map(async epc => {
            try {
              await submitEpc(epc, 'rfid');
              submittedRfidEpcsRef.current.add(epc);
            } catch {
              recentRfidReadsRef.current.delete(epc);
            }
          }),
        );
      }
    };

    run()
      .catch(() => undefined)
      .finally(() => {
        processingRfidQueueRef.current = false;
        if (pendingRfidQueueRef.current.length > 0) {
          processQueuedRfidScans();
        }
      });
  }, [submitEpc]);

  const queueRfidScan = useCallback((rawValue: string) => {
    const epc = normalizeEpcInput(rawValue);
    if (!epc) {
      return;
    }

    const now = Date.now();
    for (const [knownEpc, seenAt] of recentRfidReadsRef.current.entries()) {
      if (now - seenAt > RFID_DEDUPE_WINDOW_MS) {
        recentRfidReadsRef.current.delete(knownEpc);
      }
    }

    const expectedCount = Number(latestSessionRef.current?.expected_items_count || 0);
    if (expectedCount > 0 && submittedRfidEpcsRef.current.size >= expectedCount) {
      return;
    }

    const lastSeenAt = recentRfidReadsRef.current.get(epc) || 0;
    if (
      submittedRfidEpcsRef.current.has(epc) ||
      queuedRfidEpcsRef.current.has(epc) ||
      now - lastSeenAt < RFID_DEDUPE_WINDOW_MS
    ) {
      return;
    }

    recentRfidReadsRef.current.set(epc, now);
    queuedRfidEpcsRef.current.add(epc);
    pendingRfidQueueRef.current.push(epc);

    // Show the EPC immediately in the list so the user sees it the instant it's scanned.
    // The validation status fills in once the API call resolves.
    const nowIso = new Date(now).toISOString();
    setScans(current => mergeRecentScan(current, {
      epc,
      read_count: 1,
      device_id: null,
      first_seen: nowIso,
      last_seen: nowIso,
      validation_status: 'PENDING',
      validation_label: 'Validating',
      validation_message: null,
      sku: null,
      product_name: null,
      price_lkr: null,
    }));

    processQueuedRfidScans();
  }, [processQueuedRfidScans]);

  const handleComplete = async () => {
    setBusy(true);
    setError('');
    try {
      await completeRetailBillingSession();
      setLastValidation(null);
      await loadBillingState();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not complete the session');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    Alert.alert('Cancel retail validation', 'Do you want to cancel the current retail validation session?', [
      { text: 'Keep session', style: 'cancel' },
      {
        text: 'Cancel session',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setError('');
          try {
            await cancelRetailBillingSession();
            setLastValidation(null);
            await loadBillingState();
          } catch (err: any) {
            setError(err?.response?.data?.error || err?.message || 'Could not cancel the session');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const latestValidationTone = toneByStatus(lastValidation?.validation_status);
  const latestScans = useMemo(() => scans.slice(0, MAX_RECENT_SCANS), [scans]);
  const sessionStatusText = hasActiveSession ? 'Active session' : 'No active session';
  const isCompact = width < 390;

  useEffect(() => {
    if (!scannerConnected) {
      return undefined;
    }

    startScanSession();
    const unsubscribe = addScanListener(payload => {
      setRawScanCount(current => current + 1);
      setLastRawScan(payload);
      queueRfidScan(payload);
    });

    return () => {
      unsubscribe();
      stopScanSession();
    };
  }, [
    addScanListener,
    queueRfidScan,
    scannerConnected,
    startScanSession,
    stopScanSession,
  ]);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, isCompact && styles.contentCompact]}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="POS Validate"
        onBack={() =>
          navigation.canGoBack() ? navigation.goBack() : navigation.replace('Home')
        }
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
        <View style={[styles.heroTopRow, isCompact && styles.heroTopRowCompact]}>
          <View>
            <Text style={[styles.eyebrow, { color: theme.textMuted }]}>Retail checkout control</Text>
            <Text style={[styles.heroTitle, isCompact && styles.heroTitleCompact, { color: theme.text }]}>
              Validate EPCs before POS
            </Text>
          </View>
          <View
            style={[
              styles.statusPill,
              isCompact && styles.statusPillCompact,
              {
                backgroundColor: hasActiveSession ? `${theme.accent}22` : theme.surfaceAlt,
                borderColor: hasActiveSession ? `${theme.accent}55` : theme.border,
              },
            ]}
          >
            <Text
              style={[
                styles.statusPillText,
                { color: hasActiveSession ? theme.text : theme.textMuted },
              ]}
            >
              {sessionStatusText}
            </Text>
          </View>
        </View>

        <Text style={[styles.heroHelper, { color: theme.textMuted }]}>
          Scan handheld EPC reads into the same validation statuses used by the retail billing
          workflow: matched, duplicate, already billed, unknown, and validation failed.
        </Text>

        <View style={[styles.scopeRow, isCompact && styles.scopeRowCompact]}>
          <View style={[styles.scopeBox, { backgroundColor: theme.surfaceAlt }]}>
            <Text style={[styles.scopeLabel, { color: theme.textMuted }]}>Store</Text>
            <Text style={[styles.scopeValue, { color: theme.text }]}>{storeId || 'No store'}</Text>
          </View>
          <View style={[styles.scopeBox, { backgroundColor: theme.surfaceAlt }]}>
            <Text style={[styles.scopeLabel, { color: theme.textMuted }]}>Duration</Text>
            <Text style={[styles.scopeValue, { color: theme.text }]}>
              {formatDuration(summary.duration_seconds || session?.duration_seconds)}
            </Text>
          </View>
        </View>
      </View>

      {error ? (
        <View style={[styles.errorPanel, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!hasActiveSession ? (
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
          <Text style={[styles.cardTitle, { color: theme.text }]}>Start retail session</Text>
          <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>
            Open a retail validation session before you scan EPCs for billing or checkout review.
          </Text>
          <TextInput
            style={[
              styles.textInput,
              {
                borderColor: theme.border,
                color: theme.text,
                backgroundColor: theme.surfaceAlt,
              },
            ]}
            keyboardType="numeric"
            placeholder="Expected item count (optional)"
            placeholderTextColor={theme.textMuted}
            value={expectedCountInput}
            onChangeText={setExpectedCountInput}
          />
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: busy ? theme.surfaceStrong : theme.primary }]}
            disabled={busy || loading}
            onPress={() => {
              handleStartSession();
            }}
          >
            <Text style={styles.primaryButtonText}>{busy ? 'Starting...' : 'Start POS Validation'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
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
          <View style={styles.actionHeader}>
            <View>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Session controls</Text>
              <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>
                Session {session?.session_id || 'LIVE'} • started {formatTime(session?.started_at)}
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.readerDebugPanel,
              {
                backgroundColor: theme.surfaceAlt,
                borderColor: theme.border,
              },
            ]}
          >
            <Text style={[styles.readerDebugLabel, { color: theme.textMuted }]}>Scanner status</Text>
            <Text style={[styles.readerDebugValue, { color: theme.text }]}>
              {scannerConnected
                ? `${connectedDevice?.name || 'Scanner'} connected`
                : 'Scanner not connected'}
            </Text>
            <Text style={[styles.readerDebugMeta, { color: theme.textMuted }]}>
              Raw RFID events in app: {rawScanCount}
            </Text>
            <Text
              style={[styles.readerDebugMeta, { color: theme.textMuted }]}
              numberOfLines={1}
            >
              Last raw EPC: {lastRawScan || 'Waiting for first read'}
            </Text>
          </View>

          <View style={[styles.actionRow, isCompact && styles.actionRowCompact]}>
            <TouchableOpacity
              style={[
                styles.secondaryButton,
                isCompact && styles.actionButtonCompact,
                { backgroundColor: busy ? theme.surfaceStrong : theme.success },
              ]}
              disabled={busy}
              onPress={() => {
                handleComplete();
              }}
            >
              <Text style={styles.secondaryButtonText}>{busy ? 'Working...' : 'Complete'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.cancelButton,
                isCompact && styles.actionButtonCompact,
                { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
              ]}
              onPress={handleCancel}
            >
              <Text style={[styles.cancelButtonText, { color: theme.text }]}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.manualEntryRow, isCompact && styles.manualEntryRowCompact]}>
            <TextInput
              style={[
                styles.textInput,
                styles.manualInput,
                isCompact && styles.manualInputCompact,
                {
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.surfaceAlt,
                },
              ]}
              autoCapitalize="characters"
              placeholder="Enter EPC manually"
              placeholderTextColor={theme.textMuted}
              value={manualEpc}
              onChangeText={setManualEpc}
              onSubmitEditing={() => {
                submitEpc(manualEpc).catch(() => undefined);
              }}
            />
            <TouchableOpacity
              style={[
                styles.primaryButton,
                styles.submitButton,
                isCompact && styles.submitButtonCompact,
                { backgroundColor: busy ? theme.surfaceStrong : theme.secondary },
              ]}
              disabled={busy}
              onPress={() => {
                submitEpc(manualEpc).catch(() => undefined);
              }}
            >
              <Text style={styles.primaryButtonText}>{busy ? 'Checking...' : 'Submit EPC'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.summaryGrid}>
        <SummaryTile
          label="Matched"
          value={String(summary.matched_items_count || 0)}
          hint="Ready for POS"
          theme={theme}
        />
        <SummaryTile
          label="Unique EPCs"
          value={String(summary.scanned_items_count || 0)}
          hint="Confirmed scans"
          theme={theme}
        />
        <SummaryTile
          label="Issues"
          value={String(issueCount(summary))}
          hint="Duplicates + unknowns"
          theme={theme}
        />
        <SummaryTile
          label="Read Rate"
          value={`${Number(summary.read_rate || 0).toFixed(1)}/s`}
          hint="Session throughput"
          theme={theme}
        />
      </View>

      {lastValidation ? (
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
          <Text style={[styles.cardTitle, { color: theme.text }]}>Latest validation</Text>
          <View
            style={[
              styles.validationBanner,
              {
                backgroundColor: latestValidationTone.backgroundColor,
                borderColor: latestValidationTone.borderColor,
              },
            ]}
          >
            <Text style={[styles.validationTitle, { color: latestValidationTone.textColor }]}>
              {lastValidation.validation_label || lastValidation.validation_status || 'Validation result'}
            </Text>
            <Text style={[styles.validationMessage, { color: latestValidationTone.textColor }]}>
              {lastValidation.validation_message || 'The retail engine returned a validation result.'}
            </Text>
          </View>
        </View>
      ) : null}

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
        <View style={styles.listHeader}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Recent EPC validations</Text>
          <Text style={[styles.listHint, { color: theme.textMuted }]}>
            {loading ? 'Loading...' : `${latestScans.length} recent items`}
          </Text>
        </View>

        {latestScans.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.textMuted }]}>
            No EPCs validated yet. Start a session and scan tags to populate the retail queue.
          </Text>
        ) : (
          latestScans.map((scan) => {
            const tone = toneByStatus(scan.validation_status);
            return (
              <View
                key={scan.epc}
                style={[styles.scanRow, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
              >
                <View style={styles.scanInfo}>
                  <Text style={[styles.scanEpc, { color: theme.text }]} numberOfLines={1}>
                    {scan.epc}
                  </Text>
                  <Text style={[styles.scanMeta, { color: theme.textMuted }]}>
                    {scan.product_name || scan.sku || 'Unmapped item'} • {scan.read_count || 1} read
                    {Number(scan.read_count || 0) === 1 ? '' : 's'}
                  </Text>
                  <Text style={[styles.scanMeta, { color: theme.textMuted }]}>
                    Last seen {formatTime(scan.last_seen || scan.first_seen)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.validationPill,
                    {
                      backgroundColor: tone.backgroundColor,
                      borderColor: tone.borderColor,
                    },
                  ]}
                >
                  <Text style={[styles.validationPillText, { color: tone.textColor }]}>
                    {scan.validation_label || scan.validation_status || 'Review'}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 28,
  },
  contentCompact: {
    paddingHorizontal: 14,
    paddingBottom: 22,
  },
  heroCard: {
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    marginBottom: 16,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  heroTopRowCompact: {
    flexWrap: 'wrap',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
  },
  heroTitleCompact: {
    fontSize: 21,
    lineHeight: 27,
  },
  heroHelper: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusPillCompact: {
    alignSelf: 'flex-start',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  scopeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  scopeRowCompact: {
    flexWrap: 'wrap',
  },
  scopeBox: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  scopeLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  scopeValue: {
    fontSize: 14,
    fontWeight: '700',
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
  cardTitle: {
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 8,
  },
  cardSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontWeight: '600',
  },
  primaryButton: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButton: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 104,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  cancelButton: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  actionHeader: {
    marginBottom: 16,
  },
  readerDebugPanel: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  readerDebugLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  readerDebugValue: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  readerDebugMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  actionRowCompact: {
    flexWrap: 'wrap',
  },
  actionButtonCompact: {
    width: '100%',
    minWidth: 0,
    flexBasis: '100%',
  },
  manualEntryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  manualEntryRowCompact: {
    flexDirection: 'column',
  },
  manualInput: {
    flex: 1,
  },
  manualInputCompact: {
    width: '100%',
  },
  submitButton: {
    minWidth: 112,
  },
  submitButtonCompact: {
    width: '100%',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  summaryTile: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 16,
    marginBottom: 14,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 6,
  },
  summaryHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  validationBanner: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  validationTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  validationMessage: {
    fontSize: 13,
    lineHeight: 19,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  listHint: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 21,
  },
  scanRow: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  scanInfo: {
    flex: 1,
  },
  scanEpc: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  scanMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  validationPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: 120,
  },
  validationPillText: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
});
