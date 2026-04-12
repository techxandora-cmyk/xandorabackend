import api from './api';
import { DEFAULT_PRODUCT_KEY, MobileProductKey } from '../config/softwareModules';
import { saveAuthSession, StoredSession } from './session';

export interface LoginResponse extends StoredSession {}

export const loginApi = async (
  email: string,
  password: string,
  productKey: MobileProductKey = DEFAULT_PRODUCT_KEY,
): Promise<LoginResponse> => {
  const response = await api.post('/auth/login', {
    email: String(email || '').trim().toLowerCase(),
    password,
    product_key: productKey,
  });

  const token = String(response.data?.token || '').trim();
  if (!token) {
    throw new Error(response.data?.error || 'Invalid login response');
  }

  return saveAuthSession(token);
};
