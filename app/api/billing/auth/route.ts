/**
 * POST /api/billing/auth?action=register
 * POST /api/billing/auth?action=login
 * POST /api/billing/auth?action=logout
 */

import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limiter';
import {
  registerUser,
  loginUser,
  setAuthCookie,
  clearAuthCookie,
} from '@/lib/billing';

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action') ?? 'login';
  const ip = getClientIp(req);

  try {
    if (action === 'register') {
      // 限流：同一 IP 10 分钟内最多注册 3 次
      const rl = checkRateLimit('register', ip);
      if (!rl.allowed) {
        return apiError('RATE_LIMITED', 429, rl.message ?? '请求过于频繁，请稍后重试');
      }

      const { email, password, referralCode } = await req.json();
      if (!email || !password) {
        return apiError('MISSING_REQUIRED_FIELD', 400, 'email and password are required');
      }
      if (password.length < 8) {
        return apiError('INVALID_REQUEST', 400, 'Password must be at least 8 characters');
      }
      const user = await registerUser(email, password, referralCode?.trim() || undefined);
      return apiSuccess({
        message: 'Registered successfully',
        userId: user.id,
        email: user.email,
        referralBonus: user.referralBonus ?? 0,
      });
    }

    if (action === 'login') {
      // 限流：同一 IP 5 分钟内最多尝试 10 次（防暴力破解）
      const rl = checkRateLimit('login', ip);
      if (!rl.allowed) {
        return apiError('RATE_LIMITED', 429, rl.message ?? '请求过于频繁，请稍后重试');
      }

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
