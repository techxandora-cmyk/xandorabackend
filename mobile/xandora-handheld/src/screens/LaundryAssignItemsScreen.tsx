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
import ScreenHeader from '../components/ScreenHeader';
import { useScanner, useScannerInput } from '../context/ScannerContext';
import { useAppTheme } from '../context/ThemeContext';
import {
  createLaundryItemType,
  getLaundryItemTypes,
  LaundryItemType,
  registerLaundryItems,
} from '../services/laundryService';
import { getAuthSession, hasPermission } from '../services/session';

function formatCount(value: number): string {
  return `${Math.max(Number(value || 0), 0)}`;
}

export default function LaundryAssignItemsScreen({ navigation }: any) {
  const { scannerConnected } = useScanner();
  const { theme } = useAppTheme();
  const inputRef = useRef<TextInput>(null);

  const [itemTypes, setItemTypes] = useState<LaundryItemType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number>(0);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [expectedCount, setExpectedCount] = useState(1);
  const [rfidList, setRfidList] = useState<string[]>([]);
  const [scanMode, setScanMode] = useState(false);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [assignmentComplete, setAssignmentComplete] = useState(false);
  const [assignmentSummary, setAssignmentSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [canCreateTypes, setCanCreateTypes] = useState(false);
  const [showCreateType, setShowCreateType] = useState(false);
  const [creatingType, setCreatingType] = useState(false);
  const [typeNameInput, setTypeNameInput] = useState('');
  const [fabricTypeInput, setFabricTypeInput] = useState('');
  const [sizeLabelInput, setSizeLabelInput] = useState('');

  const selectedType = useMemo(
    () => itemTypes.find(type => Number(type.id) === Number(selectedTypeId)) || null,
    [itemTypes, selectedTypeId],
  );

  const rfidCount = rfidList.length;
  const progressMet = expectedCount > 0 && rfidCount >= expectedCount;
  const canScan = scannerConnected && !!selectedType && !assignmentComplete;
  const canAssignExact = !!selectedType && rfidCount === expectedCount && expectedCount > 0;
  const canAssignPartial = !!selectedType && rfidCount > 0 && rfidCount < expectedCount;

  useEffect(() => {
    let active = true;

    const loadTypes = async () => {
      setLoadingTypes(true);
      try {
        const rows = await getLaundryItemTypes();
        const session = await getAuthSession();
        const canManageTypes =
          session?.user?.roles?.includes('ADMIN') ||
          session?.user?.roles?.includes('MASTER_ADMIN') ||
          hasPermission(session?.user, 'dashboard.manage_laundry');
        if (!active) return;
        setItemTypes(rows);
        setCanCreateTypes(Boolean(canManageTypes));
        if (rows.length) {
          setSelectedTypeId(Number(rows[0].id));
        }
      } catch (error: any) {
        if (!active) return;
        Alert.alert(
          'Fabric types unavailable',
          error?.response?.data?.error || error?.message || 'Could not load fabric types.',
        );
      } finally {
        if (active) {
          setLoadingTypes(false);
        }
      }
    };

    loadTypes();
    return () => {
      active = false;
    };
  }, []);

  const resetAssignmentState = () => {
    setExpectedCount(1);
    setRfidList([]);
    setScanMode(false);
    setAssigning(false);
    setAssignmentComplete(false);
    setAssignmentSummary('');
    setNotes('');
  };

  const reloadTypes = async (focusNewTypeId?: number) => {
    const rows = await getLaundryItemTypes();
    setItemTypes(rows);
    if (focusNewTypeId) {
      setSelectedTypeId(Number(focusNewTypeId));
    } else if (rows.length) {
      setSelectedTypeId(Number(rows[0].id));
    } else {
      setSelectedTypeId(0);
    }
  };

  const focusScanner = () => {
    inputRef.current?.focus();
  };

  const beginRfidScan = () => {
    if (!scannerConnected) {
      Alert.alert('Connect Scanner First');
      return;
    }

    if (!selectedType) {
      Alert.alert('Select a fabric type first');
      return;
    }

    if (expectedCount <= 0) {
      Alert.alert('Set the label quantity first');
      return;
    }

    setScanMode(true);
    focusScanner();
  };

  const handleScan = (value: string) => {
    const trimmed = String(value || '').trim().toUpperCase();
    if (!trimmed || !scanMode) {
      return;
    }

    if (!selectedType) {
      Alert.alert('Select a fabric type first');
      return;
    }

    if (rfidList.includes(trimmed)) {
      Alert.alert('Duplicate RFID', 'This RFID label was already scanned.');
      return;
    }

    if (rfidList.length >= expectedCount) {
      Alert.alert('Requirement Met', 'The required RFID quantity is already scanned.');
      setScanMode(false);
      return;
    }

    const nextList = [...rfidList, trimmed];
    setRfidList(nextList);

    if (nextList.length >= expectedCount) {
      setScanMode(false);
    }
  };

  useScannerInput(handleScan, scannerConnected);

  const setNextExpectedCount = (nextValue: number) => {
    if (assignmentComplete) {
      return;
    }

    const bounded = Math.max(1, Math.min(99, Math.round(nextValue)));
    setExpectedCount(bounded);

    if (rfidList.length > bounded) {
      setRfidList(prev => prev.slice(0, bounded));
    }
  };

  const submitLabels = async (registerPartial: boolean) => {
    if (!selectedType) {
      Alert.alert('Select a fabric type first');
      return;
    }

    if (!rfidCount) {
      Alert.alert('Scan RFID labels first');
      return;
    }

    const labelsToRegister = registerPartial ? rfidList : rfidList.slice(0, expectedCount);
    if (!registerPartial && rfidCount !== expectedCount) {
      return;
    }

    setAssigning(true);

    try {
      const result = await registerLaundryItems({
        itemTypeId: Number(selectedType.id),
        epcs: labelsToRegister,
        notes,
      });

      const processed = Number(result.processed || 0);
      const failedCount = Array.isArray(result.failed) ? result.failed.length : 0;

      if (processed <= 0 && failedCount > 0) {
        throw new Error(result.failed[0]?.error || 'No RFID labels were assigned');
      }

      setAssignmentComplete(true);
      setScanMode(false);
      setAssignmentSummary(
        failedCount
          ? `${processed} assigned, ${failedCount} need review`
          : `${processed} assigned successfully`,
      );

      if (failedCount > 0) {
        Alert.alert(
          'Assignment completed with review items',
          result.failed
            .slice(0, 3)
            .map(entry => `${entry.epc}: ${entry.error}`)
            .join('\n'),
        );
      }
    } catch (error: any) {
      Alert.alert(
        'Assignment failed',
        error?.response?.data?.error || error?.message || 'Could not assign RFID labels.',
      );
    } finally {
      setAssigning(false);
    }
  };

  const confirmAssignAnyway = () => {
    Alert.alert(
      'Assign scanned labels?',
      `Expected ${expectedCount} label${expectedCount === 1 ? '' : 's'}, but only ${rfidCount} scanned. Assign the scanned labels anyway?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Assign Anyway',
          onPress: () => {
            submitLabels(true);
          },
        },
      ],
    );
  };

  const handleCreateType = async () => {
    if (!typeNameInput.trim()) {
      Alert.alert('Fabric name required', 'Enter the fabric unit name first.');
      return;
    }

    setCreatingType(true);
    try {
      const created = await createLaundryItemType({
        name: typeNameInput,
        fabricType: fabricTypeInput,
        sizeLabel: sizeLabelInput,
        maxWashCycles: 200,
        warningCycleThreshold: 170,
      });
      await reloadTypes(Number(created.id));
      setShowCreateType(false);
      setTypeNameInput('');
      setFabricTypeInput('');
      setSizeLabelInput('');
      setAssignmentComplete(false);
      setAssignmentSummary('');
      Alert.alert('Fabric type created', `${created.name || 'Fabric type'} is ready to assign.`);
    } catch (error: any) {
      Alert.alert(
        'Create failed',
        error?.response?.data?.error || error?.message || 'Could not create the fabric type.',
      );
    } finally {
      setCreatingType(false);
    }
  };

  const typeTone = selectedType
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
        helper: assignmentSummary || 'Assignment complete',
      }
    : progressMet
    ? {
        backgroundColor: '#DCFCE7',
        borderColor: '#86EFAC',
        textColor: '#166534',
        helper: 'Required label count met',
      }
    : rfidCount > 0
    ? {
        backgroundColor: '#DBEAFE',
        borderColor: '#93C5FD',
        textColor: '#1D4ED8',
        helper: `${Math.max(expectedCount - rfidCount, 0)} remaining`,
      }
    : {
        backgroundColor: theme.surfaceAlt,
        borderColor: theme.border,
        textColor: theme.textMuted,
        helper: 'Waiting for RFID label scans',
      };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Assign Fabrics"
        onBack={() =>
          navigation.canGoBack() ? navigation.goBack() : navigation.replace('Home')
        }
      />

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
          Pick the fabric type. Set the unit count. Scan RFID labels. Assign the replacement stock.
        </Text>

        <View
          style={[
            styles.infoPanel,
            {
              backgroundColor: theme.surfaceAlt,
            },
          ]}
        >
          <View style={styles.infoHeader}>
            <Text style={[styles.infoLabel, { color: theme.textMuted }]}>Selected fabric type</Text>
            <View
              style={[
                styles.statusChip,
                {
                  backgroundColor: typeTone.backgroundColor,
                  borderColor: typeTone.borderColor,
                },
              ]}
            >
              <Text style={[styles.statusChipText, { color: typeTone.textColor }]}>
                {selectedType ? '\u2713 Ready' : loadingTypes ? 'Loading' : 'Select'}
              </Text>
            </View>
          </View>

          <View style={styles.typeSummaryRow}>
            <View style={styles.typeSummaryCopy}>
              <Text style={[styles.infoValue, styles.infoValueLeft, { color: theme.text }]} numberOfLines={1}>
                {selectedType?.name || (loadingTypes ? 'Loading fabric types...' : 'No fabric type selected')}
              </Text>
              <Text style={[styles.typeMeta, { color: theme.textMuted }]}>
                {selectedType
                  ? `${selectedType.code || 'TYPE'} • ${selectedType.fabric_type || selectedType.category || 'Fabric'}${selectedType.size_label ? ` • ${selectedType.size_label}` : ''}`
                  : 'Choose which fabric unit should be assigned to the new RFID labels.'}
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.changeTypeButton,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
              onPress={() => setTypeMenuOpen(open => !open)}
              disabled={loadingTypes || itemTypes.length === 0}
            >
              <Text style={[styles.changeTypeText, { color: theme.text }]}>
                {itemTypes.length ? (typeMenuOpen ? 'Hide' : 'Change') : 'No Types'}
              </Text>
            </TouchableOpacity>
          </View>

          {selectedType ? (
            <View style={styles.typeDetailGrid}>
              <View style={styles.typeDetailItem}>
                <Text style={[styles.typeDetailLabel, { color: theme.textMuted }]}>Warning</Text>
                <Text style={[styles.typeDetailValue, { color: theme.text }]}>
                  {selectedType.warning_cycle_threshold || 180}
                </Text>
              </View>
              <View style={styles.typeDetailItem}>
                <Text style={[styles.typeDetailLabel, { color: theme.textMuted }]}>Max cycles</Text>
                <Text style={[styles.typeDetailValue, { color: theme.text }]}>
                  {selectedType.max_wash_cycles || 200}
                </Text>
              </View>
            </View>
          ) : null}

          {typeMenuOpen ? (
            <View style={styles.typeList}>
              {itemTypes.map(type => {
                const selected = Number(type.id) === Number(selectedTypeId);
                return (
                  <TouchableOpacity
                    key={type.id}
                    style={[
                      styles.typeOption,
                      {
                        backgroundColor: selected ? `${theme.primary}12` : theme.surface,
                        borderColor: selected ? `${theme.primary}45` : theme.border,
                      },
                    ]}
                    onPress={() => {
                      setSelectedTypeId(Number(type.id));
                      setTypeMenuOpen(false);
                      setAssignmentComplete(false);
                      setAssignmentSummary('');
                    }}
                  >
                    <View style={styles.typeOptionCopy}>
                      <Text style={[styles.typeOptionTitle, { color: selected ? theme.primary : theme.text }]}>
                        {type.name || 'Fabric type'}
                      </Text>
                      <Text style={[styles.typeOptionMeta, { color: theme.textMuted }]}>
                        {type.code || 'TYPE'} • {type.fabric_type || type.category || 'Fabric'}
                        {type.size_label ? ` • ${type.size_label}` : ''}
                      </Text>
                    </View>
                    {selected ? (
                      <Text style={[styles.typeOptionBadge, { color: theme.primary }]}>Active</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {!loadingTypes && !itemTypes.length ? (
            <View
              style={[
                styles.emptyTypePanel,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.emptyTypeTitle, { color: theme.text }]}>
                No fabric types created yet
              </Text>
              <Text style={[styles.emptyTypeText, { color: theme.textMuted }]}>
                Create the first fabric type first, then this selector will start working normally.
              </Text>

              {canCreateTypes ? (
                <>
                  <TouchableOpacity
                    style={[
                      styles.createTypeButton,
                      { backgroundColor: theme.primary },
                    ]}
                    onPress={() => setShowCreateType(open => !open)}
                  >
                    <Text style={styles.createTypeButtonText}>
                      {showCreateType ? 'Hide Creator' : 'Create Fabric Type'}
                    </Text>
                  </TouchableOpacity>

                  {showCreateType ? (
                    <View style={styles.createTypeForm}>
                      <TextInput
                        value={typeNameInput}
                        onChangeText={setTypeNameInput}
                        placeholder="Fabric unit name"
                        placeholderTextColor={theme.textMuted}
                        style={[
                          styles.createTypeInput,
                          {
                            borderColor: theme.border,
                            color: theme.text,
                            backgroundColor: theme.surfaceAlt,
                          },
                        ]}
                      />
                      <TextInput
                        value={fabricTypeInput}
                        onChangeText={setFabricTypeInput}
                        placeholder="Material / fabric type"
                        placeholderTextColor={theme.textMuted}
                        style={[
                          styles.createTypeInput,
                          {
                            borderColor: theme.border,
                            color: theme.text,
                            backgroundColor: theme.surfaceAlt,
                          },
                        ]}
                      />
                      <TextInput
                        value={sizeLabelInput}
                        onChangeText={setSizeLabelInput}
                        placeholder="Size label"
                        placeholderTextColor={theme.textMuted}
                        style={[
                          styles.createTypeInput,
                          {
                            borderColor: theme.border,
                            color: theme.text,
                            backgroundColor: theme.surfaceAlt,
                          },
                        ]}
                      />
                      <TouchableOpacity
                        style={[
                          styles.createTypeSubmit,
                          { backgroundColor: creatingType ? theme.surfaceStrong : theme.secondary },
                        ]}
                        onPress={handleCreateType}
                        disabled={creatingType}
                      >
                        <Text style={styles.createTypeSubmitText}>
                          {creatingType ? 'Creating...' : 'Save Fabric Type'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={[styles.emptyTypeHelp, { color: theme.textMuted }]}>
                  This handheld account can assign labels, but a Laundry manager needs to create the
                  fabric types first.
                </Text>
              )}
            </View>
          ) : null}
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>RFID Label Quantity</Text>
        <View style={styles.quantityRow}>
          <TouchableOpacity
            style={[
              styles.quantityButton,
              {
                backgroundColor:
                  assignmentComplete || expectedCount <= 1 ? theme.surfaceStrong : theme.surfaceAlt,
                borderColor: theme.border,
              },
            ]}
            disabled={assignmentComplete || expectedCount <= 1}
            onPress={() => setNextExpectedCount(expectedCount - 1)}
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
              {formatCount(expectedCount)}
            </Text>
            <Text style={[styles.quantityHelper, { color: theme.textMuted }]}>units</Text>
          </View>

          <TouchableOpacity
            style={[
              styles.quantityButton,
              {
                backgroundColor:
                  assignmentComplete || expectedCount >= 99 ? theme.surfaceStrong : theme.surfaceAlt,
                borderColor: theme.border,
              },
            ]}
            disabled={assignmentComplete || expectedCount >= 99}
            onPress={() => setNextExpectedCount(expectedCount + 1)}
          >
            <Text style={[styles.quantityButtonText, { color: theme.text }]}>+</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.secondaryButton,
            {
              backgroundColor: canScan ? theme.secondary : theme.surfaceStrong,
            },
          ]}
          onPress={beginRfidScan}
          disabled={!canScan}
        >
          <Text style={styles.secondaryButtonText}>
            {scanMode ? 'Scanning RFID Labels...' : 'Scan RFID Labels'}
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
          <Text style={[styles.progressTitle, { color: progressTone.textColor }]}>Assignment Progress</Text>
          <Text style={[styles.progressValue, { color: progressTone.textColor }]}>
            {formatCount(rfidCount)} / {formatCount(expectedCount)}
          </Text>
          <Text style={[styles.progressHelper, { color: progressTone.textColor }]}>
            {progressTone.helper}
          </Text>
        </View>

        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional note for this assignment"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.notesInput,
            {
              borderColor: theme.border,
              color: theme.text,
              backgroundColor: theme.surfaceAlt,
            },
          ]}
        />

        {rfidList.length ? (
          <View
            style={[
              styles.rfidPanel,
              { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
            ]}
          >
            <View style={styles.rfidPanelHeader}>
              <Text style={[styles.rfidPanelTitle, { color: theme.text }]}>Scanned Labels</Text>
              <TouchableOpacity
                onPress={() => {
                  setRfidList(prev => prev.slice(0, -1));
                  setAssignmentComplete(false);
                  setAssignmentSummary('');
                }}
              >
                <Text style={[styles.undoText, { color: theme.primary }]}>Undo Last</Text>
              </TouchableOpacity>
            </View>
            {rfidList.slice(0, 6).map(rfid => (
              <Text key={rfid} style={[styles.rfidRow, { color: theme.textMuted }]}>
                {rfid}
              </Text>
            ))}
            {rfidList.length > 6 ? (
              <Text style={[styles.rfidMoreText, { color: theme.textMuted }]}>
                +{rfidList.length - 6} more labels scanned
              </Text>
            ) : null}
          </View>
        ) : null}

        {assignmentComplete ? (
          <View style={styles.successWrap}>
            <View style={[styles.successPanel, { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' }]}>
              <Text style={styles.successTitle}>{'\u2713'} Assignment Complete</Text>
              <Text style={styles.successText}>
                {assignmentSummary || `${rfidCount} RFID label${rfidCount === 1 ? '' : 's'} assigned.`}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.resetButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
              onPress={resetAssignmentState}
            >
              <Text style={[styles.resetButtonText, { color: theme.text }]}>Assign Another Batch</Text>
            </TouchableOpacity>
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
                submitLabels(false);
              }}
              disabled={!canAssignExact || assigning}
            >
              <Text style={styles.assignButtonText}>
                {assigning ? 'Assigning...' : 'Assign Labels'}
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
                Assign Scanned Labels
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
  typeSummaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  typeSummaryCopy: {
    flex: 1,
  },
  infoValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  infoValueLeft: {
    flex: 1,
  },
  typeMeta: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  changeTypeButton: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  changeTypeText: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  typeDetailGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  typeDetailItem: {
    flex: 1,
  },
  typeDetailLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  typeDetailValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  typeList: {
    gap: 8,
  },
  emptyTypePanel: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  emptyTypeTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  emptyTypeText: {
    fontSize: 13,
    lineHeight: 19,
  },
  emptyTypeHelp: {
    fontSize: 12,
    lineHeight: 18,
  },
  createTypeButton: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  createTypeButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  createTypeForm: {
    gap: 10,
  },
  createTypeInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  createTypeSubmit: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  createTypeSubmitText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  typeOption: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  typeOptionCopy: {
    flex: 1,
  },
  typeOptionTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  typeOptionMeta: {
    fontSize: 12,
    lineHeight: 17,
  },
  typeOptionBadge: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    alignSelf: 'center',
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
    textAlign: 'center',
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 14,
  },
  rfidPanel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
  },
  rfidPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rfidPanelTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  undoText: {
    fontSize: 12,
    fontWeight: '800',
  },
  rfidRow: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  rfidMoreText: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
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
    gap: 10,
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
  resetButton: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
  },
  resetButtonText: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '800',
  },
});
