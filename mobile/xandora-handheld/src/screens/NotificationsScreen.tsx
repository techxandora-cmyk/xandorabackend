import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { useAppTheme } from '../context/ThemeContext';
import { getStoreAlerts, MobileAlert } from '../services/alertsService';
import { getLaundryItems, LaundryItem } from '../services/laundryService';
import { getAuthSession, hasPermission } from '../services/session';

type WashWarningStage = 'OK' | 'WARNING_1' | 'WARNING_2' | 'WARNING_3' | 'EXCEEDED';

function severityLabel(value: number): string {
  const severity = Number(value || 0);
  if (severity >= 80) return 'Critical';
  if (severity >= 60) return 'High';
  if (severity >= 30) return 'Medium';
  return 'Low';
}

function formatTime(value?: string | null): string {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString();
}

function isValidationAlert(alert: MobileAlert): boolean {
  return [
    'UNKNOWN_EPC_DETECTED',
    'ITEM_ALREADY_BILLED',
    'DUPLICATE_SCAN_BEHAVIOR',
    'VALIDATION_SERVICE_UNAVAILABLE',
  ].includes(String(alert.type || '').toUpperCase());
}

function toneBySeverity(theme: any, severity: number) {
  if (severity >= 80) {
    return { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', textColor: '#991B1B' };
  }
  if (severity >= 60) {
    return { backgroundColor: '#FEF3C7', borderColor: '#FCD34D', textColor: '#92400E' };
  }
  if (severity >= 30) {
    return { backgroundColor: '#DBEAFE', borderColor: '#93C5FD', textColor: '#1D4ED8' };
  }

  return {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    textColor: theme.textMuted,
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

function washWarningLabel(stage: WashWarningStage): string {
  if (stage === 'WARNING_1') return 'Warning 1';
  if (stage === 'WARNING_2') return 'Warning 2';
  if (stage === 'WARNING_3') return 'Warning 3';
  if (stage === 'EXCEEDED') return 'Exceeded';
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

function washWarningRank(stage: WashWarningStage): number {
  if (stage === 'EXCEEDED') return 4;
  if (stage === 'WARNING_3') return 3;
  if (stage === 'WARNING_2') return 2;
  if (stage === 'WARNING_1') return 1;
  return 0;
}

export default function NotificationsScreen({ navigation }: any) {
  const { theme } = useAppTheme();
  const [productKey, setProductKey] = useState('');
  const [alerts, setAlerts] = useState<MobileAlert[]>([]);
  const [laundryAlerts, setLaundryAlerts] = useState<LaundryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'VALIDATION'>('ALL');
  const [accessReady, setAccessReady] = useState(false);

  const isLaundryModule = productKey === 'laundry';

  const loadAlerts = useCallback(
    async (showRefreshing = false, productOverride = '') => {
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      setError('');
      try {
        const activeProductKey = String(productOverride || productKey || '').trim().toLowerCase();

        if (activeProductKey === 'laundry') {
          const items = await getLaundryItems({ limit: 200 });
          const warningItems = items
            .filter(item => washWarningStage(item) !== 'OK')
            .sort((left, right) => {
              const rankGap =
                washWarningRank(washWarningStage(right)) - washWarningRank(washWarningStage(left));
              if (rankGap !== 0) return rankGap;
              return Number(right.wash_cycle_count || 0) - Number(left.wash_cycle_count || 0);
            });

          setLaundryAlerts(warningItems);
          setAlerts([]);
        } else {
          const rows = await getStoreAlerts(30);
          setAlerts(rows);
          setLaundryAlerts([]);
        }
      } catch (err: any) {
        setError(err?.message || 'Could not load alerts for this store');
        setAlerts([]);
        setLaundryAlerts([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [productKey],
  );

  useEffect(() => {
    let active = true;

    const checkAccessAndLoad = async () => {
      const session = await getAuthSession();
      const canViewAlerts =
        hasPermission(session?.user, 'alerts.receive') ||
        hasPermission(session?.user, 'dashboard.view_alerts');

      if (!active) return;

      setAccessReady(true);
      setProductKey(String(session?.user?.product_key || '').trim().toLowerCase());

      if (!canViewAlerts) {
        setLoading(false);
        setAlerts([]);
        setLaundryAlerts([]);
        setError('Alerts are not enabled for this handheld account.');
        Alert.alert(
          'Alerts permission required',
          'This handheld user is not allowed to receive alerts.',
        );
        navigation.replace('Home');
        return;
      }

      loadAlerts(false, String(session?.user?.product_key || '').trim().toLowerCase());
    };

    checkAccessAndLoad();

    return () => {
      active = false;
    };
  }, [loadAlerts, navigation]);

  const openCount = useMemo(
    () => alerts.filter((alert) => String(alert.status || '').toUpperCase() !== 'RESOLVED').length,
    [alerts],
  );
  const criticalCount = useMemo(
    () => alerts.filter((alert) => Number(alert.severity || 0) >= 80).length,
    [alerts],
  );
  const validationCount = useMemo(
    () => alerts.filter((alert) => isValidationAlert(alert)).length,
    [alerts],
  );
  const visibleAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      if (filter === 'CRITICAL') return Number(alert.severity || 0) >= 80;
      if (filter === 'VALIDATION') return isValidationAlert(alert);
      return true;
    });
  }, [alerts, filter]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            loadAlerts(true);
          }}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title={isLaundryModule ? 'Cycle Alerts' : 'Alerts'}
        onBack={() =>
          navigation.canGoBack() ? navigation.goBack() : navigation.replace('Home')
        }
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
        {isLaundryModule ? (
          <>
            <Text style={[styles.title, { color: theme.text }]}>Cycle Alerts</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              Only wash-cycle warnings appear here. Pull down to refresh the watchlist for the
              current laundry store.
            </Text>

            <View
              style={[
                styles.watchlistBar,
                { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
              ]}
            >
              <View
                style={[
                  styles.watchlistPill,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.watchlistPillText, { color: theme.text }]}>
                  {laundryAlerts.length} active
                </Text>
              </View>
              <Text style={[styles.policyHint, { color: theme.textMuted }]}>
                Warning 1 at 170, Warning 2 at 190, Warning 3 at 195, Exceeded at 200+
              </Text>
            </View>

            {loading ? (
              <View style={styles.stateRow}>
                <ActivityIndicator color={theme.accent} />
                <Text style={[styles.stateText, { color: theme.textMuted }]}>
                  Loading cycle alerts...
                </Text>
              </View>
            ) : null}

            {!loading && error ? (
              <View style={[styles.statePanel, { backgroundColor: theme.surfaceAlt }]}>
                <Text style={[styles.stateText, { color: theme.textMuted }]}>{error}</Text>
              </View>
            ) : null}

            {!loading && !error && laundryAlerts.length === 0 ? (
              <View style={[styles.statePanel, { backgroundColor: theme.surfaceAlt }]}>
                <Text style={[styles.stateText, { color: theme.textMuted }]}>
                  No cycle warnings are active for this store right now.
                </Text>
              </View>
            ) : null}

            {!loading && !error && laundryAlerts.length > 0 ? (
              <View style={styles.list}>
                <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
                  Active fabrics
                </Text>
                {laundryAlerts.map(item => {
                  const warningStage = washWarningStage(item);
                  const tone = washWarningTone(theme, warningStage);
                  return (
                    <View
                      key={`${item.id}-${item.epc}`}
                      style={[
                        styles.alertCard,
                        {
                          backgroundColor: theme.surfaceAlt,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <View style={styles.alertHeader}>
                        <Text style={[styles.alertType, { color: theme.text }]}>
                          {item.item_name || item.type_name || item.epc}
                        </Text>
                        <View
                          style={[
                            styles.severityPill,
                            {
                              backgroundColor: tone.backgroundColor,
                              borderColor: tone.borderColor,
                            },
                          ]}
                        >
                          <Text style={[styles.severityPillText, { color: tone.textColor }]}>
                            {washWarningLabel(warningStage)}
                          </Text>
                        </View>
                      </View>

                      <Text style={[styles.alertMeta, { color: theme.textMuted }]}>
                        Cycles: {Number(item.wash_cycle_count || 0)} / {Number(item.max_wash_cycles || 200)}
                      </Text>
                      <Text style={[styles.alertMeta, { color: theme.textMuted }]}>
                        Location: {item.current_location || 'No location'}
                      </Text>
                      <Text style={[styles.alertMeta, { color: theme.textMuted }]}>
                        RFID: {item.epc}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: theme.text }]}>Retail Alert Triage</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              Review validation exceptions, reader issues, and operational alerts for the current store.
            </Text>

            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: theme.surfaceAlt }]}>
                <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>Open</Text>
                <Text style={[styles.summaryValue, { color: theme.text }]}>{openCount}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: theme.surfaceAlt }]}>
                <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>Critical</Text>
                <Text style={[styles.summaryValue, { color: theme.text }]}>{criticalCount}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: theme.surfaceAlt }]}>
                <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>Validation</Text>
                <Text style={[styles.summaryValue, { color: theme.text }]}>{validationCount}</Text>
              </View>
            </View>

            <View style={styles.filterRow}>
              {[
                ['ALL', 'All alerts'],
                ['CRITICAL', 'Critical'],
                ['VALIDATION', 'Validation'],
              ].map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.filterPill,
                    {
                      backgroundColor: filter === value ? theme.primary : theme.surfaceAlt,
                      borderColor: filter === value ? theme.primary : theme.border,
                    },
                  ]}
                  onPress={() => setFilter(value as 'ALL' | 'CRITICAL' | 'VALIDATION')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      { color: filter === value ? '#FFFFFF' : theme.text },
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.refreshButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
              onPress={() => {
                loadAlerts(true);
              }}
              disabled={!accessReady}
            >
              <Text style={[styles.refreshButtonText, { color: theme.text }]}>Refresh Alerts</Text>
            </TouchableOpacity>

            {loading ? (
              <View style={styles.stateRow}>
                <ActivityIndicator color={theme.accent} />
                <Text style={[styles.stateText, { color: theme.textMuted }]}>
                  Loading alerts...
                </Text>
              </View>
            ) : null}

            {!loading && error ? (
              <View style={[styles.statePanel, { backgroundColor: theme.surfaceAlt }]}>
                <Text style={[styles.stateText, { color: theme.textMuted }]}>{error}</Text>
              </View>
            ) : null}

            {!loading && !error && visibleAlerts.length === 0 ? (
              <View style={[styles.statePanel, { backgroundColor: theme.surfaceAlt }]}>
                <Text style={[styles.stateText, { color: theme.textMuted }]}>
                  No alerts match this filter right now.
                </Text>
              </View>
            ) : null}

            {!loading && !error && visibleAlerts.length > 0 ? (
              <View style={styles.list}>
                {visibleAlerts.map((alert) => {
                  const tone = toneBySeverity(theme, Number(alert.severity || 0));
                  return (
                    <View
                      key={alert.id}
                      style={[
                        styles.alertCard,
                        {
                          backgroundColor: theme.surfaceAlt,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <View style={styles.alertHeader}>
                        <Text style={[styles.alertType, { color: theme.text }]}>
                          {alert.type || 'ALERT'}
                        </Text>
                        <View
                          style={[
                            styles.severityPill,
                            {
                              backgroundColor: tone.backgroundColor,
                              borderColor: tone.borderColor,
                            },
                          ]}
                        >
                          <Text style={[styles.severityPillText, { color: tone.textColor }]}>
                            {severityLabel(alert.severity)}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.alertMeta, { color: theme.textMuted }]}>
                        {alert.entity_type || 'EVENT'}
                        {alert.entity_id ? ` • ${alert.entity_id}` : ''}
                      </Text>
                      <Text style={[styles.alertMeta, { color: theme.textMuted }]}>
                        Status: {String(alert.status || 'OPEN').toUpperCase()}
                      </Text>
                      <Text style={[styles.alertMeta, { color: theme.textMuted }]}>
                        {formatTime(alert.last_detected_at)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 28,
  },
  card: {
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  watchlistBar: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  watchlistPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  watchlistPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  policyHint: {
    fontSize: 13,
    lineHeight: 19,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  filterPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  refreshButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statePanel: {
    borderRadius: 18,
    padding: 16,
  },
  stateText: {
    fontSize: 14,
    lineHeight: 20,
  },
  list: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  alertCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 10,
  },
  alertType: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  severityPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  severityPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  alertMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
});
