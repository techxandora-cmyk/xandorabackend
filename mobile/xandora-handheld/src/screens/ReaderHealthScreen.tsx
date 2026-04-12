import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { useScanner } from '../context/ScannerContext';
import { useAppTheme } from '../context/ThemeContext';
import {
  getAccessibleStores,
  getAuthSession,
  hasPermission,
  setCurrentStoreId,
} from '../services/session';
import {
  assignRetailDeviceZone,
  getRetailDevices,
  getRetailSectionProfiles,
  RetailDevice,
  RetailSectionProfile,
} from '../services/retailService';

type StoreOption = {
  id: string;
  name: string;
};

function formatAgo(value?: string | null): string {
  if (!value) return 'No heartbeat yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No heartbeat yet';

  const diffMinutes = Math.max(Math.floor((Date.now() - date.getTime()) / 60000), 0);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function statusTone(theme: any, value?: string | null) {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'ONLINE' || normalized === 'ACTIVE') {
    return {
      backgroundColor: `${theme.success}18`,
      borderColor: `${theme.success}45`,
      textColor: theme.success,
    };
  }

  if (normalized === 'OFFLINE') {
    return {
      backgroundColor: '#FEE2E2',
      borderColor: '#FCA5A5',
      textColor: '#991B1B',
    };
  }

  return {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    textColor: theme.textMuted,
  };
}

function resolveDeviceStatus(device: RetailDevice): string {
  return (
    String(
      device.connectivity_state ||
        device.lifecycle_state ||
        device.provisioning_state ||
        device.status ||
        'Unknown',
    )
      .replace(/_/g, ' ')
      .trim() || 'Unknown'
  );
}

function resolveDeviceZone(device: RetailDevice): string {
  const readerIdentity =
    device.reader_identity && typeof device.reader_identity === 'object'
      ? device.reader_identity
      : {};
  const zone = String(
    device.zone_label ||
      (readerIdentity as any)?.zone ||
      device.zone ||
      device.section_profile ||
      device.location_label ||
      device.location ||
      '',
  )
    .replace(/_/g, ' ')
    .trim();

  return zone || 'Unassigned zone';
}

function resolveHeartbeat(device: RetailDevice): string | null {
  const connectivity =
    device.connectivity && typeof device.connectivity === 'object'
      ? device.connectivity
      : {};
  return (
    String(
      (connectivity as any)?.last_heartbeat_at ||
        device.last_heartbeat ||
        device.last_seen ||
        device.updated_at ||
        '',
    ).trim() || null
  );
}

function SummaryBadge({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: any;
}) {
  return (
    <View
      style={[
        styles.summaryBadge,
        {
          backgroundColor: theme.surfaceAlt,
          borderColor: theme.border,
        },
      ]}
    >
      <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

export default function ReaderHealthScreen({ navigation }: any) {
  const { scannerConnected } = useScanner();
  const { theme } = useAppTheme();
  const [storeId, setStoreIdState] = useState('');
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [devices, setDevices] = useState<RetailDevice[]>([]);
  const [zoneProfiles, setZoneProfiles] = useState<RetailSectionProfile[]>([]);
  const [canManageZones, setCanManageZones] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [pendingProfileByDevice, setPendingProfileByDevice] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const hasMultipleStores = stores.length > 1;

  const zoneOptions = useMemo<RetailSectionProfile[]>(
    () => [
      {
        id: '',
        label: 'Unassigned',
        description: 'Clear the current zone from this reader.',
        default_zone_role: 'UNASSIGNED',
      },
      ...zoneProfiles,
    ],
    [zoneProfiles],
  );

  const loadDevices = useCallback(async (targetStoreId?: string, showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);

    try {
      const session = await getAuthSession();
      const availableStores = getAccessibleStores(session?.user);
      const resolvedStoreId =
        String(targetStoreId || session?.currentStoreId || availableStores[0]?.id || '')
          .trim()
          .toUpperCase();

      const [rows, profiles] = await Promise.all([
        resolvedStoreId ? getRetailDevices(resolvedStoreId) : Promise.resolve([]),
        getRetailSectionProfiles(),
      ]);

      const roles = Array.isArray(session?.user?.roles) ? session.user.roles : [];
      const canEditZones =
        roles.includes('ADMIN') ||
        roles.includes('MASTER_ADMIN') ||
        hasPermission(session?.user, 'handheld.device_settings');

      setStores(availableStores);
      setStoreIdState(resolvedStoreId);
      setDevices(rows);
      setZoneProfiles(profiles);
      setCanManageZones(canEditZones);
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not load reader health');
      setDevices([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const handleSelectStore = async (nextStoreId: string) => {
    const normalized = String(nextStoreId || '').trim().toUpperCase();
    if (!normalized || normalized === storeId) {
      setStoreMenuOpen(false);
      return;
    }

    setStoreIdState(normalized);
    setStoreMenuOpen(false);
    setEditingDeviceId(null);
    await setCurrentStoreId(normalized);
    loadDevices(normalized, true);
  };

  const stats = useMemo(() => {
    const online = devices.filter(device =>
      ['ONLINE', 'ACTIVE'].includes(String(resolveDeviceStatus(device)).toUpperCase()),
    ).length;
    const offline = devices.filter(
      device => String(resolveDeviceStatus(device)).toUpperCase() === 'OFFLINE',
    ).length;
    const zones = new Set(devices.map(device => resolveDeviceZone(device))).size;

    return {
      total: devices.length,
      online,
      offline,
      zones,
    };
  }, [devices]);

  const storeSubtitle = hasMultipleStores
    ? 'Switch between your assigned stores to inspect reader health.'
    : 'This handheld account is scoped to one store.';

  const beginZoneEdit = (device: RetailDevice) => {
    const deviceId = String(device.device_id || device.id || '').trim();
    if (!deviceId) {
      return;
    }

    setEditingDeviceId(deviceId);
    setPendingProfileByDevice(prev => ({
      ...prev,
      [deviceId]: String(device.section_profile || '').trim().toUpperCase(),
    }));
  };

  const handleZoneSave = async (device: RetailDevice) => {
    const deviceId = String(device.device_id || device.id || '').trim();
    if (!deviceId) {
      return;
    }

    const selectedProfileId = String(pendingProfileByDevice[deviceId] || '')
      .trim()
      .toUpperCase();
    const selectedProfile =
      zoneOptions.find(profile => profile.id === selectedProfileId) || zoneOptions[0];

    setSavingDeviceId(deviceId);

    try {
      await assignRetailDeviceZone({
        deviceId,
        storeId,
        sectionProfileId: selectedProfileId || null,
        zoneLabel: selectedProfileId ? selectedProfile.label : null,
      });

      setEditingDeviceId(null);
      Alert.alert(
        'Zone updated',
        selectedProfileId
          ? `${selectedProfile.label} is now assigned to this reader.`
          : 'This reader has been cleared from its previous zone.',
      );
      loadDevices(storeId, true);
    } catch (err: any) {
      Alert.alert(
        'Zone update failed',
        err?.response?.data?.error || err?.message || 'Could not update this reader zone.',
      );
    } finally {
      setSavingDeviceId(null);
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            loadDevices(storeId, true);
          }}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Reader Health"
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
          <View style={styles.heroCopyWrap}>
            <Text style={[styles.heroEyebrow, { color: theme.textMuted }]}>Retail device health</Text>
            <Text style={[styles.heroTitle, { color: theme.text }]}>Live reader overview</Text>
            <Text style={[styles.heroHelper, { color: theme.textMuted }]}>
              Check handheld connection, reader status, heartbeat activity, and assigned zones.
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.refreshButton,
              {
                backgroundColor: theme.surfaceAlt,
                borderColor: theme.border,
              },
            ]}
            onPress={() => {
              loadDevices(storeId, true);
            }}
          >
            <Text style={[styles.refreshButtonText, { color: theme.text }]}>Refresh</Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.storeSelectorCard,
            {
              backgroundColor: theme.surfaceAlt,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.storeSelectorHeader}>
            <View style={styles.storeSelectorCopy}>
              <Text style={[styles.storeSelectorLabel, { color: theme.textMuted }]}>Selected Store</Text>
              <Text style={[styles.storeSelectorValue, { color: theme.text }]}>
                {storeId || 'No store'}
              </Text>
              <Text style={[styles.storeSelectorHint, { color: theme.textMuted }]}>
                {storeSubtitle}
              </Text>
            </View>

            {hasMultipleStores ? (
              <TouchableOpacity
                style={[
                  styles.storeSelectorButton,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setStoreMenuOpen(open => !open)}
              >
                <Text style={[styles.storeSelectorButtonText, { color: theme.text }]}>
                  {storeMenuOpen ? 'Hide' : 'Change'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {hasMultipleStores && storeMenuOpen ? (
            <View style={styles.storeMenuList}>
              {stores.map(store => {
                const selected = store.id === storeId;
                return (
                  <TouchableOpacity
                    key={store.id}
                    style={[
                      styles.storeMenuItem,
                      {
                        backgroundColor: selected ? `${theme.primary}14` : theme.surface,
                        borderColor: selected ? `${theme.primary}45` : theme.border,
                      },
                    ]}
                    onPress={() => {
                      handleSelectStore(store.id);
                    }}
                  >
                    <Text
                      style={[
                        styles.storeMenuItemText,
                        { color: selected ? theme.primary : theme.text },
                      ]}
                    >
                      {store.name}
                    </Text>
                    {selected ? (
                      <Text style={[styles.storeMenuSelected, { color: theme.primary }]}>
                        Active
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>

        <View style={styles.heroMetaRow}>
          <SummaryBadge label="Scanner" value={scannerConnected ? 'Online' : 'Offline'} theme={theme} />
          <SummaryBadge label="Readers Online" value={String(stats.online)} theme={theme} />
        </View>
      </View>

      <View style={styles.summaryRow}>
        <SummaryBadge label="Readers Offline" value={String(stats.offline)} theme={theme} />
        <SummaryBadge label="Tracked Zones" value={String(stats.zones)} theme={theme} />
        <SummaryBadge label="Total Devices" value={String(stats.total)} theme={theme} />
      </View>

      {error ? (
        <View
          style={[
            styles.errorPanel,
            { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
          ]}
        >
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View
          style={[
            styles.emptyPanel,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.emptyTitle, { color: theme.text }]}>Loading reader health...</Text>
          <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>
            Pulling live device status for the selected store.
          </Text>
        </View>
      ) : null}

      {!loading && devices.length === 0 ? (
        <View
          style={[
            styles.emptyPanel,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No readers assigned</Text>
          <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>
            This store does not have any registered readers yet.
          </Text>
        </View>
      ) : null}

      {!loading &&
        devices.map(device => {
          const deviceId = String(device.device_id || device.id || '').trim();
          const status = resolveDeviceStatus(device);
          const tone = statusTone(theme, status);
          const heartbeat = resolveHeartbeat(device);
          const isEditing = editingDeviceId === deviceId;
          const selectedProfileId = String(
            pendingProfileByDevice[deviceId] || device.section_profile || '',
          )
            .trim()
            .toUpperCase();

          return (
            <View
              key={deviceId || String(device.id)}
              style={[
                styles.deviceCard,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  shadowColor: theme.shadow,
                },
              ]}
            >
              <View style={styles.deviceHeader}>
                <View style={styles.deviceInfo}>
                  <Text style={[styles.deviceName, { color: theme.text }]}>
                    {device.display_name || device.name || device.device_id || 'Retail Reader'}
                  </Text>
                  <Text style={[styles.deviceMeta, { color: theme.textMuted }]}>
                    {String(device.device_type || 'reader').replace(/_/g, ' ')} -{' '}
                    {device.device_id || 'No device id'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusTag,
                    {
                      backgroundColor: tone.backgroundColor,
                      borderColor: tone.borderColor,
                    },
                  ]}
                >
                  <Text style={[styles.statusTagText, { color: tone.textColor }]}>{status}</Text>
                </View>
              </View>

              <View style={styles.deviceDetailGrid}>
                <View
                  style={[
                    styles.detailBlock,
                    { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
                  ]}
                >
                  <Text style={[styles.detailLabel, { color: theme.textMuted }]}>Zone</Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>
                    {resolveDeviceZone(device)}
                  </Text>
                </View>

                <View
                  style={[
                    styles.detailBlock,
                    { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
                  ]}
                >
                  <Text style={[styles.detailLabel, { color: theme.textMuted }]}>Heartbeat</Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>
                    {formatAgo(heartbeat)}
                  </Text>
                </View>
              </View>

              {canManageZones ? (
                <View style={styles.zoneManagerWrap}>
                  <View style={styles.zoneManagerHeader}>
                    <View style={styles.zoneManagerCopy}>
                      <Text style={[styles.zoneManagerTitle, { color: theme.text }]}>
                        Zone Assignment
                      </Text>
                      <Text style={[styles.zoneManagerHint, { color: theme.textMuted }]}>
                        Set the reader zone for this store.
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.zoneToggleButton,
                        {
                          backgroundColor: theme.surfaceAlt,
                          borderColor: theme.border,
                        },
                      ]}
                      onPress={() => {
                        if (isEditing) {
                          setEditingDeviceId(null);
                          return;
                        }
                        beginZoneEdit(device);
                      }}
                    >
                      <Text style={[styles.zoneToggleText, { color: theme.text }]}>
                        {isEditing ? 'Cancel' : 'Assign Zone'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {isEditing ? (
                    <View
                      style={[
                        styles.zonePanel,
                        {
                          backgroundColor: theme.surfaceAlt,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <View style={styles.zoneChipGrid}>
                        {zoneOptions.map(profile => {
                          const selected = profile.id === selectedProfileId;
                          return (
                            <TouchableOpacity
                              key={profile.id || 'UNASSIGNED'}
                              style={[
                                styles.zoneChip,
                                {
                                  backgroundColor: selected ? `${theme.primary}16` : theme.surface,
                                  borderColor: selected ? `${theme.primary}55` : theme.border,
                                },
                              ]}
                              onPress={() => {
                                setPendingProfileByDevice(prev => ({
                                  ...prev,
                                  [deviceId]: profile.id,
                                }));
                              }}
                            >
                              <Text
                                style={[
                                  styles.zoneChipTitle,
                                  { color: selected ? theme.primary : theme.text },
                                ]}
                              >
                                {profile.label}
                              </Text>
                              <Text
                                style={[
                                  styles.zoneChipSubtitle,
                                  { color: theme.textMuted },
                                ]}
                              >
                                {profile.description ||
                                  (profile.default_zone_role
                                    ? `Role ${profile.default_zone_role}`
                                    : 'Clear current zone')}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.zoneSaveButton,
                          {
                            backgroundColor:
                              savingDeviceId === deviceId ? theme.surface : theme.primary,
                            borderColor: theme.border,
                          },
                        ]}
                        onPress={() => {
                          handleZoneSave(device);
                        }}
                        disabled={savingDeviceId === deviceId}
                      >
                        <Text
                          style={[
                            styles.zoneSaveText,
                            {
                              color: savingDeviceId === deviceId ? theme.textMuted : '#FFFFFF',
                            },
                          ]}
                        >
                          {savingDeviceId === deviceId ? 'Saving...' : 'Save Zone'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
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
  heroCard: {
    borderWidth: 1,
    borderRadius: 26,
    padding: 22,
    marginBottom: 14,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  heroCopyWrap: {
    flex: 1,
  },
  heroEyebrow: {
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
  },
  refreshButton: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignSelf: 'flex-start',
  },
  refreshButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  storeSelectorCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
  },
  storeSelectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  storeSelectorCopy: {
    flex: 1,
  },
  storeSelectorLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  storeSelectorValue: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  storeSelectorHint: {
    fontSize: 13,
    lineHeight: 19,
  },
  storeSelectorButton: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  storeSelectorButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  storeMenuList: {
    marginTop: 12,
    gap: 8,
  },
  storeMenuItem: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  storeMenuItemText: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  storeMenuSelected: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  heroMetaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  summaryBadge: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  errorPanel: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  emptyPanel: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 21,
  },
  deviceCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    marginBottom: 14,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  deviceMeta: {
    fontSize: 13,
    lineHeight: 19,
  },
  statusTag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  statusTagText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  deviceDetailGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  detailBlock: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  zoneManagerWrap: {
    marginTop: 16,
  },
  zoneManagerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  zoneManagerCopy: {
    flex: 1,
  },
  zoneManagerTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  zoneManagerHint: {
    fontSize: 13,
    lineHeight: 18,
  },
  zoneToggleButton: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  zoneToggleText: {
    fontSize: 12,
    fontWeight: '800',
  },
  zonePanel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
  },
  zoneChipGrid: {
    gap: 8,
    marginBottom: 12,
  },
  zoneChip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  zoneChipTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  zoneChipSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  zoneSaveButton: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  zoneSaveText: {
    fontSize: 14,
    fontWeight: '800',
  },
});
