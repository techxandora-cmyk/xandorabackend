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
import {
  lookupRetailItemStatusByBarcode,
  lookupRetailItemStatusByEpc,
  RetailCatalogItem,
  RetailItemStatusResult,
} from '../services/retailService';

type LookupMode = 'epc' | 'barcode';

function formatTime(value?: string | null): string {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No timestamp';
  return date.toLocaleString();
}

function formatMoney(value?: number | null): string {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 'LKR 0.00';
  try {
    return new Intl.NumberFormat('en-LK', {
      style: 'currency',
      currency: 'LKR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `LKR ${amount.toFixed(2)}`;
  }
}

function modeCopy(mode: LookupMode) {
  if (mode === 'epc') {
    return {
      title: 'RFID item lookup',
      helper: 'Scan or enter one RFID to see where the item belongs and whether it is known.',
      button: 'Check RFID',
      placeholder: 'Enter RFID / EPC',
      scanLabel: 'Scan RFID',
    };
  }

  return {
    title: 'Barcode group lookup',
    helper: 'Scan or enter one barcode to see the matching item group in the current store.',
    button: 'Check Barcode',
    placeholder: 'Enter barcode',
    scanLabel: 'Scan Barcode',
  };
}

function statusTone(theme: any, result: RetailItemStatusResult | null) {
  if (!result) {
    return {
      backgroundColor: theme.surfaceAlt,
      borderColor: theme.border,
      textColor: theme.textMuted,
    };
  }

  if (result.kind === 'epc' && result.found) {
    if (result.matched_store_id === result.current_store_id) {
      return {
        backgroundColor: '#DCFCE7',
        borderColor: '#86EFAC',
        textColor: '#166534',
      };
    }

    return {
      backgroundColor: '#FEF3C7',
      borderColor: '#FCD34D',
      textColor: '#92400E',
    };
  }

  if (result.kind === 'barcode' && result.count > 0) {
    return {
      backgroundColor: '#DBEAFE',
      borderColor: '#93C5FD',
      textColor: '#1D4ED8',
    };
  }

  return {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
    textColor: '#991B1B',
  };
}

function ItemMetaRow({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: any;
}) {
  return (
    <View style={styles.metaRow}>
      <Text style={[styles.metaLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function ItemCard({
  item,
  theme,
  storeLabel,
}: {
  item: RetailCatalogItem;
  theme: any;
  storeLabel: string;
}) {
  return (
    <View
      style={[
        styles.itemCard,
        {
          backgroundColor: theme.surfaceAlt,
          borderColor: theme.border,
        },
      ]}
    >
      <Text style={[styles.itemTitle, { color: theme.text }]}>
        {item.product_name || item.sku || item.epc || 'Catalog item'}
      </Text>
      <ItemMetaRow label="Store" value={storeLabel} theme={theme} />
      <ItemMetaRow label="RFID" value={item.epc || 'Unknown'} theme={theme} />
      <ItemMetaRow label="Barcode" value={item.barcode || 'Unknown'} theme={theme} />
      <ItemMetaRow label="SKU" value={item.sku || 'Not mapped'} theme={theme} />
      <ItemMetaRow label="Brand" value={item.brand || 'Unbranded'} theme={theme} />
      <ItemMetaRow label="Category" value={item.category || 'Uncategorized'} theme={theme} />
      <ItemMetaRow label="Price" value={formatMoney(item.price_lkr)} theme={theme} />
      <ItemMetaRow label="Updated" value={formatTime(item.updated_at)} theme={theme} />
    </View>
  );
}

export default function ItemStatusScreen({ navigation }: any) {
  const { scannerConnected } = useScanner();
  const { theme } = useAppTheme();
  const inputRef = useRef<TextInput>(null);
  const [mode, setMode] = useState<LookupMode>('epc');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<RetailItemStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanMode, setScanMode] = useState<LookupMode | null>(null);

  const copy = modeCopy(mode);
  const tone = statusTone(theme, result);

  const resultItems = useMemo(() => {
    if (!result) return [];
    if (result.kind === 'epc') {
      return result.found ? [result.item] : [];
    }
    return result.items;
  }, [result]);

  const runLookup = async (inputValue: string, nextMode = mode) => {
    const trimmed = String(inputValue || '').trim().toUpperCase();
    if (!trimmed) {
      setError(nextMode === 'epc' ? 'Enter or scan an RFID first' : 'Enter or scan a barcode first');
      setResult(null);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const nextResult =
        nextMode === 'epc'
          ? await lookupRetailItemStatusByEpc(trimmed)
          : await lookupRetailItemStatusByBarcode(trimmed);

      setResult(nextResult);
      setQuery(trimmed);
      setScanMode(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not check item status');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const startScannerLookup = () => {
    if (!scannerConnected) {
      Alert.alert('Scanner offline', 'Connect the scanner first, then scan into Item Status.');
      return;
    }

    setScanMode(mode);
    setError('');
    inputRef.current?.focus();
  };

  const handleScannerSubmit = (value: string) => {
    const nextMode = scanMode || mode;
    runLookup(value, nextMode);
    inputRef.current?.clear();
  };

  const switchMode = (nextMode: LookupMode) => {
    setMode(nextMode);
    setQuery('');
    setResult(null);
    setError('');
    setScanMode(null);
  };

  const activeStoreLabel =
    result?.kind === 'epc'
      ? result.current_store_id
      : result?.kind === 'barcode'
      ? result.current_store_id
      : 'Current store';

  useScannerInput(
    payload => {
      if (!scanMode) {
        return;
      }

      handleScannerSubmit(payload);
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
        title="Item Status"
        onBack={() =>
          navigation.canGoBack() ? navigation.goBack() : navigation.replace('Home')
        }
      />

      <TextInput
        ref={inputRef}
        style={styles.hiddenInput}
        blurOnSubmit={false}
        showSoftInputOnFocus={false}
        onSubmitEditing={(event) => handleScannerSubmit(event.nativeEvent.text)}
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
        <Text style={[styles.eyebrow, { color: theme.textMuted }]}>Retail lookup</Text>
        <Text style={[styles.heroTitle, { color: theme.text }]}>Check one item fast</Text>
        <Text style={[styles.heroHelper, { color: theme.textMuted }]}>
          Use RFID for a single tagged item or barcode for a grouped item lookup in the store.
        </Text>

        <View style={styles.modeRow}>
          {([
            ['epc', 'RFID'],
            ['barcode', 'Barcode'],
          ] as Array<[LookupMode, string]>).map(([value, label]) => (
            <TouchableOpacity
              key={value}
              style={[
                styles.modePill,
                {
                  backgroundColor: mode === value ? theme.primary : theme.surfaceAlt,
                  borderColor: mode === value ? theme.primary : theme.border,
                },
              ]}
              onPress={() => switchMode(value)}
            >
              <Text
                style={[
                  styles.modePillText,
                  { color: mode === value ? '#FFFFFF' : theme.text },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

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
        <Text style={[styles.cardTitle, { color: theme.text }]}>{copy.title}</Text>
        <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>{copy.helper}</Text>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.scanButton, { backgroundColor: scannerConnected ? theme.secondary : theme.surfaceStrong }]}
            onPress={startScannerLookup}
            disabled={!scannerConnected}
          >
            <Text style={styles.scanButtonText}>
              {scanMode === mode ? 'Waiting for scan...' : copy.scanLabel}
            </Text>
          </TouchableOpacity>
        </View>

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
            placeholder={copy.placeholder}
            placeholderTextColor={theme.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => {
              runLookup(query);
            }}
          />
          <TouchableOpacity
            style={[styles.checkButton, { backgroundColor: loading ? theme.surfaceStrong : theme.primary }]}
            disabled={loading}
            onPress={() => {
              runLookup(query);
            }}
          >
            <Text style={styles.checkButtonText}>{loading ? 'Checking...' : copy.button}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {error ? (
        <View style={[styles.errorPanel, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {result ? (
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
          <Text style={[styles.cardTitle, { color: theme.text }]}>Status result</Text>
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor: tone.backgroundColor,
                borderColor: tone.borderColor,
              },
            ]}
          >
            <Text style={[styles.statusBannerTitle, { color: tone.textColor }]}>
              {result.status_label}
            </Text>
            <Text style={[styles.statusBannerText, { color: tone.textColor }]}>
              {result.status_detail}
            </Text>
          </View>
        </View>
      ) : null}

      {result?.kind === 'barcode' ? (
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
          <Text style={[styles.cardTitle, { color: theme.text }]}>Barcode matches</Text>
          <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>
            Showing up to {result.items.length} matching item{result.items.length === 1 ? '' : 's'} in{' '}
            {result.current_store_id}.
          </Text>

          {result.items.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              No matching items were found for this barcode.
            </Text>
          ) : (
            resultItems.map((item) => (
              <ItemCard
                key={`${item.store_id}-${item.epc}`}
                item={item}
                theme={theme}
                storeLabel={item.store_id || activeStoreLabel}
              />
            ))
          )}
        </View>
      ) : null}

      {result?.kind === 'epc' && result.found ? (
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
          <Text style={[styles.cardTitle, { color: theme.text }]}>Item details</Text>
          <ItemCard
            item={result.item}
            theme={theme}
            storeLabel={result.matched_store_id}
          />
        </View>
      ) : null}
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
    borderWidth: 1,
    borderRadius: 24,
    padding: 22,
    marginBottom: 16,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
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
    marginBottom: 8,
  },
  heroHelper: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modePill: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modePillText: {
    fontSize: 13,
    fontWeight: '800',
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
  actionRow: {
    marginBottom: 12,
  },
  scanButton: {
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
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
    minWidth: 118,
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
  statusBanner: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  statusBannerTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  statusBannerText: {
    fontSize: 13,
    lineHeight: 19,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 21,
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginTop: 10,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  metaRow: {
    marginBottom: 8,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
});
