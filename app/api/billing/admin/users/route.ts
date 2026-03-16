/**
 * Admin: List users with balance
 * GET /api/billing/admin/users
 */

import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin, listUsers, getBalance } from '@/lib/billing';

export async function GET() {
  try {
    await requireAdmin();
    const users = listUsers(100);
    const result = users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      balance: getBalance(u.id),
      createdAt: u.created_at,
    }));
    return apiSuccess({ users: result, total: result.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('MISSING_REQUIRED_FIELD' as never, 401, 'Unauthorized');
    if (msg === 'Forbidden') return apiError('MISSING_REQUIRED_FIELD' as never, 403, 'Forbidden');
    return apiError('INTERNAL_ERROR', 500, 'Failed', msg);
  }
}
