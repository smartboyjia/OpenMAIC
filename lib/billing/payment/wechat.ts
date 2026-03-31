/**
 * 微信支付 V3 Native Pay（扫码付）
 *
 * 文档：https://pay.weixin.qq.com/docs/merchant/apis/native-payment/
 *
 * 所需环境变量：
 *   WECHAT_PAY_APPID          - 微信 AppID（公众号/小程序/APP）
 *   WECHAT_PAY_MCH_ID         - 商户号
 *   WECHAT_PAY_SERIAL_NO      - API 证书序列号
 *   WECHAT_PAY_PRIVATE_KEY    - API 私钥（PEM 格式，换行用 \n 或直接多行）
 *   WECHAT_PAY_API_V3_KEY     - APIv3 密钥（32位字符串，用于解密回调）
 *   WECHAT_PAY_NOTIFY_URL     - 支付回调地址（必须 HTTPS）
 *
 * 沙箱：微信支付不提供独立沙箱，测试用 NODE_ENV !== 'production' 自动确认模式
 */

import crypto from 'crypto';
import { createLogger } from '@/lib/logger';

const log = createLogger('WechatPay');

// ---------------------------------------------------------------------------
// 配置检查
// ---------------------------------------------------------------------------

export function isWechatPayConfigured(): boolean {
  return !!(
    process.env.WECHAT_PAY_APPID &&
    process.env.WECHAT_PAY_MCH_ID &&
    process.env.WECHAT_PAY_SERIAL_NO &&
    process.env.WECHAT_PAY_PRIVATE_KEY &&
    process.env.WECHAT_PAY_API_V3_KEY
  );
}

function getConfig() {
  const appid      = process.env.WECHAT_PAY_APPID!;
  const mchId      = process.env.WECHAT_PAY_MCH_ID!;
  const serialNo   = process.env.WECHAT_PAY_SERIAL_NO!;
  const privateKey = process.env.WECHAT_PAY_PRIVATE_KEY!.replace(/\\n/g, '\n');
  const apiV3Key   = process.env.WECHAT_PAY_API_V3_KEY!;
  const notifyUrl  = process.env.WECHAT_PAY_NOTIFY_URL ?? '';
  return { appid, mchId, serialNo, privateKey, apiV3Key, notifyUrl };
}

// ---------------------------------------------------------------------------
// 签名工具（微信支付 V3 签名规范）
// ---------------------------------------------------------------------------

function buildMessage(method: string, url: string, timestamp: number, nonce: string, body: string): string {
  return `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;
}

function signRSA(message: string, privateKey: string): string {
  const sign = crypto.createSign('SHA256withRSA');
  sign.update(message);
  return sign.sign(privateKey, 'base64');
}

function buildAuthHeader(method: string, url: string, body: string): string {
  const { mchId, serialNo, privateKey } = getConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = buildMessage(method, url, timestamp, nonce, body);
  const signature = signRSA(message, privateKey);

  return (
    `WECHATPAY2-SHA256-RSA2048 ` +
    `mchid="${mchId}",` +
    `nonce_str="${nonce}",` +
    `timestamp="${timestamp}",` +
    `serial_no="${serialNo}",` +
    `signature="${signature}"`
  );
}

async function wxRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: object,
): Promise<T> {
  const baseUrl = 'https://api.mch.weixin.qq.com';
  const fullUrl = baseUrl + path;
  const bodyStr = body ? JSON.stringify(body) : '';

  const auth = buildAuthHeader(method, path, bodyStr);

  const res = await fetch(fullUrl, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': auth,
    },
    ...(body ? { body: bodyStr } : {}),
  });

  const text = await res.text();
  let data: T;
  try { data = JSON.parse(text) as T; } catch { throw new Error(`微信支付接口返回异常: ${text}`); }

  if (!res.ok) {
    const err = data as { code?: string; message?: string };
    log.error(`WechatPay ${method} ${path} failed: ${err.code} - ${err.message}`);
    throw new Error(`微信支付错误: ${err.code ?? res.status} - ${err.message ?? '未知错误'}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Native 下单 — 返回二维码链接（用户扫码支付）
// ---------------------------------------------------------------------------

export async function createWechatPayNative(params: {
  outTradeNo: string;
  amountFen: number;
  description: string;
}): Promise<{ codeUrl: string }> {
  const { appid, mchId, notifyUrl } = getConfig();

  log.info(`Creating WechatPay Native order ${params.outTradeNo}, amount ${params.amountFen}fen`);

  const data = await wxRequest<{ code_url: string }>('POST', '/v3/pay/transactions/native', {
    appid,
    mchid: mchId,
    description: params.description,
    out_trade_no: params.outTradeNo,
    notify_url: notifyUrl || 'https://placeholder.example.com/notify', // 沙箱/测试时占位
    amount: {
      total: params.amountFen,
      currency: 'CNY',
    },
  });

  return { codeUrl: data.code_url };
}

// ---------------------------------------------------------------------------
// 查询订单状态
// ---------------------------------------------------------------------------

export async function queryWechatPayOrder(outTradeNo: string): Promise<{
  paid: boolean;
  tradeState?: string;
  transactionId?: string;
}> {
  const { mchId } = getConfig();

  type QueryResult = {
    trade_state?: string;
    transaction_id?: string;
    out_trade_no?: string;
  };

  const data = await wxRequest<QueryResult>(
    'GET',
    `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${mchId}`,
  );

  const paid = data.trade_state === 'SUCCESS';
  return { paid, tradeState: data.trade_state, transactionId: data.transaction_id };
}

// ---------------------------------------------------------------------------
// 验签 + 解密回调通知
// AES-256-GCM 解密 resource，验证 HTTP 头签名
// ---------------------------------------------------------------------------

export interface WechatPayNotifyResult {
  outTradeNo: string;
  transactionId: string;
  tradeState: string;
  amount: number; // fen
}

export function decryptWechatPayCallback(
  ciphertext: string,
  associatedData: string,
  nonce: string,
): WechatPayNotifyResult {
  const { apiV3Key } = getConfig();

  const key = Buffer.from(apiV3Key, 'utf-8');
  const iv = Buffer.from(nonce, 'utf-8');
  const cipherBuf = Buffer.from(ciphertext, 'base64');

  // 最后 16 字节为 GCM AuthTag
  const authTag = cipherBuf.slice(cipherBuf.length - 16);
  const encrypted = cipherBuf.slice(0, cipherBuf.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(associatedData, 'utf-8'));

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const resource = JSON.parse(decrypted.toString('utf-8')) as {
    out_trade_no: string;
    transaction_id: string;
    trade_state: string;
    amount: { total: number };
  };

  return {
    outTradeNo: resource.out_trade_no,
    transactionId: resource.transaction_id,
    tradeState: resource.trade_state,
    amount: resource.amount.total,
  };
}

export function verifyWechatPaySignature(
  timestamp: string,
  nonce: string,
  body: string,
  signature: string,
  publicKey: string,
): boolean {
  try {
    const message = `${timestamp}\n${nonce}\n${body}\n`;
    const verify = crypto.createVerify('SHA256withRSA');
    verify.update(message);
    return verify.verify(publicKey, signature, 'base64');
  } catch (e) {
    log.error('WechatPay signature verify error:', e);
    return false;
  }
}
