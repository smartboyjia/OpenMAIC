/**
 * Billing Guard — PPT Page Quota Edition
 *
 * Pre-flight: check user has at least 1 page quota before starting generation.
 * Commit: deduct actual pages generated after job completes.
 */

import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { getSessionFromCookie } from './auth';
import { getBalance, deductPages, InsufficientPagesError } from './service';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('BillingGuard');

export interface BillingGuardResult {
  error: NextResponse | null;
  userId: string | null;
  /** Call after generation completes with actual page count */
  commit: (pagesUsed: number, note?: string, refId?: string) => void;
}

export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED !== 'false';
}

/**
 * Create a billing guard for an API route.
 * Pre-flight requires at least `minPages` quota (default 1).
 */
export async function billingGuard(
  req: NextRequest,
  minPages = 1,
): Promise<BillingGuardResult> {
  const noop: BillingGuardResult = {
    error: null,
    userId: null,
    commit: () => {},
  };

  if (!isBillingEnabled()) return noop;

  const session = await getSessionFromCookie();
  if (!session) {
    return {
      error: apiError('UNAUTHORIZED', 401, '请先登录'),
      userId: null,
      commit: () => {},
    };
  }

  const userId = session.sub;
  const balance = getBalance(userId);

  if (balance < minPages) {
    log.warn(`User ${userId} balance=${balance} insufficient (need ${minPages})`);
    return {
      error: apiError(
        'INSUFFICIENT_TOKENS',
        402,
        '页数配额不足',
        `当前剩余 ${balance} 页，请充值后继续`,
      ),
      userId,
      commit: () => {},
    };
  }

  return {
    error: null,
    userId,
    commit: (pagesUsed: number, note?: string, refId?: string) => {
      if (pagesUsed <= 0) return;
      try {
        deductPages(userId, pagesUsed, note, refId);
        log.info(`Deducted ${pagesUsed} pages from user ${userId}, refId=${refId}`);
      } catch (e) {
        if (e instanceof InsufficientPagesError) {
          // Drain remaining balance
          const remaining = getBalance(userId);
          if (remaining > 0) deductPages(userId, remaining, note, refId);
          log.warn(`User ${userId} over-spent; drained ${remaining} pages`);
        } else {
          log.error(`Failed to deduct pages for user ${userId}:`, e);
        }
      }
    },
  };
}
