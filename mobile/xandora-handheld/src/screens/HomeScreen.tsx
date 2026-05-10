import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BrandMark from '../components/BrandMark';
import ScannerConnectButton from '../components/ScannerConnectButton';
import { getSoftwareOption } from '../config/softwareModules';
import { useAppTheme } from '../context/ThemeContext';
import {
  AuthUser,
  clearAuthSession,
  getAccessibleStores,
  getAuthSession,
  hasPermission,
  saveLocalDisplayName,
  setCurrentStoreId as persistCurrentStoreId,
} from '../services/session';
import { brand } from '../theme/brand';

const { width } = Dimensions.get('window');
const DRAWER_WIDTH = width * 0.62;

type ActionCard = {
  key: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: string;
  accent: string;
  onPress: () => void;
  visible: boolean;
};

const MODULE_ACCENTS = {
  retail: brand.colors.blue,
  laundry: brand.colors.blue,
  stock_audit: brand.colors.blue,
  default: brand.colors.blue,
};

function canOpenAssignStore(user: AuthUser | null): boolean {
  if (!user) return false;
  if (user.roles.includes('ADMIN') || user.roles.includes('MASTER_ADMIN')) {
    return true;
  }

  return (Array.isArray(user.store_ids) ? user.store_ids.length : 0) > 1;
}

function canOpenItemStatus(user: AuthUser | null): boolean {
  if (!user) return false;
  if (user.roles.includes('ADMIN') || user.roles.includes('MASTER_ADMIN')) {
    return true;
  }

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.some((permission) =>
    [
      'handheld.scan_items',
      'handheld.scan',
      'dashboard.view_billing',
      'dashboard.view_pos',
    ].includes(String(permission || '').trim()),
  );
}

function canOpenAlerts(user: AuthUser | null): boolean {
  if (!user) return false;
  return (
    hasPermission(user, 'alerts.receive') ||
    hasPermission(user, 'dashboard.view_alerts')
  );
}

function canOpenPosValidate(user: AuthUser | null): boolean {
  if (!user) return false;
  if (user.roles.includes('ADMIN') || user.roles.includes('MASTER_ADMIN')) {
    return true;
  }

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.some((permission) =>
    ['dashboard.view_billing', 'dashboard.view_pos'].includes(
      String(permission || '').trim(),
    ),
  );
}

export default function HomeScreen({ navigation }: any) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showAccountDetails, setShowAccountDetails] = useState(false);
  const [accountName, setAccountName] = useState<string>('Operator');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [isSavingDisplayName, setIsSavingDisplayName] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [currentStoreId, setCurrentStoreId] = useState<string>('');
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const { mode, theme, toggleMode } = useAppTheme();

  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  useEffect(() => {
    const loadSession = async () => {
      const session = await getAuthSession();
      if (!session) {
        navigation.replace('Login');
        return;
      }

      setAccountName(session.displayName);
      setDisplayNameInput(session.displayName);
      setUser(session.user);
      setCurrentStoreId(session.currentStoreId || '');
      setStores(getAccessibleStores(session.user));
      setShowAccountDetails(false);
    };

    loadSession();
  }, [navigation]);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: drawerOpen ? 0 : -DRAWER_WIDTH,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [drawerOpen, slideAnim]);

  const selectedProduct = getSoftwareOption(user?.product_key);
  const canAssignItems = hasPermission(user, 'handheld.scan_items');
  const canAudit =
    hasPermission(user, 'handheld.run_audits') ||
    hasPermission(user, 'handheld.inventory_count');
  const canStockAudit =
    canAudit ||
    hasPermission(user, 'dashboard.view_stock_audit') ||
    hasPermission(user, 'dashboard.manage_stock_audit');
  const canLaundryScan =
    hasPermission(user, 'handheld.laundry_scan') ||
    hasPermission(user, 'handheld.scan_items') ||
    hasPermission(user, 'dashboard.view_laundry') ||
    hasPermission(user, 'dashboard.manage_laundry');
  const canAssignStore = canAssignItems && canOpenAssignStore(user);
  const canItemStatus = selectedProduct.value === 'retail' && canOpenItemStatus(user);
  const canPosValidate =
    selectedProduct.value === 'retail' && canOpenPosValidate(user);
  const canViewAlerts = canOpenAlerts(user);
  const hasMultipleStores = stores.length > 1;
  const sectionTitle =
    selectedProduct.value === 'retail'
      ? 'Retail Operations'
      : selectedProduct.value === 'laundry'
      ? 'Laundry Operations'
      : selectedProduct.value === 'stock_audit'
      ? 'Stock Count'
      : `${selectedProduct.shortLabel} Workflows`;
  const sectionSubtitle =
    selectedProduct.value === 'retail'
      ? 'Run handheld tagging, POS validation, item lookups, transfers, alerts, and reader checks from one mobile workspace.'
      : selectedProduct.value === 'laundry'
      ? 'Handle intake, wash movement, fabric status, and exception work from one focused laundry workspace.'
      : selectedProduct.value === 'stock_audit'
      ? 'Start a count, scan tags, review mismatches, and check past counts from one simple handheld flow.'
      : selectedProduct.heroSummary;
  const moduleAccent =
    selectedProduct.value === 'retail'
      ? MODULE_ACCENTS.retail
      : selectedProduct.value === 'laundry'
      ? MODULE_ACCENTS.laundry
      : selectedProduct.value === 'stock_audit'
      ? MODULE_ACCENTS.stock_audit
      : MODULE_ACCENTS.default;

  const handleLogout = async () => {
    setDrawerOpen(false);
    await clearAuthSession();
    navigation.reset({
      index: 0,
      routes: [{ name: 'Login' }],
    });
  };

  const confirmLogout = () => {
    Alert.alert('Log out', 'Do you want to sign out of Xandora Handheld?', [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          handleLogout();
        },
      },
    ]);
  };

  const handleAboutUs = async () => {
    try {
      setDrawerOpen(false);
      await Linking.openURL('https://xandora.tech/');
    } catch {
      Alert.alert(
        'Unable to open website',
        'Please visit https://xandora.tech/ in your browser.',
      );
    }
  };

  const handleSaveDisplayName = async () => {
    if (!user?.email) {
      Alert.alert('Unable to update', 'This account does not have a valid email.');
      return;
    }

    setIsSavingDisplayName(true);

    try {
      const resolvedDisplayName = await saveLocalDisplayName(user.email, displayNameInput);
      setAccountName(resolvedDisplayName);
      setDisplayNameInput(resolvedDisplayName);
      Alert.alert('Saved', 'This app-only username has been updated for this login.');
    } catch (error: any) {
      Alert.alert(
        'Save failed',
        error?.message || 'Could not update the app-only username.',
      );
    } finally {
      setIsSavingDisplayName(false);
    }
  };

  const handleSelectStore = async (nextStoreId: string) => {
    const normalized = String(nextStoreId || '').trim().toUpperCase();
    if (!normalized || normalized === currentStoreId) {
      setStoreMenuOpen(false);
      return;
    }

    await persistCurrentStoreId(normalized);
    setCurrentStoreId(normalized);
    setStoreMenuOpen(false);
  };

  const retailActions = useMemo<ActionCard[]>(
    () => [
      {
        key: 'assign-items',
        eyebrow: 'Tag Intake',
        title: 'Assign Tags',
        subtitle: 'Verify barcodes and bind RFID tags for new retail stock.',
        icon: '\u{1F4E6}',
        accent: MODULE_ACCENTS.retail,
        onPress: () => navigation.navigate('AssignItems'),
        visible: canAssignItems,
      },
      {
        key: 'item-status',
        eyebrow: 'Lookup',
        title: 'Item Status',
        subtitle: 'Scan one RFID or barcode to check where the item belongs and whether it is known.',
        icon: '\u{1F50E}',
        accent: MODULE_ACCENTS.retail,
        onPress: () => navigation.navigate('ItemStatus'),
        visible: canItemStatus,
      },
      {
        key: 'pos-validate',
        eyebrow: 'Checkout',
        title: 'POS Validate',
        subtitle: 'Scan EPCs into the retail billing flow before checkout or billing completion.',
        icon: '\u{1F9FE}',
        accent: MODULE_ACCENTS.retail,
        onPress: () => navigation.navigate('PosValidate'),
        visible: canPosValidate,
      },
      {
        key: 'assign-store',
        eyebrow: 'Movement',
        title: 'Store Transfer',
        subtitle: 'Move tagged retail stock between the stores assigned to this account.',
        icon: '\u{1F3EC}',
        accent: MODULE_ACCENTS.retail,
        onPress: () => navigation.navigate('AssignStore'),
        visible: canAssignStore,
      },
      {
        key: 'notifications',
        eyebrow: 'Exceptions',
        title: 'Alerts',
        subtitle: 'Review open retail issues, scanner alerts, and validation exceptions.',
        icon: '\u{1F514}',
        accent: MODULE_ACCENTS.retail,
        onPress: () => navigation.navigate('Notifications'),
        visible: canViewAlerts,
      },
      {
        key: 'reader-health',
        eyebrow: 'Device Health',
        title: 'Reader Health',
        subtitle: 'Check handheld and in-store reader status, zones, and heartbeat timing.',
        icon: '\u{1F4E1}',
        accent: MODULE_ACCENTS.retail,
        onPress: () => navigation.navigate('ReaderHealth'),
        visible: selectedProduct.value === 'retail',
      },
    ],
    [
      canAssignItems,
      canAssignStore,
      canItemStatus,
      canPosValidate,
      canViewAlerts,
      navigation,
      selectedProduct.value,
    ],
  );

  const fallbackActions = useMemo<ActionCard[]>(
    () => [
      {
        key: 'assign-items',
        eyebrow: 'Scanner Intake',
        title: 'Assign Items',
        subtitle: 'Verify barcodes and prepare tagged items for handheld workflows.',
        icon: '\u{1F4E6}',
        accent: MODULE_ACCENTS.default,
        onPress: () => navigation.navigate('AssignItems'),
        visible: canAssignItems,
      },
      {
        key: 'assign-store',
        eyebrow: 'Movement',
        title: 'Assign Store',
        subtitle: 'Move tagged items between accessible stores for this handheld account.',
        icon: '\u{1F3EC}',
        accent: MODULE_ACCENTS.default,
        onPress: () => navigation.navigate('AssignStore'),
        visible: canAssignStore,
      },
      {
        key: 'audit',
        eyebrow: 'Verification',
        title: selectedProduct.value === 'stock_audit' ? 'Count Verification' : 'Audit',
        subtitle:
          selectedProduct.value === 'laundry'
            ? 'Verify scanned items and barcode matches before moving to the next laundry step.'
            : 'Scan tags and compare them against the expected barcode set.',
        icon: '\u{1F9FE}',
        accent: MODULE_ACCENTS.default,
        onPress: () => navigation.navigate('Audit'),
        visible: canAudit,
      },
      {
        key: 'notifications',
        eyebrow: 'Alerts',
        title: 'Notifications',
        subtitle: 'Review active issues and store-level events for this module.',
        icon: '\u{1F514}',
        accent: MODULE_ACCENTS.default,
        onPress: () => navigation.navigate('Notifications'),
        visible: canViewAlerts,
      },
    ],
    [canAssignItems, canAssignStore, canAudit, canViewAlerts, navigation, selectedProduct.value],
  );

  const laundryActions = useMemo<ActionCard[]>(
    () => [
      {
        key: 'laundry-assign-items',
        eyebrow: 'Tag Setup',
        title: 'Assign Fabrics',
        subtitle: 'Pick the fabric unit and bind fresh RFID labels for replacements or new stock.',
        icon: '\u{1F3F7}\uFE0F',
        accent: MODULE_ACCENTS.laundry,
        onPress: () => navigation.navigate('LaundryAssignItems'),
        visible: canLaundryScan,
      },
      {
        key: 'laundry-inbound',
        eyebrow: 'Customer Flow',
        title: 'Receive & Deliver',
        subtitle: 'Handle return pickups and customer deliveries with store-aware count matching.',
        icon: '\u{1F9FA}',
        accent: MODULE_ACCENTS.laundry,
        onPress: () => navigation.navigate('LaundryInbound'),
        visible: canLaundryScan,
      },
      {
        key: 'laundry-wash-flow',
        eyebrow: 'Wash Cycle',
        title: 'Wash',
        subtitle: 'Load fabrics into the washer, then scan them back out to record the cycle and return to stock.',
        icon: '\u{1F30A}',
        accent: MODULE_ACCENTS.laundry,
        onPress: () => navigation.navigate('LaundryWashFlow'),
        visible: canLaundryScan,
      },
      {
        key: 'laundry-status',
        eyebrow: 'Traceability',
        title: 'Status',
        subtitle: 'Check one fabric RFID for location, lifecycle state, and recent laundry activity.',
        icon: '\u{1F50D}',
        accent: MODULE_ACCENTS.laundry,
        onPress: () => navigation.navigate('LaundryStatus'),
        visible: canLaundryScan || hasPermission(user, 'dashboard.view_laundry'),
      },
      {
        key: 'laundry-exceptions',
        eyebrow: 'Exceptions',
        title: 'Exceptions',
        subtitle: 'Mark damaged, lost, or retired fabrics without slowing down the main wash flow.',
        icon: '\u26A0\uFE0F',
        accent: MODULE_ACCENTS.laundry,
        onPress: () => navigation.navigate('LaundryExceptions'),
        visible: canLaundryScan,
      },
      {
        key: 'laundry-alerts',
        eyebrow: 'Cycle Watch',
        title: 'Cycle Alerts',
        subtitle: 'See fabrics nearing or exceeding the 200-wash policy for this store.',
        icon: '\u{1F514}',
        accent: MODULE_ACCENTS.laundry,
        onPress: () => navigation.navigate('Notifications'),
        visible: canViewAlerts,
      },
    ],
    [canLaundryScan, canViewAlerts, navigation, user],
  );

  const stockAuditActions = useMemo<ActionCard[]>(
    () => [
      {
        key: 'stock-audit-count',
        eyebrow: 'Count',
        title: 'Count Items',
        subtitle: 'Start the count, scan RFID tags, and finish the session from one simple screen.',
        icon: '\u{1F4F6}',
        accent: MODULE_ACCENTS.stock_audit,
        onPress: () => navigation.navigate('StockAuditCount'),
        visible: canStockAudit,
      },
      {
        key: 'stock-audit-findings',
        eyebrow: 'Review',
        title: 'Results',
        subtitle: 'Check missing items, unknown EPCs, and grouped issues before you finish the count.',
        icon: '\u26A0\uFE0F',
        accent: MODULE_ACCENTS.stock_audit,
        onPress: () => navigation.navigate('StockAuditFindings'),
        visible: canStockAudit,
      },
      {
        key: 'stock-audit-history',
        eyebrow: 'Past Counts',
        title: 'History',
        subtitle: 'Review completed counts, accuracy, duration, and operator trace for this store.',
        icon: '\u{1F4DA}',
        accent: MODULE_ACCENTS.stock_audit,
        onPress: () => navigation.navigate('StockAuditHistory'),
        visible: canStockAudit,
      },
    ],
    [canStockAudit, navigation],
  );

  const actionCards =
    selectedProduct.value === 'retail'
      ? retailActions.filter((card) => card.visible)
      : selectedProduct.value === 'laundry'
      ? laundryActions.filter((card) => card.visible)
      : selectedProduct.value === 'stock_audit'
      ? stockAuditActions.filter((card) => card.visible)
      : fallbackActions.filter((card) => card.visible);
  const accountEmail = user?.email || accountName;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.background }]}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => setDrawerOpen(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <BrandMark
              size="xs"
              light={mode === 'dark'}
              subtitle={false}
              iconOnly
            />
          </TouchableOpacity>

          <View style={styles.topStatusRow}>
            <View
              style={[
                styles.storePill,
                {
                  backgroundColor: theme.surfaceRaised,
                  borderColor: theme.accentSoft,
                },
              ]}
            >
              <Text style={[styles.storePillLabel, { color: theme.textMuted }]}>
                Store
              </Text>
              <Text
                style={[styles.storePillValue, { color: theme.text }]}
                numberOfLines={1}
              >
                {currentStoreId || 'No store'}
              </Text>
            </View>

            {hasMultipleStores ? (
              <TouchableOpacity
                style={[
                  styles.storeSwitchButton,
                  {
                    backgroundColor: theme.surfaceRaised,
                    borderColor: theme.accentSoft,
                  },
                ]}
                onPress={() => setStoreMenuOpen(open => !open)}
              >
                <Text style={[styles.storeSwitchButtonText, { color: theme.text }]}>
                  {storeMenuOpen ? 'Hide' : 'Switch'}
                </Text>
              </TouchableOpacity>
            ) : null}

            <ScannerConnectButton compact variant="status" />
          </View>
        </View>

        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {hasMultipleStores && storeMenuOpen ? (
            <View
              style={[
                styles.storeSwitcherCard,
                {
                  backgroundColor: theme.surfaceRaised,
                  borderColor: theme.accentSoft,
                  shadowColor: theme.shadow,
                },
              ]}
            >
              <View style={styles.storeSwitcherHeader}>
                <View style={styles.storeSwitcherCopy}>
                  <Text style={[styles.storeSwitcherLabel, { color: theme.textMuted }]}>
                    Switch Store
                  </Text>
                  <Text style={[styles.storeSwitcherValue, { color: theme.text }]}>
                    {currentStoreId || 'No store selected'}
                  </Text>
                </View>
              </View>

              <View style={styles.storeOptionList}>
                {stores.map(store => {
                  const selected = store.id === currentStoreId;
                  return (
                    <TouchableOpacity
                      key={store.id}
                      style={[
                        styles.storeOption,
                        {
                          backgroundColor: selected ? `${moduleAccent}12` : theme.surfaceAlt,
                          borderColor: selected ? `${moduleAccent}44` : theme.border,
                        },
                      ]}
                      onPress={() => {
                        handleSelectStore(store.id);
                      }}
                    >
                      <Text
                        style={[
                          styles.storeOptionText,
                          { color: selected ? moduleAccent : theme.text },
                        ]}
                      >
                        {store.name}
                      </Text>
                      {selected ? (
                        <Text
                          style={[
                            styles.storeOptionBadge,
                            { color: moduleAccent },
                          ]}
                        >
                          Active
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionEyebrow, { color: moduleAccent }]}>
              {selectedProduct.label}
            </Text>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {sectionTitle}
            </Text>
            <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>
              {sectionSubtitle}
            </Text>
          </View>

          <View style={styles.grid}>
            {actionCards.map((card) => (
              <TouchableOpacity
                key={card.key}
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.surfaceRaised,
                    borderColor: theme.border,
                    shadowColor: theme.shadow,
                  },
                ]}
                onPress={card.onPress}
              >
                <View
                  style={[
                    styles.cardTopRule,
                    {
                      backgroundColor: card.accent,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.cardIconWrap,
                    {
                      backgroundColor: theme.surfaceAlt,
                    borderColor: `${card.accent}24`,
                    },
                  ]}
                >
                  <Text style={styles.cardIcon}>{card.icon}</Text>
                </View>
                <Text style={[styles.cardEyebrow, { color: card.accent }]}>{card.eyebrow}</Text>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{card.title}</Text>
                <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>
                  {card.subtitle}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {!actionCards.length ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: theme.surfaceRaised,
                  borderColor: theme.accentSoft,
                },
              ]}
            >
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                No handheld actions assigned
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>
                This handheld account logged in successfully, but no actions are
                enabled for this module yet.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {drawerOpen ? (
          <Pressable
            style={[styles.overlay, { backgroundColor: theme.overlay }]}
            onPress={() => setDrawerOpen(false)}
          />
        ) : null}

        <Animated.View
          style={[
            styles.drawer,
            {
              transform: [{ translateX: slideAnim }],
              backgroundColor: theme.drawer,
              borderRightColor: theme.border,
            },
          ]}
        >
          <View style={styles.drawerTop}>
            <BrandMark size="sm" subtitle={false} iconOnly />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={
                mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
              }
              style={[
                styles.themeToggleButton,
                {
                  backgroundColor: theme.surfaceAlt,
                  borderColor: theme.border,
                },
              ]}
              onPress={toggleMode}
            >
              <Text style={styles.themeToggleIcon}>
                {mode === 'dark' ? 'Light' : 'Dark'}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.accountTab, { backgroundColor: theme.surfaceAlt }]}
            onPress={() => setShowAccountDetails((value) => !value)}
          >
            <View>
              <Text style={[styles.accountTitle, { color: theme.text }]}>User Account</Text>
              <Text style={[styles.accountSubtitle, { color: theme.textMuted }]}>
                View signed-in details
              </Text>
            </View>
            <Text style={[styles.accountChevron, { color: theme.textMuted }]}>
              {showAccountDetails ? '\u2212' : '+'}
            </Text>
          </TouchableOpacity>

          {showAccountDetails ? (
            <View
              style={[
                styles.accountPanel,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.accountRow}>
                <Text style={[styles.accountRowLabel, { color: theme.textMuted }]}>Username</Text>
                <Text style={[styles.accountRowValue, { color: theme.text }]}>{accountName}</Text>
              </View>
              <View style={styles.accountRow}>
                <Text style={[styles.accountRowLabel, { color: theme.textMuted }]}>Email</Text>
                <Text style={[styles.accountRowValue, { color: theme.text }]}>{accountEmail}</Text>
              </View>
              <View style={styles.accountRow}>
                <Text style={[styles.accountRowLabel, { color: theme.textMuted }]}>
                  App-Only Username
                </Text>
                <TextInput
                  value={displayNameInput}
                  onChangeText={setDisplayNameInput}
                  placeholder="Enter app username"
                  placeholderTextColor={theme.textMuted}
                  style={[
                    styles.accountInput,
                    {
                      backgroundColor: theme.surfaceAlt,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                />
                <Text style={[styles.accountHelpText, { color: theme.textMuted }]}>
                  Saved only on this app for this email login.
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.accountSaveButton,
                  {
                    backgroundColor: isSavingDisplayName ? theme.surfaceAlt : theme.primary,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => {
                  handleSaveDisplayName();
                }}
                disabled={isSavingDisplayName}
              >
                <Text
                  style={[
                    styles.accountSaveText,
                    { color: isSavingDisplayName ? theme.textMuted : '#FFFFFF' },
                  ]}
                >
                  {isSavingDisplayName ? 'Saving...' : 'Save Username'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.aboutButton, { backgroundColor: theme.surfaceAlt }]}
            onPress={handleAboutUs}
          >
            <Text style={[styles.aboutTitle, { color: theme.text }]}>About Us</Text>
            <Text style={[styles.aboutSubtitle, { color: theme.textMuted }]}>
              xandora.tech
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.logoutButton, { backgroundColor: theme.danger }]}
            onPress={confirmLogout}
          >
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 8,
    overflow: 'hidden',
  },
  contentScroll: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 28,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  menuButton: {
    alignSelf: 'flex-start',
  },
  topStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 1,
    marginLeft: 10,
  },
  storeSwitchButton: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  storeSwitchButtonText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  storePill: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 116,
    maxWidth: 150,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  storePillLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  storePillValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  storeSwitcherCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
    marginBottom: 16,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  storeSwitcherHeader: {
    marginBottom: 10,
  },
  storeSwitcherCopy: {
    gap: 4,
  },
  storeSwitcherLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  storeSwitcherValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  storeOptionList: {
    gap: 8,
  },
  storeOption: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  storeOptionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  storeOptionBadge: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionHeader: {
    marginBottom: 14,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    lineHeight: 21,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    minHeight: 192,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginBottom: 16,
    borderWidth: 1,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
    overflow: 'hidden',
  },
  cardTopRule: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  cardIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  cardIcon: {
    fontSize: 24,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
    lineHeight: 22,
  },
  cardEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  cardSubtitle: {
    fontSize: 13,
    lineHeight: 20,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginTop: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 21,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    paddingTop: 34,
    paddingHorizontal: 16,
    zIndex: 20,
    borderRightWidth: 1,
  },
  drawerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  themeToggleButton: {
    minWidth: 56,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  themeToggleIcon: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  accountTab: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accountTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  accountSubtitle: {
    fontSize: 12,
  },
  accountChevron: {
    fontSize: 22,
    fontWeight: '500',
    lineHeight: 22,
  },
  accountPanel: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    gap: 10,
  },
  accountRow: {
    gap: 4,
  },
  accountRowLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  accountRowValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  accountInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  accountHelpText: {
    fontSize: 12,
    lineHeight: 18,
  },
  accountSaveButton: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  accountSaveText: {
    fontSize: 14,
    fontWeight: '700',
  },
  aboutButton: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  aboutTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  aboutSubtitle: {
    fontSize: 12,
  },
  logoutButton: {
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 6,
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
