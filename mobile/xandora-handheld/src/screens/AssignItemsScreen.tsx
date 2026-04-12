import React, { useRef, useState } from 'react';
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
import { submitAssignment, verifyBarcode } from '../services/assignService';

function formatCount(value: number): string {
  return `${Math.max(Number(value || 0), 0)}`;
}

export default function AssignItemsScreen({ navigation }: any) {
  const { scannerConnected } = useScanner();
  const { theme } = useAppTheme();
  const [barcodeVerified, setBarcodeVerified] = useState(false);
  const [barcodeValue, setBarcodeValue] = useState('');
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [requiredQuantity, setRequiredQuantity] = useState(0);
  const [rfidList, setRfidList] = useState<string[]>([]);
  const [scanMode, setScanMode] = useState<'barcode' | 'rfid' | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignmentComplete, setAssignmentComplete] = useState(false);
  const [assignmentRef, setAssignmentRef] = useState('');

  const inputRef = useRef<TextInput>(null);

  const rfidCount = rfidList.length;
  const progressMet = requiredQuantity > 0 && rfidCount >= requiredQuantity;
  const canScanRfid =
    scannerConnected && barcodeVerified && requiredQuantity > 0 && !assignmentComplete;
  const canAssignExact =
    scannerConnected &&
    barcodeVerified &&
    requiredQuantity > 0 &&
    rfidCount === requiredQuantity &&
    !assignmentComplete;
  const canAssignPartial =
    scannerConnected &&
    barcodeVerified &&
    rfidCount > 0 &&
    rfidCount < requiredQuantity &&
    !assignmentComplete;

  const focusScanner = () => {
    inputRef.current?.focus();
  };

  const resetAssignment = () => {
    setBarcodeVerified(false);
    setBarcodeValue('');
    setTotalAvailable(0);
    setRequiredQuantity(0);
    setRfidList([]);
    setScanMode(null);
    setAssigning(false);
    setAssignmentComplete(false);
    setAssignmentRef('');
  };

  const beginBarcodeScan = () => {
    if (!scannerConnected) {
      Alert.alert('Connect Scanner First');
      return;
    }

    if (barcodeVerified || assignmentComplete || rfidCount > 0) {
      resetAssignment();
    }

    setScanMode('barcode');
    focusScanner();
  };

  const beginRfidScan = () => {
    if (!scannerConnected) {
      Alert.alert('Connect Scanner First');
      return;
    }

    if (!barcodeVerified) {
      Alert.alert('Verify the box barcode first');
      return;
    }

    if (requiredQuantity <= 0) {
      Alert.alert('Set the RFID quantity first');
      return;
    }

    setScanMode('rfid');
    focusScanner();
  };

  const handleScan = async (value: string) => {
    const trimmed = String(value || '').trim().toUpperCase();
    if (!trimmed) {
      return;
    }

    if (scanMode === 'barcode') {
      try {
        const response = await verifyBarcode(trimmed);
        if (Number(response.totalQuantity || 0) <= 0) {
          Alert.alert('Items Not Found', 'This barcode could not be verified.');
          return;
        }

        const totalQuantity = Number(response.totalQuantity || 0);
        setBarcodeValue(trimmed);
        setTotalAvailable(totalQuantity);
        setRequiredQuantity(totalQuantity);
        setBarcodeVerified(true);
        setRfidList([]);
        setScanMode(null);
        setAssignmentComplete(false);
        setAssignmentRef('');
      } catch (err: any) {
        Alert.alert(
          'Items Not Found',
          err?.response?.data?.error || err?.message || 'This barcode could not be verified.',
        );
      }
      return;
    }

    if (scanMode === 'rfid') {
      if (requiredQuantity <= 0) {
        Alert.alert('Set the RFID quantity first');
        return;
      }

      if (rfidList.includes(trimmed)) {
        Alert.alert('Duplicate RFID', 'This tag was already scanned.');
        return;
      }

      if (rfidList.length >= requiredQuantity) {
        Alert.alert('Requirement Met', 'The required RFID quantity is already scanned.');
        setScanMode(null);
        return;
      }

      const updatedRfids = [...rfidList, trimmed];
      setRfidList(updatedRfids);

      if (updatedRfids.length >= requiredQuantity) {
        setScanMode(null);
      }
    }
  };

  const setNextRequiredQuantity = (nextValue: number) => {
    if (!barcodeVerified || assignmentComplete) {
      return;
    }

    const bounded = Math.max(1, Math.min(totalAvailable || 1, Math.round(nextValue)));
    setRequiredQuantity(bounded);

    if (rfidList.length > bounded) {
      setRfidList(rfidList.slice(0, bounded));
    }
  };

  const submitItems = async (assignPartial: boolean) => {
    if (!barcodeVerified) {
      Alert.alert('Verify the box barcode first');
      return;
    }

    if (rfidCount === 0) {
      Alert.alert('Scan RFID items first');
      return;
    }

    const quantityToAssign = assignPartial ? rfidCount : requiredQuantity;
    if (!assignPartial && rfidCount !== requiredQuantity) {
      return;
    }

    setAssigning(true);

    try {
      const result = await submitAssignment({
        barcode: barcodeValue,
        quantity: quantityToAssign,
        rfids: rfidList.slice(0, quantityToAssign),
      });

      setAssignmentComplete(true);
      setAssignmentRef(String(result?.assignment_id || result?.ref || '').trim());
      setScanMode(null);
    } catch (err: any) {
      Alert.alert(
        'Assignment Failed',
        err?.response?.data?.error || err?.message || 'Could not submit assignment.',
      );
    } finally {
      setAssigning(false);
    }
  };

  const confirmAssignAnyway = () => {
    Alert.alert(
      'Assign scanned items?',
      `Required quantity is ${requiredQuantity}, but only ${rfidCount} RFID tag${
        rfidCount === 1 ? '' : 's'
      } are scanned. Assign the scanned items anyway?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Assign Anyway',
          onPress: () => {
            submitItems(true);
          },
        },
      ],
    );
  };

  const barcodeStatusTone = barcodeVerified
    ? {
        backgroundColor: '#DCFCE7',
        borderColor: '#86EFAC',
        textColor: '#166534',
      }
    : {
        backgroundColor: theme.surfaceAlt,
        borderColor: theme.border,
        textColor: theme.textMuted,
      };

  const progressTone = assignmentComplete
    ? {
        backgroundColor: '#DCFCE7',
        borderColor: '#86EFAC',
        textColor: '#166534',
        helper: 'Assignment complete',
      }
    : progressMet
    ? {
        backgroundColor: '#DCFCE7',
        borderColor: '#86EFAC',
        textColor: '#166534',
        helper: 'Requirement met',
      }
    : rfidCount > 0
    ? {
        backgroundColor: '#DBEAFE',
        borderColor: '#93C5FD',
        textColor: '#1D4ED8',
        helper: `${Math.max(requiredQuantity - rfidCount, 0)} remaining`,
      }
    : {
        backgroundColor: theme.surfaceAlt,
        borderColor: theme.border,
        textColor: theme.textMuted,
        helper: 'Waiting for RFID scans',
      };

  useScannerInput(
    payload => {
      handleScan(payload).catch(() => undefined);
    },
    scannerConnected,
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Assign Items"
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
          Scan box barcode. Set quantity. Scan RFID tags. Assign items.
        </Text>

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: theme.primary }]}
          onPress={beginBarcodeScan}
        >
          <Text style={styles.primaryButtonText}>
            {assignmentComplete
              ? 'Scan Another Barcode'
              : barcodeVerified
              ? 'Rescan Barcode'
              : 'Scan Box Barcode'}
          </Text>
        </TouchableOpacity>

        <View
          style={[
            styles.infoPanel,
            {
              backgroundColor: theme.surfaceAlt,
            },
          ]}
        >
          <View style={styles.infoHeader}>
            <Text style={[styles.infoLabel, { color: theme.textMuted }]}>Verified barcode</Text>
            <View
              style={[
                styles.statusChip,
                {
                  backgroundColor: barcodeStatusTone.backgroundColor,
                  borderColor: barcodeStatusTone.borderColor,
                },
              ]}
            >
              <Text style={[styles.statusChipText, { color: barcodeStatusTone.textColor }]}>
                {barcodeVerified ? '\u2713 Verified' : 'Waiting'}
              </Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Text
              style={[styles.infoValue, styles.infoValueLeft, { color: theme.text }]}
              numberOfLines={1}
            >
              {barcodeValue || 'Waiting for scan'}
            </Text>
            <View style={styles.availableBox}>
              <Text style={[styles.availableLabel, { color: theme.textMuted }]}>Available</Text>
              <Text style={[styles.availableValue, { color: theme.text }]}>{formatCount(totalAvailable)}</Text>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>RFID Quantity</Text>
        <View style={styles.quantityRow}>
          <TouchableOpacity
            style={[
              styles.quantityButton,
              {
                backgroundColor:
                  !barcodeVerified || assignmentComplete || requiredQuantity <= 1
                    ? theme.surfaceStrong
                    : theme.surfaceAlt,
                borderColor: theme.border,
              },
            ]}
            disabled={!barcodeVerified || assignmentComplete || requiredQuantity <= 1}
            onPress={() => setNextRequiredQuantity(requiredQuantity - 1)}
          >
            <Text style={[styles.quantityButtonText, { color: theme.text }]}>-</Text>
          </TouchableOpacity>

          <View
            style={[
              styles.quantityValueBox,
              {
                backgroundColor: theme.surfaceAlt,
                borderColor: theme.border,
              },
            ]}
          >
            <Text style={[styles.quantityValue, { color: theme.text }]}>
              {formatCount(requiredQuantity)}
            </Text>
            <Text style={[styles.quantityHelper, { color: theme.textMuted }]}>required</Text>
          </View>

          <TouchableOpacity
            style={[
              styles.quantityButton,
              {
                backgroundColor:
                  !barcodeVerified || assignmentComplete || requiredQuantity >= totalAvailable
                    ? theme.surfaceStrong
                    : theme.surfaceAlt,
                borderColor: theme.border,
              },
            ]}
            disabled={
              !barcodeVerified || assignmentComplete || requiredQuantity >= totalAvailable
            }
            onPress={() => setNextRequiredQuantity(requiredQuantity + 1)}
          >
            <Text style={[styles.quantityButtonText, { color: theme.text }]}>+</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.secondaryButton,
            {
              backgroundColor: canScanRfid ? theme.secondary : theme.surfaceStrong,
            },
          ]}
          onPress={beginRfidScan}
          disabled={!canScanRfid}
        >
          <Text style={styles.secondaryButtonText}>
            {scanMode === 'rfid' ? 'Scanning RFID...' : 'Scan RFID Items'}
          </Text>
        </TouchableOpacity>

        <View
          style={[
            styles.progressPanel,
            {
              backgroundColor: progressTone.backgroundColor,
              borderColor: progressTone.borderColor,
            },
          ]}
        >
          <Text style={[styles.progressTitle, { color: progressTone.textColor }]}>Scan Progress</Text>
          <Text style={[styles.progressValue, { color: progressTone.textColor }]}>
            {formatCount(rfidCount)} / {formatCount(requiredQuantity)}
          </Text>
          <Text style={[styles.progressHelper, { color: progressTone.textColor }]}>
            {progressTone.helper}
          </Text>
        </View>

        {assignmentComplete ? (
          <View style={styles.successWrap}>
            <View style={[styles.successPanel, { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' }]}>
              <Text style={styles.successTitle}>{'\u2713'} Assign Complete</Text>
              <Text style={styles.successText}>
                {rfidCount} item{rfidCount === 1 ? '' : 's'} assigned
                {assignmentRef ? ` - Ref: ${assignmentRef}` : ''}.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.actionStack}>
            <TouchableOpacity
              style={[
                styles.assignButton,
                {
                  backgroundColor: canAssignExact ? theme.success : theme.surfaceStrong,
                },
              ]}
              onPress={() => {
                submitItems(false);
              }}
              disabled={!canAssignExact || assigning}
            >
              <Text style={styles.assignButtonText}>
                {assigning ? 'Assigning...' : 'Assign Items'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.assignAnywayButton,
                {
                  backgroundColor: canAssignPartial ? theme.surfaceAlt : theme.surfaceStrong,
                  borderColor: theme.border,
                },
              ]}
              onPress={confirmAssignAnyway}
              disabled={!canAssignPartial || assigning}
            >
              <Text
                style={[
                  styles.assignAnywayText,
                  {
                    color: canAssignPartial ? theme.text : theme.textMuted,
                  },
                ]}
              >
                Assign Anyway
              </Text>
            </TouchableOpacity>
          </View>
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
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
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
    marginBottom: 16,
  },
  primaryButton: {
    paddingVertical: 15,
    borderRadius: 16,
    marginBottom: 14,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  infoPanel: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 12,
  },
  infoValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  infoValueLeft: {
    flex: 1,
  },
  availableBox: {
    alignItems: 'flex-end',
    minWidth: 64,
  },
  availableLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  availableValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  quantityButton: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  quantityButtonText: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 30,
  },
  quantityValueBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityValue: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 2,
  },
  quantityHelper: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  secondaryButton: {
    paddingVertical: 15,
    borderRadius: 16,
    marginBottom: 14,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  progressPanel: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  progressTitle: {
    fontSize: 14,
    marginBottom: 6,
    fontWeight: '700',
  },
  progressValue: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
  },
  progressHelper: {
    fontSize: 13,
    fontWeight: '700',
  },
  actionStack: {
    gap: 10,
  },
  assignButton: {
    paddingVertical: 15,
    borderRadius: 16,
  },
  assignButtonText: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  assignAnywayButton: {
    paddingVertical: 15,
    borderRadius: 16,
    borderWidth: 1,
  },
  assignAnywayText: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
  },
  successWrap: {
    marginTop: 2,
  },
  successPanel: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  successTitle: {
    color: '#166534',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  successText: {
    color: '#166534',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
});
