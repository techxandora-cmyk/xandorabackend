import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { brand } from '../theme/brand';
import {
  getStockAuditInsights,
  getStockAuditItems,
  getStockAuditProgress,
  StockAuditInsights,
  StockAuditItem,
  StockAuditProgress,
  StockAuditRiskItem,
} from '../services/stockAuditService';

type FindingsTab = 'priority' | 'unknown' | 'dead_stock' | 'brands';

const TAB_OPTIONS: Array<{ key: FindingsTab; label: string }> = [
  { key: 'priority', label: 'Attention' },
  { key: 'unknown', label: 'Unknown' },
  { key: 'dead_stock', label: 'Slow Movers' },
  { key: 'brands', label: 'Brands' },
];

function riskLabel(item: StockAuditRiskItem): string {
  if (item.risk_out_of_stock) return 'Out of stock';
  if (item.risk_high_return_rate) return 'Return pressure';
  if (item.risk_low_stock) return 'Low stock';
  if (item.risk_never_scanned_7d) return 'No scan';
  return 'Review';
}

function riskTone(item: StockAuditRiskItem) {
  if (item.risk_out_of_stock) {
    return {
      backgroundColor: 'rgba(201,62,77,0.14)',
      borderColor: 'rgba(201,62,77,0.32)',
      textColor: '#D94F63',
    };
  }
  if (item.risk_low_stock) {
    return {
      backgroundColor: 'rgba(197,138,29,0.16)',
      borderColor: 'rgba(197,138,29,0.34)',
      textColor: '#E0AB3A',
    };
  }
  if (item.risk_high_return_rate) {
    return {
      backgroundColor: 'rgba(140,17,231,0.14)',
      borderColor: 'rgba(140,17,231,0.28)',
      textColor: '#B975FF',
    };
  }
  if (item.risk_never_scanned_7d) {
    return {
      backgroundColor: 'rgba(65,142,218,0.14)',
      borderColor: 'rgba(65,142,218,0.28)',
      textColor: '#70B2F0',
    };
  }
  return {
    backgroundColor: 'rgba(65,142,218,0.14)',
    borderColor: 'rgba(65,142,218,0.28)',
    textColor: brand.colors.blue,
  };
}

function when(value?: string | null): string {
  if (!value) return 'No scan time';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'No scan time' : parsed.toLocaleString();
}

export default function StockAuditFindingsScreen({ navigation }: any) {
  const { theme } = useAppTheme();
  const [tab, setTab] = useState<FindingsTab>('priority');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<StockAuditProgress | null>(null);
  const [insights, setInsights] = useState<StockAuditInsights | null>(null);
  const [items, setItems] = useState<StockAuditItem[]>([]);
  const [error, setError] = useState('');

  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);

    setError('');
    try {
      const [nextProgress, nextInsights, nextItems] = await Promise.all([
        getStockAuditProgress(),
        getStockAuditInsights({ limit: 6, riskLimit: 40 }),
        getStockAuditItems({ limit: 300 }),
      ]);
      setProgress(nextProgress);
      setInsights(nextInsights);
      setItems(nextItems.items);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not load stock-audit findings.');
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

  const unknownItems = useMemo(
    () => items.filter(item => !item.product_name && !item.sku),
    [items],
  );

  const riskItems = insights?.risk_items || [];
  const deadStock = insights?.dead_stock || [];
  const brandRisks = insights?.brand_risks || [];
  const summary = insights?.risks || {};

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Review Results"
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
        <Text style={[styles.heroTitle, { color: theme.text }]}>Check what needs attention</Text>
        <Text style={[styles.heroHelper, { color: theme.textMuted }]}>
          Review missing items, unknown EPCs, and grouped issues before you close the count.
        </Text>

        <View style={styles.metricGrid}>
          {[
            ['Missing', `${Number(progress?.missing || 0)}`],
            ['Unknown', `${unknownItems.length}`],
              ['Attention', `${Number(summary.at_risk_units || 0)}`],
              ['Accuracy', `${Number(progress?.accuracy || 0).toFixed(1)}%`],
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
            Loading findings...
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
        <View
          style={[
            styles.tabControl,
            { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}
        >
          {TAB_OPTIONS.map(option => {
            const selected = option.key === tab;
            return (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.tabChip,
                  {
                    backgroundColor: selected ? theme.primary : 'transparent',
                    borderColor: selected ? theme.primary : 'transparent',
                  },
                ]}
                onPress={() => setTab(option.key)}
              >
                <Text
                  style={[
                    styles.tabChipText,
                    { color: selected ? '#FFFFFF' : theme.textMuted },
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === 'priority'
          ? riskItems.length === 0
            ? (
                <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                No items need attention right now.
                </Text>
              )
            : riskItems.slice(0, 12).map(item => (
              (() => {
                const badgeTone = riskTone(item);
                return (
              <View
                key={item.group_key || `${item.sku}-${item.barcode}-${item.product_name}`}
                style={[
                  styles.findingCard,
                  { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
                ]}
              >
                <View style={styles.findingHeader}>
                  <View style={styles.findingCopy}>
                    <Text style={[styles.findingTitle, { color: theme.text }]}>
                      {item.product_name || item.sku || item.barcode || 'Unnamed item'}
                    </Text>
                    <Text style={[styles.findingMeta, { color: theme.textMuted }]}>
                      {[item.brand, item.category, item.size_label].filter(Boolean).join(' | ') || 'Audit finding'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.findingBadge,
                      {
                        backgroundColor: badgeTone.backgroundColor,
                        borderColor: badgeTone.borderColor,
                      },
                    ]}
                  >
                    <Text style={[styles.findingBadgeText, { color: badgeTone.textColor }]}>
                      {riskLabel(item)}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.findingInfo, { color: theme.textMuted }]}>
                  In stock {Number(item.in_stock_count || 0)} | Sold {Number(item.sold_count || 0)} | Last scan {when(item.last_scan_at)}
                </Text>
              </View>
                );
              })()
            ))
          : null}

        {tab === 'unknown'
          ? unknownItems.length === 0
            ? (
              <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                No unknown EPCs have been counted in the current session.
              </Text>
            )
            : unknownItems.map(item => (
              <View
                key={item.epc}
                style={[
                  styles.findingCard,
                  { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.findingTitle, { color: theme.text }]}>Unknown EPC</Text>
                <Text style={[styles.findingMeta, { color: theme.textMuted }]}>RFID {item.epc}</Text>
                <Text style={[styles.findingInfo, { color: theme.textMuted }]}>
                  Reads {Number(item.read_count || 0)} | This tag is not mapped in the catalog for the current store.
                </Text>
              </View>
            ))
          : null}

        {tab === 'dead_stock'
          ? deadStock.length === 0
            ? (
              <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                No dead-stock groups are showing in the current result set.
              </Text>
            )
            : deadStock.slice(0, 12).map(item => (
              <View
                key={item.group_key || `${item.sku}-${item.barcode}-${item.product_name}`}
                style={[
                  styles.findingCard,
                  { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.findingTitle, { color: theme.text }]}>
                  {item.product_name || item.sku || item.barcode || 'Dead stock group'}
                </Text>
                <Text style={[styles.findingMeta, { color: theme.textMuted }]}>
                  {[item.brand, item.category, item.size_label].filter(Boolean).join(' | ') || 'Dead stock'}
                </Text>
                <Text style={[styles.findingInfo, { color: theme.textMuted }]}>
                  In stock {Number(item.in_stock_count || 0)} | Sold {Number(item.sold_count || 0)} | Return rate {Number(item.return_rate_pct || 0).toFixed(1)}%
                </Text>
              </View>
            ))
          : null}

        {tab === 'brands'
          ? brandRisks.length === 0
            ? (
              <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                No grouped brand pressure is active right now.
              </Text>
            )
            : brandRisks.slice(0, 12).map(row => (
              <View
                key={row.brand || 'Unbranded'}
                style={[
                  styles.findingCard,
                  { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.findingTitle, { color: theme.text }]}>
                  {row.brand || 'Unbranded'}
                </Text>
                <View style={styles.brandRiskRow}>
                  <View
                    style={[
                      styles.findingBadge,
                      styles.inlineBadge,
                      {
                        backgroundColor: 'rgba(197,138,29,0.16)',
                        borderColor: 'rgba(197,138,29,0.34)',
                      },
                    ]}
                  >
                    <Text style={[styles.findingBadgeText, { color: '#E0AB3A' }]}>
                      Low stock {Number(row.low_stock_units || 0)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.findingBadge,
                      styles.inlineBadge,
                      {
                        backgroundColor: 'rgba(201,62,77,0.14)',
                        borderColor: 'rgba(201,62,77,0.3)',
                      },
                    ]}
                  >
                    <Text style={[styles.findingBadgeText, { color: '#D94F63' }]}>
                      Demand gap {Number(row.out_of_stock_demand_units || 0)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.findingBadge,
                      styles.inlineBadge,
                      {
                        backgroundColor: 'rgba(65,142,218,0.14)',
                        borderColor: 'rgba(65,142,218,0.3)',
                      },
                    ]}
                  >
                    <Text style={[styles.findingBadgeText, { color: '#70B2F0' }]}>
                      At risk {Number(row.at_risk_units || 0)}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.findingInfo, { color: theme.textMuted }]}>
                  No-scan age {Number(row.max_no_scan_days || 0)} days
                </Text>
              </View>
            ))
          : null}
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
  tabControl: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  tabChip: {
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  findingCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
  },
  findingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  findingCopy: {
    flex: 1,
  },
  findingTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  findingMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  findingInfo: {
    fontSize: 12,
    lineHeight: 18,
  },
  findingBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  findingBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  brandRiskRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  inlineBadge: {
    paddingVertical: 6,
  },
});
