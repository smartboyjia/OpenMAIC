/**
 * GET /api/billing/referral          — 查询当前用户的邀请码和统计
 * GET /api/billing/referral?validate=DECK-XXXXX — 验证邀请码是否有效（注册前调用）
 */

import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAuth } from '@/lib/billing';
import { getOrCreateUserReferralCode, getUserReferralStats, lookupReferralCode } from '@/lib/billing/referral';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const validateCode = searchParams.get('validate');

  // 验证邀请码（无需登录，注册页用）
  if (validateCode) {
    const referral = lookupReferralCode(validateCode);
    if (!referral) {
      return apiSuccess({ valid: false, message: '邀请码无效或已失效' });
    }
    return apiSuccess({
      valid: true,
      rewardPages: referral.reward_pages,
      message: `有效！使用后双方各得 ${referral.reward_pages} 页`,
    });
  }

  // 查询自己的邀请码和邀请统计（需要登录）
  try {
    const session = await requireAuth();
    const stats = getUserReferralStats(session.sub);

    return apiSuccess({
      code: stats.code.code,
      rewardPages: stats.code.reward_pages,
      useCount: stats.code.use_count,
      maxUses: stats.code.max_uses,
      totalPagesEarned: stats.totalPagesEarned,
      uses: stats.uses.map((u) => ({
        inviteeEmail: u.invitee_email.replace(/(.{2}).+(@.+)/, '$1***$2'), // 脱敏
        pagesGiven: u.pages_given,
        createdAt: u.created_at,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('UNAUTHORIZED', 401, '请先登录');
    return apiError('INTERNAL_ERROR', 500, '查询失败', msg);
  }
}
