import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const { scannerConnected } = useScanner();
  const { theme } = useAppTheme();
  const hiddenInputRef = useRef<TextInput>(null);
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

  const hasActiveSession = String(session?.status || '').toUpperCase() === 'ACTIVE';

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

  const handleStartSession = async () => {
    setBusy(true);
    setError('');

    try {
      const nextSession = await startRetailBillingSession(Number(expectedCountInput || 0));
      setSession(nextSession);
      setLastValidation(null);
      await loadBillingState();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not start retail validation');
    } finally {
      setBusy(false);
    }
  };

  const submitEpc = async (rawValue: string) => {
    const epc = String(rawValue || '').trim().toUpperCase();
    if (!epc) {
      setError('Enter or scan an EPC first');
      return;
    }

    if (!hasActiveSession) {
      setError('Start a POS validation session before scanning EPCs');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const result = await scanRetailBillingEpc(epc);
      setLastValidation(result.validation);
      setSession(result.session);
      setManualEpc('');
      await loadBillingState();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not validate EPC');
    } finally {
      setBusy(false);
    }
  };

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

  const focusScanner = () => {
    if (!scannerConnected) {
      Alert.alert('Scanner offline', 'Connect the scanner first, then scan into the retail validation session.');
      return;
    }
    hiddenInputRef.current?.focus();
  };

  const latestValidationTone = toneByStatus(lastValidation?.validation_status);
  const latestScans = useMemo(() => scans.slice(0, 10), [scans]);
  const sessionStatusText = hasActiveSession ? 'Active session' : 'No active session';

  useScannerInput(
    payload => {
      submitEpc(payload).catch(() => undefined);
    },
    scannerConnected && hasActiveSession,
  );

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="POS Validate"
        onBack={() =>
          navigation.canGoBack() ? navigation.goBack() : navigation.replace('Home')
        }
      />

      <TextInput
        ref={hiddenInputRef}
        style={styles.hiddenInput}
        blurOnSubmit={false}
        showSoftInputOnFocus={false}
        onSubmitEditing={(event) => {
          submitEpc(event.nativeEvent.text);
          hiddenInputRef.current?.clear();
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
          <View>
            <Text style={[styles.eyebrow, { color: theme.textMuted }]}>Retail checkout control</Text>
            <Text style={[styles.heroTitle, { color: theme.text }]}>Validate EPCs before POS</Text>
          </View>
          <View
            style={[
              styles.statusPill,
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

        <View style={styles.scopeRow}>
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

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.ghostButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
              onPress={focusScanner}
            >
              <Text style={[styles.ghostButtonText, { color: theme.text }]}>Scan With Reader</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: busy ? theme.surfaceStrong : theme.success }]}
              disabled={busy}
              onPress={() => {
                handleComplete();
              }}
            >
              <Text style={styles.secondaryButtonText}>{busy ? 'Working...' : 'Complete'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cancelButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
              onPress={handleCancel}
            >
              <Text style={[styles.cancelButtonText, { color: theme.text }]}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.manualEntryRow}>
            <TextInput
              style={[
                styles.textInput,
                styles.manualInput,
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
                submitEpc(manualEpc);
              }}
            />
            <TouchableOpacity
              style={[styles.primaryButton, styles.submitButton, { backgroundColor: busy ? theme.surfaceStrong : theme.secondary }]}
              disabled={busy}
              onPress={() => {
                submitEpc(manualEpc);
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
                key={`${scan.epc}-${scan.last_seen || scan.first_seen || 'scan'}`}
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
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
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
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  scopeRow: {
    flexDirection: 'row',
    gap: 10,
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
  ghostButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  ghostButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  actionHeader: {
    marginBottom: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  manualEntryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  manualInput: {
    flex: 1,
  },
  submitButton: {
    minWidth: 112,
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
