/**
 * Admin: Gift tokens to a user
 * POST /api/billing/admin/gift
 * Body: { userId, tokens, note? }
 */

import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin, giftTokens, getBalance, getUserById } from '@/lib/billing';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { userId, tokens, note } = await req.json();

    if (!userId || !tokens || tokens <= 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'userId and tokens (>0) are required');
    }

    const user = getUserById(userId);
    if (!user) return apiError('INVALID_REQUEST', 404, `User ${userId} not found`);

    giftTokens(userId, tokens, note ?? `Admin gift`, admin.sub);
    const newBalance = getBalance(userId);

    return apiSuccess({
      message: `Gifted ${tokens} tokens to ${user.email}`,
      userId,
      tokensGifted: tokens,
      newBalance,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('UNAUTHORIZED', 401, 'Unauthorized');
    if (msg === 'Forbidden') return apiError('FORBIDDEN', 403, 'Forbidden');
    return apiError('INTERNAL_ERROR', 500, 'Gift failed', msg);
  }
}
