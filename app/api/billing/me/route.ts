/**
 * GET /api/billing/me
 * Returns current user info + token balance + recent ledger
 */

import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  requireAuth,
  getBalance,
  getLedger,
  getUserById,
} from '@/lib/billing';

export async function GET() {
  try {
    const session = await requireAuth();
    const user = getUserById(session.sub);
    if (!user) return apiError('INTERNAL_ERROR', 500, 'User not found');

    const balance = getBalance(session.sub);
    const ledger = getLedger(session.sub, 20);

    return apiSuccess({
      user: { id: user.id, email: user.email, role: user.role },
      balance,
      ledger,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('MISSING_REQUIRED_FIELD' as never, 401, 'Unauthorized');
    return apiError('INTERNAL_ERROR', 500, 'Failed to get profile', msg);
  }
}
