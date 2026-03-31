/**
 * In-process rate limiter for auth endpoints.
 *
 * Uses a simple sliding-window counter stored in memory (Map).
 * Resets on process restart — acceptable for this use case.
 * For multi-instance deployments, swap the store with Redis.
 *
 * Usage:
 *   const result = authRateLimiter.check('register', ip);
 *   if (!result.allowed) return apiError('RATE_LIMITED', 429, result.message);
 */

interface Window {
  count: number;
  resetAt: number; // unix ms
}

interface LimitConfig {
  maxRequests: number;
  windowMs: number;
  message: string;
}

const LIMITS: Record<string, LimitConfig> = {
  register: {
    maxRequests: parseInt(process.env.RATE_LIMIT_REGISTER_MAX ?? '3', 10),
    windowMs:    parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW_MS ?? String(10 * 60 * 1000), 10), // 10 min
    message: '注册太频繁，请 10 分钟后重试',
  },
  login: {
    maxRequests: parseInt(process.env.RATE_LIMIT_LOGIN_MAX ?? '10', 10),
    windowMs:    parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS ?? String(5 * 60 * 1000), 10), // 5 min
    message: '登录尝试过于频繁，请 5 分钟后重试',
  },
};

// key: `${action}:${ip}`
const store = new Map<string, Window>();

// Periodically clean up expired entries (every 5 min)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, win] of store.entries()) {
      if (win.resetAt < now) store.delete(key);
    }
  }, 5 * 60 * 1000);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // unix ms
  message?: string;
}

export function checkRateLimit(action: 'register' | 'login', ip: string): RateLimitResult {
  const config = LIMITS[action];
  if (!config) return { allowed: true, remaining: 999, resetAt: 0 };

  const key = `${action}:${ip}`;
  const now = Date.now();
  let win = store.get(key);

  // 窗口过期 → 重置
  if (!win || win.resetAt < now) {
    win = { count: 0, resetAt: now + config.windowMs };
    store.set(key, win);
  }

  win.count++;

  const allowed = win.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - win.count);

  return {
    allowed,
    remaining,
    resetAt: win.resetAt,
    message: allowed ? undefined : config.message,
  };
}

/**
 * Extract client IP from Next.js request headers.
 * Respects X-Forwarded-For (set by reverse proxies / Vercel / Cloudflare).
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}
