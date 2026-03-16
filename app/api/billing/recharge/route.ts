/**
 * GET  /api/billing/recharge  — 返回套餐列表
 * POST /api/billing/recharge  — 创建充值订单
 */

import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  requireAuth,
  createRechargeTransaction,
  markTransactionPaid,
  PACKAGES,
} from '@/lib/billing';

export async function GET() {
  return apiSuccess({ packages: PACKAGES });
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const { packageId, paymentMethod = 'manual' } = await req.json();

    const pkg = PACKAGES.find((p) => p.id === packageId);
    if (!pkg) return apiError('INVALID_REQUEST', 400, `未知套餐: ${packageId}`);

    const tx = createRechargeTransaction(session.sub, pkg.amountFen, paymentMethod);

    // DEV ONLY: auto-confirm with ?confirm=1
    const url = new URL(req.url);
    if (url.searchParams.get('confirm') === '1' && process.env.NODE_ENV !== 'production') {
      const paid = markTransactionPaid(tx.id, 'dev-auto-confirm');
      return apiSuccess({ transaction: paid, autoConfirmed: true });
    }

    return apiSuccess({
      transaction: tx,
      paymentHint:
        '接入支付宝/微信后，在此返回支付二维码。支付成功后回调 /api/billing/admin/transactions 确认到账。',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('UNAUTHORIZED', 401, '请先登录');
    return apiError('INTERNAL_ERROR', 500, '充值失败', msg);
  }
}
