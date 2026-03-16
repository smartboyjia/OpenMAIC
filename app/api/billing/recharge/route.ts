/**
 * POST /api/billing/recharge
 * Create a recharge order.
 *
 * In production, integrate your payment gateway here and call
 * markTransactionPaid(txId) in your payment callback webhook.
 *
 * For demo/testing: pass ?confirm=1 to immediately mark as paid (dev only).
 */

import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  requireAuth,
  createRechargeTransaction,
  markTransactionPaid,
  TOKEN_PER_CNY,
} from '@/lib/billing';

/** Recharge packages (amount in 分, tokens calculated automatically) */
const PACKAGES = [
  { id: 'pkg_10', label: '10元', amountFen: 1000 },
  { id: 'pkg_30', label: '30元', amountFen: 3000 },
  { id: 'pkg_100', label: '100元', amountFen: 10000 },
];

/** GET /api/billing/recharge — list available packages */
export async function GET() {
  return apiSuccess({
    packages: PACKAGES.map((p) => ({
      ...p,
      tokens: Math.floor((p.amountFen / 100) * TOKEN_PER_CNY),
    })),
    tokenPerCny: TOKEN_PER_CNY,
  });
}

/** POST /api/billing/recharge — create an order */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const { amountFen, paymentMethod = 'manual', packageId } = await req.json();

    // Resolve amount: either explicit amountFen or from package
    let finalAmountFen: number = amountFen;
    if (!finalAmountFen && packageId) {
      const pkg = PACKAGES.find((p) => p.id === packageId);
      if (!pkg) return apiError('INVALID_REQUEST', 400, `Unknown package: ${packageId}`);
      finalAmountFen = pkg.amountFen;
    }
    if (!finalAmountFen || finalAmountFen <= 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'amountFen or packageId is required');
    }

    const tx = createRechargeTransaction(session.sub, finalAmountFen, paymentMethod);

    // DEV ONLY: auto-confirm if confirm=1 query param
    const url = new URL(req.url);
    if (url.searchParams.get('confirm') === '1' && process.env.NODE_ENV !== 'production') {
      const paid = markTransactionPaid(tx.id, 'dev-auto-confirm');
      return apiSuccess({ transaction: paid, autoConfirmed: true });
    }

    return apiSuccess({
      transaction: tx,
      // In production, return payment QR code / redirect URL from your payment SDK here
      paymentHint: 'Integrate payment gateway and call /api/billing/admin/transactions?action=pay to confirm',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('MISSING_REQUIRED_FIELD' as never, 401, 'Unauthorized');
    return apiError('INTERNAL_ERROR', 500, 'Recharge failed', msg);
  }
}
