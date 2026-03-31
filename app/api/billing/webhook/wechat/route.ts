/**
 * POST /api/billing/webhook/wechat
 *
 * 微信支付回调通知（V3 AES-GCM 解密 + RSA 验签）
 * 文档：https://pay.weixin.qq.com/docs/merchant/apis/native-payment/payment-notice.html
 */

import { type NextRequest } from 'next/server';
import { markTransactionPaid } from '@/lib/billing';
import { decryptWechatPayCallback } from '@/lib/billing/payment';
import { createLogger } from '@/lib/logger';

const log = createLogger('WechatWebhook');

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      event_type?: string;
      resource?: {
        ciphertext: string;
        associated_data: string;
        nonce: string;
      };
    };

    if (body.event_type !== 'TRANSACTION.SUCCESS') {
      // 忽略非支付成功事件，返回成功避免微信重试
      return Response.json({ code: 'SUCCESS', message: 'ignored' });
    }

    if (!body.resource) {
      log.error('Missing resource in wechat notify');
      return Response.json({ code: 'FAIL', message: 'missing resource' }, { status: 400 });
    }

    const { ciphertext, associated_data, nonce } = body.resource;
    const result = decryptWechatPayCallback(ciphertext, associated_data, nonce);

    log.info(`WechatPay notify: ${result.outTradeNo} → ${result.tradeState}`);

    if (result.tradeState === 'SUCCESS') {
      markTransactionPaid(result.outTradeNo, result.transactionId);
      log.info(`Marked tx ${result.outTradeNo} as paid via wechat`);
    }

    // 微信要求必须返回 200 + SUCCESS
    return Response.json({ code: 'SUCCESS', message: 'OK' });
  } catch (e) {
    log.error('WechatPay webhook error:', e);
    // 返回 FAIL 让微信重试（最多 15 次）
    return Response.json({ code: 'FAIL', message: 'internal error' }, { status: 500 });
  }
}
