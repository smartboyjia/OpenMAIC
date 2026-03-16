/**
 * POST /api/billing/admin/gift
 * 管理员赠送 PPT 页数配额
 * Body: { userId, pages, note? }
 */

import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin, giftPages, getBalance, getUserById } from '@/lib/billing';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { userId, pages, note } = await req.json();

    if (!userId || !pages || pages <= 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'userId 和 pages（>0）为必填项');
    }

    const user = getUserById(userId);
    if (!user) return apiError('INVALID_REQUEST', 404, `用户 ${userId} 不存在`);

    giftPages(userId, pages, note ?? '管理员赠送', admin.sub);
    const newBalance = getBalance(userId);

    return apiSuccess({
      message: `已赠送 ${pages} 页给 ${user.email}`,
      userId,
      pagesGifted: pages,
      newBalance,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('UNAUTHORIZED', 401, '未登录');
    if (msg === 'Forbidden') return apiError('FORBIDDEN', 403, '无权限');
    return apiError('INTERNAL_ERROR', 500, '赠送失败', msg);
  }
}
