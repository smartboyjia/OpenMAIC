/**
 * Admin: Confirm payment for a pending transaction
 * POST /api/billing/admin/transactions?action=pay
 * Body: { txId, paymentRef? }
 *
 * Use this as a webhook endpoint or manual confirmation.
 */

import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin, markTransactionPaid } from '@/lib/billing';

export async function POST(req: NextRequest) {
  try {
    // Allow both admin and webhook (skip admin check if webhook secret matches)
    const webhookSecret = req.headers.get('x-webhook-secret');
    const configuredSecret = process.env.BILLING_WEBHOOK_SECRET;
    const isWebhook = configuredSecret && webhookSecret === configuredSecret;

    if (!isWebhook) {
      await requireAdmin();
    }

    const { txId, paymentRef } = await req.json();
    if (!txId) return apiError('MISSING_REQUIRED_FIELD', 400, 'txId is required');

    const tx = markTransactionPaid(txId, paymentRef);
    return apiSuccess({ message: 'Payment confirmed', transaction: tx });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('MISSING_REQUIRED_FIELD' as never, 401, 'Unauthorized');
    if (msg === 'Forbidden') return apiError('MISSING_REQUIRED_FIELD' as never, 403, 'Forbidden');
    if (msg.includes('not found')) return apiError('INVALID_REQUEST', 404, msg);
    return apiError('INTERNAL_ERROR', 500, 'Failed to confirm payment', msg);
  }
}
