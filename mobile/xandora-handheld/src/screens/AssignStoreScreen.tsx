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
import { Picker } from '@react-native-picker/picker';
import ScreenHeader from '../components/ScreenHeader';
import { useScanner, useScannerInput } from '../context/ScannerContext';
import { useAppTheme } from '../context/ThemeContext';
import { getCurrentStoreId } from '../services/session';
import { assignToStore, getStores } from '../services/storeService';

type StoreOption = {
  id: string;
  name: string;
};

export default function AssignStoreScreen({ navigation }: any) {
  const { scannerConnected } = useScanner();
  const { theme } = useAppTheme();
  const [scanning, setScanning] = useState(false);
  const [rfidList, setRfidList] = useState<string[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [sourceStoreId, setSourceStoreId] = useState('');
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [assignmentCompleted, setAssignmentCompleted] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const loadStoreOptions = async () => {
      try {
        const [availableStores, currentStore] = await Promise.all([
          getStores(),
          getCurrentStoreId(),
        ]);

        setStores(availableStores);
        setSourceStoreId(currentStore || '');
      } catch (error: any) {
        Alert.alert(
          'Store scope unavailable',
          error?.message || 'Could not load handheld store access',
        );
      }
    };

    loadStoreOptions();
  }, []);

  const destinationStores = useMemo(
    () => stores.filter((store) => store.id !== sourceStoreId),
    [sourceStoreId, stores],
  );

  const handleScan = (value: string) => {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed || !scanning) {
      return;
    }

    if (rfidList.includes(trimmed)) {
      Alert.alert('Duplicate RFID', 'This product was already scanned.');
      return;
    }

    setRfidList((prev) => [...prev, trimmed]);
  };

  const startScanning = () => {
    if (!scannerConnected) {
      Alert.alert('Please connect scanner first');
      return;
    }

    if (!destinationStores.length) {
      Alert.alert(
        'No destination stores',
        'This handheld account only has one accessible store, so there is nowhere to transfer stock to yet.',
      );
      return;
    }

    setScanning(true);
    inputRef.current?.focus();
  };

  const assignProductsToStore = async () => {
    if (rfidList.length === 0) {
      Alert.alert('Scan products first');
      return;
    }

    if (!selectedStore) {
      Alert.alert('Select a destination store first');
      return;
    }

    setTransferring(true);
    try {
      const result = await assignToStore({
        rfids: rfidList,
        storeId: selectedStore,
      });

      Alert.alert(
        'Store Assignment Complete',
        `${Number(result?.moved_count || rfidList.length)} products moved to ${selectedStore}.`,
      );

      setScanning(false);
      setAssignmentCompleted(true);
    } catch (error: any) {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'Could not transfer products to the destination store.';
      Alert.alert('Store Assignment Failed', message);
    } finally {
      setTransferring(false);
    }
  };

  const resetAssignment = () => {
    setScanning(false);
    setRfidList([]);
    setSelectedStore(null);
    setAssignmentCompleted(false);
  };

  useScannerInput(handleScan, scannerConnected);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Assign Store"
        onBack={() =>
          navigation.canGoBack() ? navigation.goBack() : navigation.replace('Home')
        }
      />

      <TextInput
        ref={inputRef}
        style={styles.hiddenInput}
        blurOnSubmit={false}
        showSoftInputOnFocus={false}
        onSubmitEditing={(event) => {
          handleScan(event.nativeEvent.text);
          inputRef.current?.clear();
        }}
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
        <Text style={[styles.helperText, { color: theme.textMuted }]}>
          Scan the RFID products first, then choose the destination store from the stores assigned
          to this operator and move the scanned stock there.
        </Text>

        <View style={[styles.scopePanel, { backgroundColor: theme.surfaceAlt }]}>
          <Text style={[styles.scopeLabel, { color: theme.textMuted }]}>Source store</Text>
          <Text style={[styles.scopeValue, { color: theme.text }]}>
            {sourceStoreId || 'No source store'}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            {
              backgroundColor:
                !scannerConnected || assignmentCompleted || !destinationStores.length
                  ? theme.surfaceStrong
                  : theme.primary,
            },
          ]}
          disabled={!scannerConnected || assignmentCompleted || !destinationStores.length}
          onPress={startScanning}
        >
          <Text style={styles.primaryButtonText}>
            {scanning ? 'Scanning RFID Products' : 'Scan Products (RFID)'}
          </Text>
        </TouchableOpacity>

        <View style={[styles.statPanel, { backgroundColor: theme.surfaceAlt }]}>
          <Text style={[styles.statLabel, { color: theme.textMuted }]}>
            Scanned products
          </Text>
          <Text style={[styles.statValue, { color: theme.text }]}>
            {rfidList.length}
          </Text>
        </View>

        {destinationStores.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Choose Destination Store
            </Text>
            <View
              style={[
                styles.dropdownWrapper,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <Picker
                selectedValue={selectedStore}
                onValueChange={(itemValue) => setSelectedStore(itemValue)}
                style={styles.picker}
              >
                <Picker.Item label="-- Select Store --" value={null} />
                {destinationStores.map((store) => (
                  <Picker.Item
                    key={store.id}
                    label={store.name}
                    value={store.id}
                  />
                ))}
              </Picker>
            </View>
          </>
        ) : (
          <Text style={[styles.helperNote, { color: theme.textMuted }]}>
            No destination stores are available for this handheld account yet.
          </Text>
        )}

        <TouchableOpacity
          style={[
            styles.assignButton,
            {
              backgroundColor:
                !scannerConnected ||
                rfidList.length === 0 ||
                !selectedStore ||
                assignmentCompleted ||
                transferring
                  ? theme.surfaceStrong
                  : theme.secondary,
            },
          ]}
          disabled={
            !scannerConnected ||
            rfidList.length === 0 ||
            !selectedStore ||
            assignmentCompleted ||
            transferring
          }
          onPress={assignProductsToStore}
        >
          <Text style={styles.assignButtonText}>
            {transferring ? 'Moving Products...' : 'Assign Products To Store'}
          </Text>
        </TouchableOpacity>

        {assignmentCompleted ? (
          <TouchableOpacity
            style={[styles.resetButton, { backgroundColor: theme.primary }]}
            onPress={resetAssignment}
          >
            <Text style={styles.resetButtonText}>Start New Store Assignment</Text>
          </TouchableOpacity>
        ) : null}
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
  hiddenInput: {
    height: 0,
    width: 0,
  },
  card: {
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  scopePanel: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  scopeLabel: {
    fontSize: 13,
    marginBottom: 6,
  },
  scopeValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  primaryButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  statPanel: {
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
    marginBottom: 18,
  },
  statLabel: {
    fontSize: 14,
    marginBottom: 6,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  helperNote: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  dropdownWrapper: {
    borderRadius: 16,
    marginBottom: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  assignButton: {
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 14,
  },
  assignButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  resetButton: {
    paddingVertical: 16,
    borderRadius: 16,
  },
  resetButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
});
