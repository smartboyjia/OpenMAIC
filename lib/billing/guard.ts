/**
 * Billing Middleware Guard
 *
 * Server-side helper to check token balance before allowing LLM calls.
 * Import this in any API route that consumes tokens.
 *
 * Usage:
 *   const guard = await billingGuard(req, estimatedTokens);
 *   if (guard.error) return guard.error;  // 402 / 401 response
 *   // ... do LLM call ...
 *   await guard.commit(actualTokensUsed);
 */

import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { getSessionFromCookie } from './auth';
import { getBalance, deductTokens, InsufficientTokensError } from './service';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('BillingGuard');

// Extend API_ERROR_CODES locally for billing-specific codes
// (we don't modify the original file to stay non-invasive)
const BILLING_ERROR = {
  UNAUTHORIZED: 'UNAUTHORIZED' as const,
  INSUFFICIENT_TOKENS: 'INSUFFICIENT_TOKENS' as const,
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED' as const,
};

export interface BillingGuardResult {
  /** Non-null means the request should be rejected with this response */
  error: NextResponse | null;
  /** User id if authenticated */
  userId: string | null;
  /** Commit actual token usage after the LLM call completes */
  commit: (tokensUsed: number, note?: string, refId?: string) => void;
}

/**
 * Minimum estimated token cost for a request.
 * Used for the pre-flight balance check (lightweight).
 * Set to 0 to skip the pre-flight and only deduct on commit.
 */
const DEFAULT_PREFLIGHT_TOKENS = 1000;

/**
 * Whether billing is enabled.
 * Set BILLING_ENABLED=false in .env to disable billing globally (dev mode).
 */
export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED !== 'false';
}

/**
 * Create a billing guard for an API route.
 *
 * @param req              - Incoming request (used to read auth cookie)
 * @param preflightTokens  - Estimated tokens to check upfront (default 1000)
 */
export async function billingGuard(
  req: NextRequest,
  preflightTokens = DEFAULT_PREFLIGHT_TOKENS,
): Promise<BillingGuardResult> {
  const noop: BillingGuardResult = {
    error: null,
    userId: null,
    commit: () => {},
  };

  // If billing is disabled globally, pass through
  if (!isBillingEnabled()) return noop;

  // Try to get session
  const session = await getSessionFromCookie();
  if (!session) {
    return {
      error: apiError('UNAUTHORIZED', 401, 'Authentication required'),
      userId: null,
      commit: () => {},
    };
  }

  const userId = session.sub;

  // Pre-flight balance check
  if (preflightTokens > 0) {
    const balance = getBalance(userId);
    if (balance < preflightTokens) {
      log.warn(`User ${userId} balance=${balance} insufficient for preflight=${preflightTokens}`);
      return {
        error: apiError(
          'INSUFFICIENT_TOKENS',
          402,
          'Insufficient tokens',
          `Balance: ${balance}, Required: ${preflightTokens}. Please recharge.`,
        ),
        userId,
        commit: () => {},
      };
    }
  }

  // Return guard with commit function
  return {
    error: null,
    userId,
    commit: (tokensUsed: number, note?: string, refId?: string) => {
      if (tokensUsed <= 0) return;
      try {
        deductTokens(userId, tokensUsed, note, refId);
        log.info(`Deducted ${tokensUsed} tokens from user ${userId}`);
      } catch (e) {
        if (e instanceof InsufficientTokensError) {
          // Balance went negative — deduct everything remaining (floor at 0)
          const balance = getBalance(userId);
          if (balance > 0) deductTokens(userId, balance, note, refId);
          log.warn(`User ${userId} over-spent; drained remaining ${balance} tokens`);
        } else {
          log.error(`Failed to deduct tokens for user ${userId}:`, e);
        }
      }
    },
  };
}
