/**
 * GET /api/billing/transactions
 * List current user's transactions
 */

import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAuth, getTransactions } from '@/lib/billing';

export async function GET() {
  try {
    const session = await requireAuth();
    const txs = getTransactions(session.sub, 30);
    return apiSuccess({ transactions: txs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('UNAUTHORIZED', 401, 'Unauthorized');
    return apiError('INTERNAL_ERROR', 500, 'Failed', msg);
  }
}
