import axios, {
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const API_BASE_OVERRIDE_KEY = 'xandoraApiBaseUrl';
const DEFAULT_HOST = '127.0.0.1';
export const DEV_LOCAL_API_BASE_URL = `http://${DEFAULT_HOST}:3000/api/v1`;
export const HOSTED_RENDER_API_BASE_URL = 'https://xandorabackend-44dt.onrender.com/api/v1';
export const DEFAULT_API_BASE_URL =
  __DEV__ && Platform.OS === 'android'
    ? HOSTED_RENDER_API_BASE_URL
    : __DEV__
      ? DEV_LOCAL_API_BASE_URL
      : HOSTED_RENDER_API_BASE_URL;
export const ANDROID_LOCALHOST_API_BASE_URL = 'http://127.0.0.1:3000/api/v1';
export const ANDROID_EMULATOR_API_BASE_URL = 'http://10.0.2.2:3000/api/v1';

function isLocalOnlyApiBaseUrl(value: string | null | undefined): boolean {
  return /127\.0\.0\.1:3000|10\.0\.2\.2:3000/i.test(String(value || ''));
}

function withProtocol(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const useHttp = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|.+:\d+)$/i.test(
    trimmed,
  );

  return `${useHttp ? 'http' : 'https'}://${trimmed}`;
}

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = withProtocol(value).replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE_URL;
  if (/\/api\/v1$/i.test(trimmed)) return trimmed;
  if (/\/api$/i.test(trimmed)) return `${trimmed}/v1`;
  return `${trimmed}/api/v1`;
}

function toHealthUrl(baseUrl: string): string {
  return normalizeApiBaseUrl(baseUrl).replace(/\/api\/v1$/i, '/api/health/live');
}

const api: AxiosInstance = axios.create({
  baseURL: DEFAULT_API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

function shouldRetryViaLocalFallback(error: any): boolean {
  return (
    Platform.OS === 'android' &&
    !error?.response &&
    /network error/i.test(String(error?.message || ''))
  );
}

function getAndroidFallbackBaseUrl(currentBaseUrl?: string | null): string | null {
  const normalized = String(currentBaseUrl || '').trim();

  if (!normalized) {
    return HOSTED_RENDER_API_BASE_URL;
  }

  if (normalized.includes('127.0.0.1:3000')) {
    return HOSTED_RENDER_API_BASE_URL;
  }

  if (normalized.includes('10.0.2.2:3000')) {
    return HOSTED_RENDER_API_BASE_URL;
  }

  return null;
}

async function getStoredApiBaseOverride(): Promise<string | null> {
  const storedValue = await AsyncStorage.getItem(API_BASE_OVERRIDE_KEY);
  if (!storedValue) {
    return null;
  }

  const normalized = normalizeApiBaseUrl(storedValue);
  if (!__DEV__ && isLocalOnlyApiBaseUrl(normalized)) {
    await AsyncStorage.removeItem(API_BASE_OVERRIDE_KEY);
    return null;
  }

  return normalized;
}

api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const [token, apiBaseOverride] = await Promise.all([
      AsyncStorage.getItem('authToken'),
      getStoredApiBaseOverride(),
    ]);

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (apiBaseOverride) {
      config.baseURL = apiBaseOverride;
    }

    return config;
  },
  error => Promise.reject(error),
);

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const config = error?.config as
      | (InternalAxiosRequestConfig & { __xandoraLocalhostRetry?: boolean })
      | undefined;

    if (!config || config.__xandoraLocalhostRetry || !shouldRetryViaLocalFallback(error)) {
      return Promise.reject(error);
    }

    const apiBaseOverride = await getStoredApiBaseOverride();
    const fallbackBaseUrl = getAndroidFallbackBaseUrl(config.baseURL);

    if (apiBaseOverride || !fallbackBaseUrl || fallbackBaseUrl === config.baseURL) {
      return Promise.reject(error);
    }

    config.__xandoraLocalhostRetry = true;
    config.baseURL = fallbackBaseUrl;
    return api.request(config);
  },
);

export async function setApiBaseUrl(value: string): Promise<void> {
  await AsyncStorage.setItem(API_BASE_OVERRIDE_KEY, normalizeApiBaseUrl(value));
}

export async function clearApiBaseUrl(): Promise<void> {
  await AsyncStorage.removeItem(API_BASE_OVERRIDE_KEY);
}

export async function getConfiguredApiBaseUrl(): Promise<string> {
  const storedValue = await getStoredApiBaseOverride();
  return storedValue || DEFAULT_API_BASE_URL;
}

export async function getStoredApiBaseUrl(): Promise<string | null> {
  return getStoredApiBaseOverride();
}

export async function testApiBaseUrl(value: string): Promise<{
  ok: boolean;
  apiBaseUrl: string;
  healthUrl: string;
}> {
  const apiBaseUrl = normalizeApiBaseUrl(value);
  const healthUrl = toHealthUrl(apiBaseUrl);

  await axios.get(healthUrl, {
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return {
    ok: true,
    apiBaseUrl,
    healthUrl,
  };
}

export default api;
