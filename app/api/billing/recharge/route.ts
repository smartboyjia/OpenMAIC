/**
 * GET  /api/billing/recharge        — 套餐列表
 * POST /api/billing/recharge        — 创建订单 + 返回支付二维码
 * GET  /api/billing/recharge/status — 轮询支付状态
 */

import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  requireAuth,
  createRechargeTransaction,
  markTransactionPaid,
  PACKAGES,
} from '@/lib/billing';
import { createAlipayQRCode, queryAlipayOrder } from '@/lib/billing/payment';

// 是否已配置支付宝
function isAlipayConfigured(): boolean {
  return !!(
    process.env.ALIPAY_APP_ID &&
    process.env.ALIPAY_PRIVATE_KEY &&
    process.env.ALIPAY_PUBLIC_KEY
  );
}

// ── GET /api/billing/recharge ────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  // 轮询支付状态
  if (action === 'status') {
    try {
      const session = await requireAuth();
      const txId = searchParams.get('txId');
      if (!txId) return apiError('MISSING_REQUIRED_FIELD', 400, '缺少 txId');

      if (!isAlipayConfigured()) {
        return apiError('INVALID_REQUEST', 400, '支付宝未配置');
      }

      const result = await queryAlipayOrder(txId);
      if (result.paid) {
        markTransactionPaid(txId, result.tradeNo);
      }
      return apiSuccess({ paid: result.paid, tradeStatus: result.tradeStatus, userId: session.sub });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (msg === 'Unauthorized') return apiError('UNAUTHORIZED', 401, '请先登录');
      return apiError('INTERNAL_ERROR', 500, '查询失败', msg);
    }
  }

  // 套餐列表
  return apiSuccess({
    packages: PACKAGES,
    alipayEnabled: isAlipayConfigured(),
  });
}

// ── POST /api/billing/recharge ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await req.json();
    const { packageId, paymentMethod = 'alipay' } = body;

    const pkg = PACKAGES.find((p) => p.id === packageId);
    if (!pkg) return apiError('INVALID_REQUEST', 400, `未知套餐: ${packageId}`);

    const tx = createRechargeTransaction(session.sub, pkg.amountFen, paymentMethod);

    // DEV 模式: ?confirm=1 直接到账（用于本地测试）
    const url = new URL(req.url);
    if (url.searchParams.get('confirm') === '1' && process.env.NODE_ENV !== 'production') {
      const paid = markTransactionPaid(tx.id, 'dev-auto-confirm');
      return apiSuccess({ transaction: paid, autoConfirmed: true, pagesAdded: pkg.pages });
    }

    // 生产/沙箱：调用支付宝生成二维码
    if (!isAlipayConfigured()) {
      return apiSuccess({
        transaction: tx,
        qrCode: null,
        notice:
          '支付宝暂未配置，请联系管理员。如需测试，请用 ?confirm=1 参数（仅开发环境）。',
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `https://${req.headers.get('host')}`;
    const { qrCode } = await createAlipayQRCode({
      outTradeNo: tx.id,
      amountFen: pkg.amountFen,
      subject: `OpenMAIC ${pkg.label} (${pkg.pages}页)`,
    });

    return apiSuccess({
      transaction: tx,
      qrCode,
      expireSeconds: 120, // 二维码有效期
      pollUrl: `${baseUrl}/api/billing/recharge?action=status&txId=${tx.id}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('UNAUTHORIZED', 401, '请先登录');
    return apiError('INTERNAL_ERROR', 500, '创建订单失败', msg);
  }
}
