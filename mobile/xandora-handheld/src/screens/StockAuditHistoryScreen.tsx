import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { useAppTheme } from '../context/ThemeContext';
import {
  getStockAuditHistory,
  getStockAuditItems,
  getStockAuditKpis,
  StockAuditItem,
  StockAuditKpis,
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

export default function StockAuditHistoryScreen({ navigation }: any) {
  const { theme } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<StockAuditSession[]>([]);
  const [kpis, setKpis] = useState<StockAuditKpis | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<number | null>(null);
  const [sessionItems, setSessionItems] = useState<Record<number, StockAuditItem[]>>({});
  const [error, setError] = useState('');

  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);

    setError('');
    try {
      const [nextHistory, nextKpis] = await Promise.all([
        getStockAuditHistory(),
        getStockAuditKpis(),
      ]);
      setHistory(nextHistory);
      setKpis(nextKpis);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not load stock-audit history.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const unsubscribe = navigation.addListener('focus', () => loadData(true));
    return unsubscribe;
  }, [loadData, navigation]);

  const handleToggleSession = async (session: StockAuditSession) => {
    const sessionId = Number(session.id || 0);
    if (!sessionId) {
      return;
    }

    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      return;
    }

    setExpandedSessionId(sessionId);
    if (sessionItems[sessionId]) {
      return;
    }

    setLoadingSessionId(sessionId);
    try {
      const result = await getStockAuditItems({
        sessionId,
        limit: 500,
      });
      setSessionItems(current => ({
        ...current,
        [sessionId]: result.items,
      }));
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not load scan details for this count.');
    } finally {
      setLoadingSessionId(null);
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Past Counts"
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
        <Text style={[styles.heroTitle, { color: theme.text }]}>Review previous counts</Text>
        <Text style={[styles.heroHelper, { color: theme.textMuted }]}>
          Check completed counts, duration, accuracy, and operator trace for the current store.
        </Text>

        <View style={styles.metricGrid}>
          {[
            ['Sessions', `${Number(kpis?.sessions_total || 0)}`],
            ['Active', `${Number(kpis?.sessions_active || 0)}`],
            ['Avg Accuracy', `${Number(kpis?.avg_accuracy_percent || 0).toFixed(1)}%`],
            ['Unique EPCs', `${Number(kpis?.unique_epcs_total || 0)}`],
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
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            Loading session history...
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
        <Text style={[styles.panelTitle, { color: theme.text }]}>Completed counts</Text>
        <Text style={[styles.panelText, { color: theme.textMuted }]}>
          Pull down to refresh and keep the audit history current.
        </Text>

        {history.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.textMuted }]}>
            No stock-audit sessions are recorded for this store yet.
          </Text>
        ) : (
          history.map(session => {
            const sessionId = Number(session.id || 0);
            const isExpanded = sessionId > 0 && expandedSessionId === sessionId;
            const isLoadingItems = loadingSessionId === sessionId;
            const items = sessionItems[sessionId] || [];
            const unknownCount = items.filter(item => !item.product_name && !item.sku).length;

            return (
            <TouchableOpacity
              key={session.session_id || String(session.id)}
              style={[
                styles.historyCard,
                { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
              ]}
              activeOpacity={0.9}
              onPress={() => {
                handleToggleSession(session);
              }}
            >
              <View style={styles.historyHeader}>
                <Text style={[styles.historyTitle, { color: theme.text }]}>
                  {session.session_id || `Session ${session.id || ''}`}
                </Text>
                <View style={styles.historyHeaderRight}>
                  <Text style={[styles.historyStatus, { color: theme.primary }]}>
                    {String(session.status || 'UNKNOWN').replace(/_/g, ' ')}
                  </Text>
                  <Text style={[styles.historyChevron, { color: theme.textMuted }]}>
                    {isExpanded ? 'Hide' : 'Open'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.historyMeta, { color: theme.textMuted }]}>
                Found {Number(session.total_found || 0)} | Missing {Number(session.total_missing || 0)} | Accuracy {Number(session.accuracy_percent || 0).toFixed(1)}%
              </Text>
              <Text style={[styles.historyMeta, { color: theme.textMuted }]}>
                Duration {durationLabel(Number(session.duration_seconds || 0))} | Started {when(session.started_at)}
              </Text>
              <Text style={[styles.historyMeta, { color: theme.textMuted }]}>
                Ended {when(session.ended_at)} | Operator {session.operator_label || session.created_by_email || 'Unknown'}
              </Text>
              {isExpanded ? (
                <View
                  style={[
                    styles.sessionDetailPanel,
                    {
                      backgroundColor: theme.surface,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[styles.sessionDetailTitle, { color: theme.text }]}>
                    Scan details
                  </Text>
                  <Text style={[styles.sessionDetailMeta, { color: theme.textMuted }]}>
                    {items.length} scanned items loaded | {unknownCount} unknown
                  </Text>

                  {isLoadingItems ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator color={theme.primary} />
                      <Text style={[styles.loadingText, { color: theme.textMuted }]}>
                        Loading scanned items...
                      </Text>
                    </View>
                  ) : items.length === 0 ? (
                    <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                      No scanned items are available for this count yet.
                    </Text>
                  ) : (
                    items.map(item => (
                      <View
                        key={`${sessionId}:${item.epc}`}
                        style={[
                          styles.scanItemCard,
                          {
                            backgroundColor: theme.surfaceAlt,
                            borderColor: theme.border,
                          },
                        ]}
                      >
                        <View style={styles.scanItemHeader}>
                          <View style={styles.scanItemCopy}>
                            <Text style={[styles.scanItemTitle, { color: theme.text }]}>
                              {item.product_name || item.sku || 'Unknown item'}
                            </Text>
                            <Text style={[styles.scanItemMeta, { color: theme.textMuted }]}>
                              EPC {item.epc}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.scanReadBadge,
                              { backgroundColor: `${theme.primary}14` },
                            ]}
                          >
                            <Text style={[styles.scanReadBadgeText, { color: theme.primary }]}>
                              {item.read_count || 1}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.scanItemMeta, { color: theme.textMuted }]}>
                          SKU {item.sku || 'Unmatched'} | Brand {item.brand || 'Unbranded'}
                        </Text>
                        <Text style={[styles.scanItemMeta, { color: theme.textMuted }]}>
                          Category {item.category || 'Uncategorised'} | Size {item.size_label || 'Unspecified'}
                        </Text>
                        <Text style={[styles.scanItemMeta, { color: theme.textMuted }]}>
                          Last seen {when(item.last_seen)}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              ) : null}
            </TouchableOpacity>
          )})
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
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
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
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
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
    marginBottom: 8,
  },
  historyHeaderRight: {
    alignItems: 'flex-end',
    gap: 4,
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
  historyChevron: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  historyMeta: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  sessionDetailPanel: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginTop: 12,
  },
  sessionDetailTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  sessionDetailMeta: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  scanItemCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
  },
  scanItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  scanItemCopy: {
    flex: 1,
  },
  scanItemTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  scanItemMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  scanReadBadge: {
    minWidth: 36,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanReadBadgeText: {
    fontSize: 13,
    fontWeight: '800',
  },
});
