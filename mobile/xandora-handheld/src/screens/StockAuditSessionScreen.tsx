import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { useAppTheme } from '../context/ThemeContext';
import {
  getStockAuditActiveSession,
  getStockAuditHistory,
  getStockAuditKpis,
  getStockAuditProgress,
  startStockAuditSession,
  endStockAuditSession,
  StockAuditKpis,
  StockAuditProgress,
  StockAuditSession,
} from '../services/stockAuditService';

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

function when(value?: string | null): string {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not available' : parsed.toLocaleString();
}

function SummaryCard({
  label,
  value,
  detail,
  theme,
}: {
  label: string;
  value: string;
  detail: string;
  theme: any;
}) {
  return (
    <View
      style={[
        styles.summaryCard,
        { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
      ]}
    >
      <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.summaryDetail, { color: theme.textMuted }]}>{detail}</Text>
    </View>
  );
}

export default function StockAuditSessionScreen({ navigation }: any) {
  const { theme } = useAppTheme();
  const [expectedCountInput, setExpectedCountInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<'start' | 'end' | ''>('');
  const [activeSession, setActiveSession] = useState<StockAuditSession | null>(null);
  const [progress, setProgress] = useState<StockAuditProgress | null>(null);
  const [kpis, setKpis] = useState<StockAuditKpis | null>(null);
  const [history, setHistory] = useState<StockAuditSession[]>([]);
  const [error, setError] = useState('');

  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);

    setError('');
    try {
      const [nextActive, nextProgress, nextKpis, nextHistory] = await Promise.all([
        getStockAuditActiveSession(),
        getStockAuditProgress(),
        getStockAuditKpis(),
        getStockAuditHistory(),
      ]);

      setActiveSession(nextActive);
      setProgress(nextProgress);
      setKpis(nextKpis);
      setHistory(nextHistory);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not load stock-audit sessions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const unsubscribe = navigation.addListener('focus', () => {
      loadData(true);
    });
    return unsubscribe;
  }, [loadData, navigation]);

  useEffect(() => {
    if (!progress?.active) {
      return undefined;
    }

    const timer = setInterval(() => {
      loadData(true);
    }, 4000);

    return () => {
      clearInterval(timer);
    };
  }, [loadData, progress?.active]);

  const handleStart = async () => {
    setActionLoading('start');
    setError('');
    try {
      await startStockAuditSession({
        expectedCount: Number(expectedCountInput || 0),
      });
      await loadData(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not start a stock-audit session.');
    } finally {
      setActionLoading('');
    }
  };

  const handleEnd = async () => {
    setActionLoading('end');
    setError('');
    try {
      await endStockAuditSession();
      await loadData(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not end the active stock-audit session.');
    } finally {
      setActionLoading('');
    }
  };

  const foundCount = Number(progress?.found || activeSession?.total_found || 0);
  const expectedCount = Number(progress?.expected || activeSession?.total_expected || 0);
  const missingCount = Number(progress?.missing || activeSession?.total_missing || 0);
  const accuracy = Number(progress?.accuracy || activeSession?.accuracy_percent || 0);
  const sessionDuration = Number(progress?.duration_seconds || activeSession?.duration_seconds || 0);
  const readRate = Number(progress?.read_rate || activeSession?.read_rate || 0);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Start Count"
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
        <View style={styles.heroTopRow}>
          <View
            style={[
              styles.heroPill,
              { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.heroPillText, { color: theme.textMuted }]}>Stock audit</Text>
          </View>
          <View
            style={[
              styles.heroPill,
              {
                backgroundColor: progress?.active ? `${theme.success}12` : theme.surfaceAlt,
                borderColor: progress?.active ? `${theme.success}45` : theme.border,
              },
            ]}
          >
            <Text
              style={[
                styles.heroPillText,
                { color: progress?.active ? theme.success : theme.textMuted },
              ]}
            >
              {progress?.active ? 'Live session' : 'Ready'}
            </Text>
          </View>
        </View>

        <Text style={[styles.heroTitle, { color: theme.text }]}>Set up the count</Text>
        <Text style={[styles.heroHelper, { color: theme.textMuted }]}>
          Enter the expected total if you know it, start the session, and finish it once the team completes the scan.
        </Text>

        <View style={styles.inputRow}>
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
            style={[
              styles.actionButton,
              {
                backgroundColor: progress?.active ? theme.surfaceStrong : theme.primary,
              },
            ]}
            onPress={handleStart}
            disabled={Boolean(progress?.active) || actionLoading === 'start'}
          >
            <Text style={styles.actionButtonText}>
              {actionLoading === 'start' ? 'Starting...' : 'Start Count'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.endButton,
            {
              backgroundColor: progress?.active ? theme.danger : theme.surfaceStrong,
            },
          ]}
          onPress={handleEnd}
          disabled={!progress?.active || actionLoading === 'end'}
        >
          <Text style={styles.endButtonText}>
            {actionLoading === 'end' ? 'Closing...' : 'Finish Count'}
          </Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View
          style={[
            styles.statePanel,
            { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
          ]}
        >
          <Text style={[styles.stateText, { color: '#991B1B' }]}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            Loading stock-audit sessions...
          </Text>
        </View>
      ) : null}

      <View style={styles.summaryGrid}>
        <SummaryCard
          label="Found"
          value={`${foundCount}`}
          detail="Distinct tags found in the current count."
          theme={theme}
        />
        <SummaryCard
          label="Missing"
          value={`${missingCount}`}
          detail="Expected units still not found."
          theme={theme}
        />
        <SummaryCard
          label="Accuracy"
          value={`${accuracy.toFixed(1)}%`}
          detail="Live count accuracy for the active session."
          theme={theme}
        />
        <SummaryCard
          label="Read Rate"
          value={`${readRate.toFixed(2)}/s`}
          detail={`Session time ${durationLabel(sessionDuration)}`}
          theme={theme}
        />
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
        <Text style={[styles.panelTitle, { color: theme.text }]}>Live session status</Text>
        <Text style={[styles.panelText, { color: theme.textMuted }]}>
          {activeSession?.session_id || 'No live session yet'}
        </Text>
        <Text style={[styles.panelMeta, { color: theme.textMuted }]}>
          Started {when(activeSession?.started_at)}
        </Text>
        <Text style={[styles.panelMeta, { color: theme.textMuted }]}>
          Expected {expectedCount} | Reads {Number(progress?.reads || activeSession?.total_reads || 0)}
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
        <Text style={[styles.panelTitle, { color: theme.text }]}>Recent counts</Text>
        <Text style={[styles.panelText, { color: theme.textMuted }]}>
          {Number(kpis?.sessions_total || 0)} total sessions | {Number(kpis?.unique_epcs_total || 0)} unique EPCs
        </Text>

        {history.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.textMuted }]}>
            No stock-audit sessions have been recorded for this store yet.
          </Text>
        ) : (
          history.slice(0, 6).map(session => (
            <View
              key={session.session_id || String(session.id)}
              style={[
                styles.historyCard,
                { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
              ]}
            >
              <View style={styles.historyHeader}>
                <Text style={[styles.historyTitle, { color: theme.text }]}>
                  {session.session_id || `Session ${session.id || ''}`}
                </Text>
                <Text style={[styles.historyStatus, { color: theme.primary }]}>
                  {String(session.status || 'UNKNOWN').replace(/_/g, ' ')}
                </Text>
              </View>
              <Text style={[styles.historyMeta, { color: theme.textMuted }]}>
                {Number(session.total_found || 0)} found | {Number(session.total_missing || 0)} missing | {Number(session.accuracy_percent || 0).toFixed(1)}% accuracy
              </Text>
              <Text style={[styles.historyMeta, { color: theme.textMuted }]}>
                {when(session.started_at)} | {durationLabel(Number(session.duration_seconds || 0))}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 28 },
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
  inputRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  expectedInput: {
    width: 118,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 13,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  actionButton: {
    minWidth: 132,
    borderRadius: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  endButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  endButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  statePanel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
  },
  stateText: {
    fontSize: 14,
    lineHeight: 20,
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
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  summaryCard: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
  },
  summaryDetail: {
    fontSize: 12,
    lineHeight: 18,
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
    marginBottom: 8,
  },
  panelText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  panelMeta: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  historyCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginTop: 10,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  historyTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  historyStatus: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  historyMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
});
