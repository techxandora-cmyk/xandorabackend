import api, {
  clearApiBaseUrl,
  getStoredApiBaseUrl,
  HOSTED_RENDER_API_BASE_URL,
  normalizeApiBaseUrl,
  testApiBaseUrl,
} from './api';
import { DEFAULT_PRODUCT_KEY, MobileProductKey } from '../config/softwareModules';
import { saveAuthSession, StoredSession } from './session';

export interface LoginResponse extends StoredSession {}

function shouldRetryViaHostedServer(error: any): boolean {
  const message = String(error?.message || '');
  return !error?.response && /network error|timeout/i.test(message);
}

export const loginApi = async (
  email: string,
  password: string,
  productKey: MobileProductKey = DEFAULT_PRODUCT_KEY,
): Promise<LoginResponse> => {
  const payload = {
    email: String(email || '').trim().toLowerCase(),
    password,
    product_key: productKey,
  };

  const attemptLogin = () => api.post('/auth/login', payload);

  let response;

  try {
    response = await attemptLogin();
  } catch (error: any) {
    if (!shouldRetryViaHostedServer(error) || __DEV__) {
      throw error;
    }

    const storedOverride = await getStoredApiBaseUrl();
    const hostedApiBaseUrl = normalizeApiBaseUrl(HOSTED_RENDER_API_BASE_URL);

    if (!storedOverride || storedOverride === hostedApiBaseUrl) {
      throw error;
    }

    try {
      await testApiBaseUrl(hostedApiBaseUrl);
      await clearApiBaseUrl();
      response = await attemptLogin();
    } catch {
      throw error;
    }
  }

  const token = String(response.data?.token || '').trim();
  if (!token) {
    throw new Error(response.data?.error || 'Invalid login response');
  }

  return saveAuthSession(token);
};
