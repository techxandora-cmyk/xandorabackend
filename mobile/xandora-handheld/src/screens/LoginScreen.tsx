import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BrandMark from '../components/BrandMark';
import {
  clearApiBaseUrl,
  getConfiguredApiBaseUrl,
  getStoredApiBaseUrl,
  setApiBaseUrl,
  testApiBaseUrl,
} from '../services/api';
import {
  DEFAULT_PRODUCT_KEY,
  getSoftwareOption,
  isMobileProductKey,
  MobileProductKey,
  SOFTWARE_OPTIONS,
} from '../config/softwareModules';
import { useAppTheme } from '../context/ThemeContext';
import { loginApi } from '../services/authService';
import { brand } from '../theme/brand';

const LAST_PRODUCT_KEY = 'xandora_mobile_last_product_key';
const SAVED_CREDENTIALS_KEY = 'xandora_mobile_saved_credentials';
const HANDHELD_ACCENT = brand.colors.blue;
const MODULE_SURFACE_LIGHT = '#F4F9FF';
const MODULE_SURFACE_DARK = '#14253A';

const MODULE_ACCENTS: Record<
  MobileProductKey,
  { tint: string; softTint: string; lightSurface: string; darkSurface: string }
> = {
  retail: {
    tint: HANDHELD_ACCENT,
    softTint: 'rgba(65,142,218,0.14)',
    lightSurface: MODULE_SURFACE_LIGHT,
    darkSurface: MODULE_SURFACE_DARK,
  },
  laundry: {
    tint: HANDHELD_ACCENT,
    softTint: 'rgba(65,142,218,0.14)',
    lightSurface: MODULE_SURFACE_LIGHT,
    darkSurface: MODULE_SURFACE_DARK,
  },
  stock_audit: {
    tint: HANDHELD_ACCENT,
    softTint: 'rgba(65,142,218,0.14)',
    lightSurface: MODULE_SURFACE_LIGHT,
    darkSurface: MODULE_SURFACE_DARK,
  },
};

export default function LoginScreen({ navigation }: any) {
  const { theme, mode } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [productKey, setProductKey] = useState<MobileProductKey>(DEFAULT_PRODUCT_KEY);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverInput, setServerInput] = useState('');
  const [resolvedServer, setResolvedServer] = useState('');
  const [serverStatus, setServerStatus] = useState('');
  const [serverStatusKind, setServerStatusKind] = useState<'neutral' | 'success' | 'error'>(
    'neutral',
  );
  const [serverSubmitting, setServerSubmitting] = useState(false);
  const isCompactScreen = width < 390 || height < 820;
  const showServerStatusPanel = showServerSettings || serverStatusKind !== 'neutral';

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(LAST_PRODUCT_KEY), AsyncStorage.getItem(SAVED_CREDENTIALS_KEY), getStoredApiBaseUrl(), getConfiguredApiBaseUrl()])
      .then(([storedValue, savedCredentials, storedApiBaseUrl, configuredApiBaseUrl]) => {
        if (isMobileProductKey(storedValue)) {
          setProductKey(storedValue);
        }

        if (savedCredentials) {
          try {
            const creds = JSON.parse(savedCredentials);
            if (creds?.email) setEmail(creds.email);
            if (creds?.password) setPassword(creds.password);
            setRememberMe(true);
          } catch {}
        }

        const isLocalDemoServer =
          /127\.0\.0\.1:3000|10\.0\.2\.2:3000/i.test(String(configuredApiBaseUrl || ''));
        const isHostedRenderServer = /onrender\.com/i.test(String(configuredApiBaseUrl || ''));

        setServerInput(storedApiBaseUrl || configuredApiBaseUrl);
        setResolvedServer(configuredApiBaseUrl);
        setServerStatus(
          storedApiBaseUrl
            ? `Using saved server ${storedApiBaseUrl}`
            : isLocalDemoServer
            ? `Using local demo server ${configuredApiBaseUrl}`
            : isHostedRenderServer
            ? `Using hosted Render server ${configuredApiBaseUrl}`
            : __DEV__
            ? `Using local dev server ${configuredApiBaseUrl}`
            : 'Set your public API server before signing in on another network.',
        );
        setServerStatusKind(
          storedApiBaseUrl || __DEV__ || isLocalDemoServer || isHostedRenderServer
            ? 'neutral'
            : 'error',
        );
      })
      .catch(() => {});
  }, []);

  const selectedProduct = useMemo(
    () => getSoftwareOption(productKey),
    [productKey],
  );
  const selectedAccent = MODULE_ACCENTS[productKey];

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Enter email and password');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const session = await loginApi(email, password, productKey);
      await AsyncStorage.setItem(LAST_PRODUCT_KEY, productKey);
      if (rememberMe) {
        await AsyncStorage.setItem(SAVED_CREDENTIALS_KEY, JSON.stringify({ email, password }));
      } else {
        await AsyncStorage.removeItem(SAVED_CREDENTIALS_KEY);
      }
      navigation.replace('Home', {
        username: session.displayName,
      });
    } catch (loginError: any) {
      const status = Number(loginError?.response?.status || loginError?.status || 0);
      const transportFailure =
        !loginError?.response && /network error|timeout/i.test(String(loginError?.message || ''));
      const message = loginError?.response?.data?.error
        || (status === 401
          ? 'Invalid email or password'
          : status === 403
          ? 'This account is not allowed to open that module'
          : status === 400
          ? 'Check the selected software'
          : transportFailure
          ? 'Could not reach the API server. Open API Server, tap Reset, and try again.'
          : loginError?.message
          ? String(loginError.message)
          : 'Login failed');

      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const selectProduct = (nextProductKey: MobileProductKey) => {
    setProductKey(nextProductKey);
    setShowForm(true);
    setError('');
  };

  const goBackToModules = () => {
    setShowForm(false);
    setError('');
  };

  const handleSaveServer = async () => {
    if (!serverInput.trim()) {
      setServerStatus('Enter the API server URL first.');
      setServerStatusKind('error');
      return;
    }

    setServerSubmitting(true);
    setServerStatus('Testing server...');
    setServerStatusKind('neutral');

    try {
      const result = await testApiBaseUrl(serverInput);
      await setApiBaseUrl(serverInput);
      setResolvedServer(result.apiBaseUrl);
      setServerInput(result.apiBaseUrl);
      setServerStatus(`Server saved and reachable: ${result.apiBaseUrl}`);
      setServerStatusKind('success');
    } catch (serverError: any) {
      setServerStatus(
        serverError?.response?.data?.error ||
          serverError?.message ||
          'Could not reach that server.',
      );
      setServerStatusKind('error');
    } finally {
      setServerSubmitting(false);
    }
  };

  const handleResetServer = async () => {
    setServerSubmitting(true);

    try {
      await clearApiBaseUrl();
      const configuredApiBaseUrl = await getConfiguredApiBaseUrl();
      setResolvedServer(configuredApiBaseUrl);
      setServerInput(configuredApiBaseUrl);
      setServerStatus(
        __DEV__
          ? `Reset to local dev server ${configuredApiBaseUrl}`
          : /onrender\.com/i.test(String(configuredApiBaseUrl || ''))
          ? `Reset to hosted Render server ${configuredApiBaseUrl}`
          : 'Server reset. Set your public API server before using this APK outside the local environment.',
      );
      setServerStatusKind(
        __DEV__ || /onrender\.com/i.test(String(configuredApiBaseUrl || ''))
          ? 'neutral'
          : 'error',
      );
    } finally {
      setServerSubmitting(false);
    }
  };

  const serverStatusTone =
    serverStatusKind === 'success'
      ? {
          backgroundColor: '#DCFCE7',
          borderColor: '#86EFAC',
          textColor: '#166534',
        }
      : serverStatusKind === 'error'
      ? {
          backgroundColor: '#FEE2E2',
          borderColor: '#FCA5A5',
          textColor: '#991B1B',
        }
      : {
          backgroundColor: theme.surfaceAlt,
          borderColor: theme.border,
          textColor: theme.textMuted,
        };

  const serverSettingsBlock = (
    <View
      style={[
        styles.serverCard,
        {
          backgroundColor: theme.surfaceAlt,
          borderColor: theme.border,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.serverHeader}
        onPress={() => setShowServerSettings(value => !value)}
      >
        <View style={styles.serverHeaderCopy}>
          <Text style={[styles.serverLabel, { color: theme.textMuted }]}>API Server</Text>
          <Text style={[styles.serverValue, { color: theme.text }]} numberOfLines={1}>
            {resolvedServer || 'Not configured'}
          </Text>
        </View>
        <Text style={[styles.serverToggleText, { color: theme.textMuted }]}>
          {showServerSettings ? 'Hide' : 'Change'}
        </Text>
      </TouchableOpacity>

      {showServerSettings ? (
        <View style={styles.serverBody}>
          <Text style={[styles.serverHint, { color: theme.textMuted }]}>
            Use your public API domain here if you want to override the default hosted Render
            backend. Example: xandorabackend-44dt.onrender.com
          </Text>
          <TextInput
            placeholder="https://xandorabackend-44dt.onrender.com"
            placeholderTextColor={theme.textMuted}
            style={[
              styles.serverInput,
              {
                borderColor: theme.border,
                color: theme.text,
                backgroundColor: theme.surface,
              },
            ]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={serverInput}
            onChangeText={setServerInput}
          />

          <View style={styles.serverActionRow}>
            <TouchableOpacity
              style={[
                styles.serverPrimaryButton,
                {
                  backgroundColor: serverSubmitting ? theme.surfaceStrong : theme.primary,
                },
              ]}
              onPress={handleSaveServer}
              disabled={serverSubmitting}
            >
              <Text style={styles.serverPrimaryButtonText}>
                {serverSubmitting ? 'Saving...' : 'Test & Save'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.serverSecondaryButton,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
              onPress={handleResetServer}
              disabled={serverSubmitting}
            >
              <Text style={[styles.serverSecondaryButtonText, { color: theme.text }]}>
                Reset
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {showServerStatusPanel && serverStatus ? (
        <View
          style={[
            styles.serverStatusBox,
            {
              backgroundColor: serverStatusTone.backgroundColor,
              borderColor: serverStatusTone.borderColor,
            },
          ]}
        >
          <Text style={[styles.serverStatusText, { color: serverStatusTone.textColor }]}>
            {serverStatus}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.background }]}
      edges={['top', 'bottom']}
    >
      <ScrollView
        style={[styles.screen, { backgroundColor: theme.background }]}
        contentContainerStyle={[
          styles.screenContent,
          isCompactScreen && styles.screenContentCompact,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <View
        style={[
          styles.glowOne,
          {
            backgroundColor: selectedAccent.tint,
            opacity: mode === 'dark' ? 0.22 : 0.16,
          },
        ]}
      />
      <View
        style={[
          styles.glowTwo,
          {
            backgroundColor: brand.colors.violet,
            opacity: mode === 'dark' ? 0.18 : 0.12,
          },
        ]}
      />
      <View
        style={[
          styles.glowThree,
          {
            backgroundColor: brand.colors.blue,
            opacity: mode === 'dark' ? 0.16 : 0.12,
          },
        ]}
      />

      <View
        style={[
          styles.card,
          isCompactScreen && styles.cardCompact,
          {
            backgroundColor: mode === 'dark' ? theme.cardDark : theme.surfaceRaised,
            borderColor: mode === 'dark' ? theme.cardDarkBorder : theme.accentSoft,
            shadowColor: theme.shadow,
          },
        ]}
      >
        {showForm ? (
          <View>
            <TouchableOpacity
              style={[
                styles.backButton,
                {
                  borderColor: selectedAccent.softTint,
                  backgroundColor: mode === 'dark' ? theme.surfaceAlt : theme.surfaceAlt,
                },
              ]}
              onPress={goBackToModules}
            >
              <Text style={[styles.backButtonText, { color: theme.primary }]}>
                {'\u2190'} Back to modules
              </Text>
            </TouchableOpacity>

            <View style={styles.brandWrapCompact}>
              <BrandMark
                size={isCompactScreen ? 'xs' : 'sm'}
                light={mode === 'dark'}
                subtitle={false}
              />
            </View>

            <View style={[styles.stepChip, { backgroundColor: selectedAccent.softTint }]}>
              <Text style={[styles.stepChipText, { color: selectedAccent.tint }]}>Step 2</Text>
            </View>

            <Text style={[styles.title, isCompactScreen && styles.titleCompact, { color: theme.text }]}>
              Sign in to {selectedProduct.label}
            </Text>
            <Text style={[styles.subtitle, isCompactScreen && styles.subtitleCompact, { color: theme.textMuted }]}>
              {selectedProduct.summary}
            </Text>

            <View
              style={[
                styles.selectedPanel,
                {
                  backgroundColor: mode === 'dark' ? theme.surfaceAlt : selectedAccent.softTint,
                  borderColor: mode === 'dark' ? theme.border : selectedAccent.softTint,
                },
              ]}
            >
              <Text style={[styles.selectedPanelKicker, { color: selectedAccent.tint }]}>
                {selectedProduct.kicker}
              </Text>
              <Text style={[styles.selectedPanelHelper, { color: theme.textMuted }]}>
                {selectedProduct.helper}
              </Text>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Email</Text>
            <TextInput
              placeholder="admin@company.com"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.surfaceAlt,
                },
              ]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (error) setError('');
              }}
            />

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Password</Text>
            <TextInput
              placeholder="Enter password"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.surfaceAlt,
                },
              ]}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                if (error) setError('');
              }}
            />

            <View style={styles.showRow}>
              <TouchableOpacity
                style={[styles.checkbox, { borderColor: theme.accent }]}
                onPress={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <View style={[styles.checked, { backgroundColor: theme.accent }]} />
                ) : null}
              </TouchableOpacity>
              <Text style={[styles.showText, { color: theme.textMuted }]}>
                Show password
              </Text>
              <TouchableOpacity
                style={[styles.checkbox, { borderColor: theme.accent, marginLeft: 18 }]}
                onPress={() => setRememberMe(!rememberMe)}
              >
                {rememberMe ? (
                  <View style={[styles.checked, { backgroundColor: theme.accent }]} />
                ) : null}
              </TouchableOpacity>
              <Text style={[styles.showText, { color: theme.textMuted }]}>
                Remember me
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.loginBtn,
                {
                  backgroundColor: submitting ? theme.surfaceStrong : selectedAccent.tint,
                },
              ]}
              disabled={submitting}
              onPress={handleLogin}
            >
              <Text style={styles.loginText}>
                {submitting ? 'Logging in...' : `Open ${selectedProduct.shortLabel}`}
              </Text>
            </TouchableOpacity>

            <Text style={[styles.footnote, { color: theme.textMuted }]}>
              Access only works if this software is assigned to the customer and user account.
            </Text>

            {serverSettingsBlock}
          </View>
        ) : (
          <View>
            <View style={styles.brandWrap}>
              <BrandMark
                size={isCompactScreen ? 'sm' : 'md'}
                light={mode === 'dark'}
                subtitle={false}
              />
            </View>

            <View style={[styles.stepChip, { backgroundColor: selectedAccent.softTint }]}>
              <Text style={[styles.stepChipText, { color: selectedAccent.tint }]}>Step 1</Text>
            </View>

            <Text style={[styles.title, isCompactScreen && styles.titleCompact, { color: theme.text }]}>
              Select your workspace
            </Text>
            <Text style={[styles.subtitle, isCompactScreen && styles.subtitleCompact, { color: theme.textMuted }]}>
              Choose the Xandora module first, then continue into the right sign-in flow.
            </Text>

            <View style={[styles.moduleList, isCompactScreen && styles.moduleListCompact]}>
              {SOFTWARE_OPTIONS.map((option) => {
                const active = option.value === productKey;
                const accent = MODULE_ACCENTS[option.value];
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.moduleCard,
                      isCompactScreen && styles.moduleCardCompact,
                      {
                        backgroundColor: active
                          ? mode === 'dark'
                            ? accent.darkSurface
                            : accent.lightSurface
                          : mode === 'dark'
                          ? theme.surfaceAlt
                          : theme.surfaceRaised,
                        borderColor: active ? accent.tint : theme.border,
                        shadowColor: active ? accent.tint : theme.shadow,
                      },
                    ]}
                    onPress={() => selectProduct(option.value)}
                  >
                    <View style={styles.moduleCardTop}>
                      <View style={styles.moduleCardCopy}>
                        <Text
                          style={[
                            styles.moduleKicker,
                            {
                              color: active && mode === 'dark' ? '#DDFBFF' : accent.tint,
                            },
                          ]}
                        >
                          {option.kicker}
                        </Text>

                        <Text
                          style={[
                            styles.moduleTitle,
                            { color: theme.text },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.moduleStatePill,
                          {
                            backgroundColor: active
                              ? mode === 'dark'
                                ? 'rgba(255,255,255,0.10)'
                                : theme.surfaceRaised
                              : theme.surfaceAlt,
                            borderColor: active
                              ? mode === 'dark'
                                ? 'rgba(255,255,255,0.16)'
                                : accent.softTint
                              : theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.moduleStateText,
                            {
                              color: active && mode === 'dark' ? '#FFFFFF' : theme.textMuted,
                            },
                          ]}
                        >
                          {active ? 'Selected' : 'Ready'}
                        </Text>
                      </View>
                    </View>

                    <Text
                      style={[
                        styles.moduleSummary,
                        isCompactScreen && styles.moduleSummaryCompact,
                        {
                          color:
                            active && mode === 'dark'
                              ? 'rgba(255,255,255,0.78)'
                              : theme.textMuted,
                        },
                      ]}
                    >
                      {option.summary}
                    </Text>

                    {!isCompactScreen ? (
                      <Text
                        style={[
                          styles.moduleHelper,
                          {
                            color:
                              active && mode === 'dark'
                                ? 'rgba(255,255,255,0.52)'
                                : theme.textMuted,
                          },
                        ]}
                      >
                        {option.helper}
                      </Text>
                    ) : null}

                    <View style={styles.moduleFooter}>
                      <View
                        style={[
                          styles.moduleActionPill,
                          {
                            backgroundColor: active
                              ? mode === 'dark'
                                ? 'rgba(255,255,255,0.10)'
                                : theme.surfaceRaised
                              : mode === 'dark'
                              ? theme.surfaceRaised
                              : theme.surfaceAlt,
                            borderColor: active
                              ? mode === 'dark'
                                ? 'rgba(255,255,255,0.12)'
                                : accent.softTint
                              : theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.moduleActionText,
                            { color: theme.text },
                          ]}
                        >
                          {active ? `Continue to ${option.shortLabel}` : 'Open module'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {serverSettingsBlock}
          </View>
        )}
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  screenContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  screenContentCompact: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 20,
  },
  glowOne: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    top: 70,
    left: 16,
  },
  glowTwo: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    bottom: 70,
    right: 8,
  },
  glowThree: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    top: 240,
    right: 34,
  },
  card: {
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  cardCompact: {
    borderRadius: 24,
    padding: 16,
  },
  brandWrap: {
    marginBottom: 22,
    alignItems: 'center',
  },
  brandWrapCompact: {
    alignItems: 'center',
    marginBottom: 18,
  },
  stepChip: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 14,
  },
  stepChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  titleCompact: {
    fontSize: 22,
    marginBottom: 8,
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  subtitleCompact: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  moduleList: {
    gap: 12,
  },
  moduleListCompact: {
    gap: 10,
  },
  moduleCard: {
    position: 'relative',
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  moduleCardCompact: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  moduleCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  moduleCardCopy: {
    flex: 1,
    paddingRight: 12,
  },
  moduleKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.72,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  moduleStatePill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  moduleStateText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  moduleTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  moduleSummary: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 10,
  },
  moduleSummaryCompact: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  moduleHelper: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },
  moduleFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  moduleActionPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  moduleActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  backButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 18,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  selectedPanel: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 18,
  },
  selectedPanelKicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  selectedPanelHelper: {
    fontSize: 13,
    lineHeight: 19,
  },
  errorBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.34)',
    backgroundColor: 'rgba(220,38,38,0.10)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    lineHeight: 19,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
    fontSize: 15,
  },
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checked: {
    width: 12,
    height: 12,
  },
  showText: {
    fontSize: 13,
  },
  loginBtn: {
    paddingVertical: 16,
    borderRadius: 16,
  },
  loginText: {
    color: '#FFFFFF',
    fontWeight: '700',
    textAlign: 'center',
    fontSize: 15,
  },
  footnote: {
    textAlign: 'center',
    marginTop: 14,
    fontSize: 11,
    lineHeight: 18,
  },
  serverCard: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 18,
  },
  serverHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  serverHeaderCopy: {
    flex: 1,
  },
  serverLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  serverValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  serverToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  serverBody: {
    marginTop: 14,
  },
  serverHint: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  serverInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  serverActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  serverPrimaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  serverSecondaryButton: {
    minWidth: 92,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverSecondaryButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  serverStatusBox: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  serverStatusText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
});
