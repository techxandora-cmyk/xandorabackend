/* eslint-disable no-bitwise */
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_TOKEN_KEY = 'authToken';
const AUTH_USER_KEY = 'authUser';
const CURRENT_STORE_ID_KEY = 'currentStoreId';
const SAVED_USER_KEY = 'savedUser';
const LOGGED_IN_USER_KEY = 'loggedInUser';
const LOCAL_DISPLAY_NAMES_KEY = 'localDisplayNames';

const PERMISSION_ALIASES: Record<string, string[]> = {
  'handheld.scan': ['handheld.scan_items', 'handheld.scan'],
  'handheld.scan_items': ['handheld.scan_items', 'handheld.scan'],
  'handheld.inventory': ['handheld.inventory_count', 'handheld.inventory'],
  'handheld.inventory_count': ['handheld.inventory_count', 'handheld.inventory'],
  'handheld.laundry_scan': ['handheld.laundry_scan'],
  'handheld.audit': ['handheld.run_audits', 'handheld.audit'],
  'handheld.run_audits': ['handheld.run_audits', 'handheld.audit'],
};

export type AuthUser = {
  user_id: number | null;
  email: string | null;
  company_name: string | null;
  roles: string[];
  permissions: string[];
  product_key: string;
  store_ids: string[];
  default_store_id: string | null;
};

export type StoredSession = {
  token: string;
  user: AuthUser;
  displayName: string;
  currentStoreId: string | null;
};

function normalizeStoreId(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function uniqueStores(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => normalizeStoreId(value)).filter(Boolean)),
  );
}

function decodeBase64(input: string): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = String(input || '').replace(new RegExp('=+$'), '');
  let output = '';
  let bc = 0;
  let bs: number | undefined;
  let buffer = 0;
  let idx = 0;

  if (!str) {
    return '';
  }

  while ((buffer = str.charCodeAt(idx++))) {
    const value = chars.indexOf(String.fromCharCode(buffer));
    if (value < 0) {
      continue;
    }

    bs = bc % 4 ? (bs || 0) * 64 + value : value;
    if (bc++ % 4 && bs != null) {
      output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
  }

  return output;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const segment = String(token || '').split('.')[1] || '';
    if (!segment) return null;

    const normalized = segment
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(segment.length / 4) * 4, '=');

    return JSON.parse(decodeBase64(normalized));
  } catch {
    return null;
  }
}

export function formatDisplayName(email: string | null): string {
  const normalized = normalizeEmail(email);
  if (!normalized) return 'Operator';
  return normalized;
}

async function readLocalDisplayNames(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_DISPLAY_NAMES_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([email, name]) => [normalizeEmail(email), String(name || '').trim()])
        .filter(([email, name]) => Boolean(email) && Boolean(name)),
    );
  } catch {
    return {};
  }
}

export async function resolveDisplayName(email: string | null): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return 'Operator';
  }

  const localDisplayNames = await readLocalDisplayNames();
  return localDisplayNames[normalizedEmail] || normalizedEmail;
}

export async function saveLocalDisplayName(
  email: string | null,
  nextDisplayName: string,
): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('No email is available for this account');
  }

  const trimmedDisplayName = String(nextDisplayName || '').trim();
  const localDisplayNames = await readLocalDisplayNames();

  if (trimmedDisplayName) {
    localDisplayNames[normalizedEmail] = trimmedDisplayName;
  } else {
    delete localDisplayNames[normalizedEmail];
  }

  const resolvedDisplayName = localDisplayNames[normalizedEmail] || normalizedEmail;

  await AsyncStorage.multiSet([
    [LOCAL_DISPLAY_NAMES_KEY, JSON.stringify(localDisplayNames)],
    [LOGGED_IN_USER_KEY, resolvedDisplayName],
    [SAVED_USER_KEY, resolvedDisplayName],
  ]);

  return resolvedDisplayName;
}

export function buildUserFromToken(token: string): AuthUser | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const storeIds = uniqueStores(
    Array.isArray(payload.store_ids) ? payload.store_ids : [],
  );
  const defaultStoreId = normalizeStoreId(payload.default_store_id);
  if (defaultStoreId && !storeIds.includes(defaultStoreId)) {
    storeIds.unshift(defaultStoreId);
  }

  return {
    user_id:
      payload.user_id != null && Number.isFinite(Number(payload.user_id))
        ? Number(payload.user_id)
        : null,
    email: String(payload.email || '').trim().toLowerCase() || null,
    company_name: String(payload.company_name || '').trim() || null,
    roles: Array.isArray(payload.roles)
      ? payload.roles.map((role) => String(role || '').trim().toUpperCase()).filter(Boolean)
      : [],
    permissions: Array.isArray(payload.permissions)
      ? payload.permissions.map((perm) => String(perm || '').trim()).filter(Boolean)
      : [],
    product_key: String(payload.product_key || 'retail').trim().toLowerCase(),
    store_ids: storeIds,
    default_store_id: defaultStoreId || storeIds[0] || null,
  };
}

export async function saveAuthSession(token: string): Promise<StoredSession> {
  const user = buildUserFromToken(token);
  if (!user) {
    throw new Error('Invalid login response');
  }

  const currentStoreId = user.default_store_id || user.store_ids[0] || null;
  const displayName = await resolveDisplayName(user.email);

  await AsyncStorage.multiSet([
    [AUTH_TOKEN_KEY, token],
    [AUTH_USER_KEY, JSON.stringify(user)],
    [LOGGED_IN_USER_KEY, displayName],
    [SAVED_USER_KEY, displayName],
    [CURRENT_STORE_ID_KEY, currentStoreId || ''],
  ]);

  return {
    token,
    user,
    displayName,
    currentStoreId,
  };
}

export async function getAuthSession(): Promise<StoredSession | null> {
  const values = await AsyncStorage.multiGet([
    AUTH_TOKEN_KEY,
    AUTH_USER_KEY,
    CURRENT_STORE_ID_KEY,
  ]);

  const token = values.find(([key]) => key === AUTH_TOKEN_KEY)?.[1] || '';
  const storedUser = values.find(([key]) => key === AUTH_USER_KEY)?.[1] || '';
  const storedCurrentStoreId =
    values.find(([key]) => key === CURRENT_STORE_ID_KEY)?.[1] || '';

  if (!token) {
    return null;
  }

  let user: AuthUser | null = null;

  try {
    user = storedUser ? (JSON.parse(storedUser) as AuthUser) : null;
  } catch {
    user = null;
  }

  if (!user) {
    user = buildUserFromToken(token);
  }

  if (!user) {
    return null;
  }

  const currentStoreId =
    normalizeStoreId(storedCurrentStoreId) ||
    user.default_store_id ||
    user.store_ids[0] ||
    null;
  const displayName = await resolveDisplayName(user.email);

  return {
    token,
    user,
    displayName,
    currentStoreId,
  };
}

export async function clearAuthSession(): Promise<void> {
  await AsyncStorage.multiRemove([
    AUTH_TOKEN_KEY,
    AUTH_USER_KEY,
    CURRENT_STORE_ID_KEY,
    SAVED_USER_KEY,
    LOGGED_IN_USER_KEY,
  ]);
}

export async function getCurrentStoreId(): Promise<string | null> {
  const session = await getAuthSession();
  return session?.currentStoreId || null;
}

export async function setCurrentStoreId(storeId: string): Promise<void> {
  await AsyncStorage.setItem(CURRENT_STORE_ID_KEY, normalizeStoreId(storeId));
}

export function getAccessibleStores(user: AuthUser | null | undefined) {
  const stores = uniqueStores([
    ...(Array.isArray(user?.store_ids) ? user?.store_ids : []),
    user?.default_store_id || '',
  ]);

  return stores.map((id) => ({
    id,
    name: id,
  }));
}

function permissionAliases(permission: string): string[] {
  return PERMISSION_ALIASES[String(permission || '').trim()] || [];
}

export function hasPermission(
  user: AuthUser | null | undefined,
  permission: string,
): boolean {
  const permissions = Array.isArray(user?.permissions) ? user?.permissions : [];
  if (!permission) return false;
  if (permissions.includes('*')) return true;
  if (permissions.includes(permission)) return true;
  return permissionAliases(permission).some((alias) => permissions.includes(alias));
}
