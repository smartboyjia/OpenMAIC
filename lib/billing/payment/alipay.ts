/**
 * 支付宝支付集成
 *
 * 支持两种模式:
 *   - 当面付 (precreate): 返回二维码URL，适合 PC Web 展示
 *   - 电脑网站支付 (page.pay): 跳转到支付宝收银台，适合跳转场景
 *
 * 沙箱 vs 生产:
 *   NODE_ENV=production → openapi.alipay.com
 *   其他              → openapi-sandbox.dl.alipay.com
 */

import { AlipaySdk, AlipayFormData } from 'alipay-sdk';
import { createLogger } from '@/lib/logger';

const log = createLogger('Alipay');

// ---------------------------------------------------------------------------
// SDK 单例
// ---------------------------------------------------------------------------

let _sdk: AlipaySdk | null = null;

export function getAlipaySdk(): AlipaySdk {
  if (_sdk) return _sdk;

  const appId = process.env.ALIPAY_APP_ID;
  const privateKey = process.env.ALIPAY_PRIVATE_KEY;
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

  if (!appId || !privateKey || !alipayPublicKey) {
    throw new Error(
      '支付宝未配置，请在 .env.local 中设置 ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY',
    );
  }

  const isProd = process.env.NODE_ENV === 'production';

  _sdk = new AlipaySdk({
    appId,
    privateKey,
    alipayPublicKey,
    gateway: isProd
      ? 'https://openapi.alipay.com/gateway.do'
      : 'https://openapi-sandbox.dl.alipay.com/gateway.do',
    // 沙箱用支付宝沙箱公钥，生产用正式公钥（通过 ALIPAY_PUBLIC_KEY 区分）
    signType: 'RSA2',
  });

  log.info(`Alipay SDK initialized (${isProd ? 'production' : 'sandbox'})`);
  return _sdk;
}

// ---------------------------------------------------------------------------
// 当面付 — 生成二维码 (alipay.trade.precreate)
// 适合：PC 端展示二维码让用户扫码支付
// ---------------------------------------------------------------------------

export async function createAlipayQRCode(params: {
  /** 我们的订单号 */
  outTradeNo: string;
  /** 金额（分） */
  amountFen: number;
  /** 商品描述 */
  subject: string;
}): Promise<{ qrCode: string }> {
  const sdk = getAlipaySdk();
  const totalAmount = (params.amountFen / 100).toFixed(2);

  log.info(`Creating Alipay QR for order ${params.outTradeNo}, amount ${totalAmount}元`);

  const result = await sdk.exec('alipay.trade.precreate', {
    bizContent: {
      out_trade_no: params.outTradeNo,
      total_amount: totalAmount,
      subject: params.subject,
    },
  });

  const data = result as { code?: string; msg?: string; qr_code?: string; subMsg?: string };

  if (data.code !== '10000' || !data.qr_code) {
    log.error(`Alipay precreate failed: ${data.msg} - ${data.subMsg}`);
    throw new Error(`支付宝下单失败: ${data.msg ?? 'unknown error'}`);
  }

  return { qrCode: data.qr_code };
}

// ---------------------------------------------------------------------------
// PC 网站支付 — 返回跳转表单 (alipay.trade.page.pay)
// 适合：重定向用户到支付宝完整收银台
// ---------------------------------------------------------------------------

export function createAlipayPagePayUrl(params: {
  outTradeNo: string;
  amountFen: number;
  subject: string;
  returnUrl: string;
  notifyUrl: string;
}): string {
  const sdk = getAlipaySdk();
  const totalAmount = (params.amountFen / 100).toFixed(2);

  log.info(`Creating Alipay page pay for order ${params.outTradeNo}`);

  // pageExec 返回 HTML form 字符串，客户端 POST 提交
  const formStr = sdk.pageExec('alipay.trade.page.pay', {
    bizContent: {
      out_trade_no: params.outTradeNo,
      product_code: 'FAST_INSTANT_TRADE_PAY',
      total_amount: totalAmount,
      subject: params.subject,
    },
    returnUrl: params.returnUrl,
    notifyUrl: params.notifyUrl,
  });

  return formStr as string;
}

// ---------------------------------------------------------------------------
// 查询订单状态 (alipay.trade.query)
// 用于前端轮询确认支付结果
// ---------------------------------------------------------------------------

export async function queryAlipayOrder(outTradeNo: string): Promise<{
  paid: boolean;
  tradeNo?: string;
  tradeStatus?: string;
}> {
  const sdk = getAlipaySdk();

  const result = await sdk.exec('alipay.trade.query', {
    bizContent: { out_trade_no: outTradeNo },
  }) as { code?: string; trade_status?: string; trade_no?: string };

  if (result.code !== '10000') {
    return { paid: false, tradeStatus: result.code };
  }

  const paid =
    result.trade_status === 'TRADE_SUCCESS' || result.trade_status === 'TRADE_FINISHED';

  return { paid, tradeNo: result.trade_no, tradeStatus: result.trade_status };
}

// ---------------------------------------------------------------------------
// 验签（用于 Webhook 回调）
// ---------------------------------------------------------------------------

export function verifyAlipayNotify(params: Record<string, string>): boolean {
  try {
    const sdk = getAlipaySdk();
    return sdk.checkNotifySign(params);
  } catch (e) {
    log.error('Alipay notify verify error:', e);
    return false;
  }
}
