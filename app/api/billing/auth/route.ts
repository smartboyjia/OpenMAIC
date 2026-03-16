/**
 * POST /api/billing/auth/register
 * POST /api/billing/auth/login
 * POST /api/billing/auth/logout
 */

import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  registerUser,
  loginUser,
  setAuthCookie,
  clearAuthCookie,
} from '@/lib/billing';

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action') ?? 'login';

  try {
    if (action === 'register') {
      const { email, password } = await req.json();
      if (!email || !password) {
        return apiError('MISSING_REQUIRED_FIELD', 400, 'email and password are required');
      }
      if (password.length < 8) {
        return apiError('INVALID_REQUEST', 400, 'Password must be at least 8 characters');
      }
      const user = await registerUser(email, password);
      return apiSuccess({ message: 'Registered successfully', userId: user.id, email: user.email });
    }

    if (action === 'login') {
      const { email, password } = await req.json();
      if (!email || !password) {
        return apiError('MISSING_REQUIRED_FIELD', 400, 'email and password are required');
      }
      const { user, token } = await loginUser(email, password);
      await setAuthCookie(token);
      return apiSuccess({ message: 'Logged in', userId: user.id, email: user.email, role: user.role });
    }

    if (action === 'logout') {
      await clearAuthCookie();
      return apiSuccess({ message: 'Logged out' });
    }

    return apiError('INVALID_REQUEST', 400, `Unknown action: ${action}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Email already registered') return apiError('INVALID_REQUEST', 409, msg);
    if (msg === 'Invalid credentials') return apiError('INVALID_REQUEST', 401, msg);
    return apiError('INTERNAL_ERROR', 500, 'Auth failed', msg);
  }
}
