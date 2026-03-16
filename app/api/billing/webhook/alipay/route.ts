/**
 * POST /api/billing/webhook/alipay
 *
 * 支付宝异步回调（服务器 → 服务器）
 *
 * 支付宝要求:
 * 1. 必须返回纯文本 "success"，否则会重试（最多 8 次，间隔 2m/10m/10m/1h/2h/6h/15h）
 * 2. 必须验签，防止伪造请求
 * 3. 幂等处理，重复回调不重复充值
 *
 * 配置:
 * 在支付宝开放平台「应用配置 → 异步通知地址」填写:
 *   https://yourdomain.com/api/billing/webhook/alipay
 */

import { type NextRequest, NextResponse } from 'next/server';
import { markTransactionPaid } from '@/lib/billing';
import { verifyAlipayNotify } from '@/lib/billing/payment';
import { createLogger } from '@/lib/logger';

const log = createLogger('AlipayWebhook');

export async function POST(req: NextRequest) {
  // 支付宝 POST application/x-www-form-urlencoded
  let params: Record<string, string>;
  try {
    const text = await req.text();
    params = Object.fromEntries(new URLSearchParams(text));
  } catch (e) {
    log.error('Failed to parse notify body:', e);
    return new NextResponse('fail', { status: 400 });
  }

  log.info(`Alipay notify: trade_status=${params.trade_status}, out_trade_no=${params.out_trade_no}`);

  // ① 验签（必须）
  const valid = verifyAlipayNotify(params);
  if (!valid) {
    log.warn(`Invalid signature for order ${params.out_trade_no}`);
    return new NextResponse('fail', { status: 400 });
  }

  // ② 只处理 TRADE_SUCCESS 和 TRADE_FINISHED
  const { trade_status, out_trade_no, trade_no } = params;
  if (trade_status !== 'TRADE_SUCCESS' && trade_status !== 'TRADE_FINISHED') {
    log.info(`Ignoring trade_status=${trade_status} for order ${out_trade_no}`);
    // 仍然返回 success，让支付宝停止重试
    return new NextResponse('success');
  }

  // ③ 充值（幂等，已支付的订单不会重复充值）
  try {
    markTransactionPaid(out_trade_no, trade_no);
    log.info(`✅ Order ${out_trade_no} paid via Alipay, trade_no=${trade_no}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 订单不存在 → 可能是测试单，记录但不失败
    if (msg.includes('not found')) {
      log.warn(`Order ${out_trade_no} not found (test order?)`);
    } else {
      log.error(`Failed to credit order ${out_trade_no}:`, e);
      // 返回 fail 让支付宝重试
      return new NextResponse('fail', { status: 500 });
    }
  }

  // ④ 必须返回 "success"（纯文本）
  return new NextResponse('success');
}
