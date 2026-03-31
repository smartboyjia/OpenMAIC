/**
 * GET /api/billing/qrcode?data=<encoded_url>&size=200
 *
 * 本地生成二维码，返回 PNG 图片。
 * 不依赖任何外部服务（替代 api.qrserver.com）。
 */

import { type NextRequest } from 'next/server';
import QRCode from 'qrcode';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const data = searchParams.get('data');
  const size = Math.min(400, Math.max(100, parseInt(searchParams.get('size') ?? '200', 10)));

  if (!data) {
    return new Response('Missing data parameter', { status: 400 });
  }

  try {
    const buffer = await QRCode.toBuffer(data, {
      type: 'png',
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300', // 5分钟缓存，二维码内容不变就可复用
      },
    });
  } catch (err) {
    console.error('[QRCode] generate failed:', err);
    return new Response('QR code generation failed', { status: 500 });
  }
}
