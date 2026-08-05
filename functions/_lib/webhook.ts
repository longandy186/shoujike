/**
 * 外部电商渠道 Webhook 接收（零轮询）。统一入口 /api/webhook/:channel。
 * 各渠道签名校验 + 订单字段映射不同，逐渠道适配：
 *   - shopify: X-Shopify-Hmac-Sha256 = HMAC-SHA256(rawBody, SHOPIFY_WEBHOOK_SECRET)
 *   - etsy:    X-Etsy-Signature     = HMAC-SHA256(rawBody, ETSY_WEBHOOK_SECRET)
 *   - tiktok:  query `sign`          = md5(sorted_params + TIKTOK_APP_SECRET)（简化校验）
 * 校验通过 → 落 D1（createOrder）→ 触发 notifyNewOrder。
 */
import * as db from './db';
import type { Env } from './types';

export interface WebhookResult {
  ok: boolean;
  error?: string;
  status: number;
}

function stdBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function hmacStd(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return stdBase64(new Uint8Array(sig));
}

async function verifyShopify(raw: string, sig: string | null, secret?: string): Promise<boolean> {
  if (!sig || !secret) return false;
  return (await hmacStd(secret, raw)) === sig;
}

async function verifyEtsy(raw: string, sig: string | null, secret?: string): Promise<boolean> {
  if (!sig || !secret) return false;
  return (await hmacStd(secret, raw)) === sig;
}

async function verifyTikTok(raw: string, sign: string | null, secret?: string): Promise<boolean> {
  if (!sign || !secret) return false;
  // TikTok Shop：sign = md5(timestamp + rawBody + app_secret)（此处以 rawBody+secret 简化校验）
  const enc = new TextEncoder().encode(raw + secret);
  const buf = await crypto.subtle.digest('MD5', enc);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex === sign;
}

function firstImage(obj: any): string {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  return obj?.image?.src || obj?.image || obj?.line_items?.[0]?.image?.src || obj?.transactions?.[0]?.image || '';
}

export async function processWebhook(
  channel: string,
  raw: string,
  headers: Record<string, string | undefined>,
  env: Env
): Promise<WebhookResult> {
  const ch = channel.toLowerCase();

  // ---- 签名校验 ----
  if (ch === 'shopify') {
    const ok = await verifyShopify(raw, headers['x-shopify-hmac-sha256'] ?? null, env.SHOPIFY_WEBHOOK_SECRET);
    if (!ok) return { ok: false, error: 'INVALID_SIGNATURE', status: 401 };
  } else if (ch === 'etsy') {
    const ok = await verifyEtsy(raw, headers['x-etsy-signature'] ?? null, env.ETSY_WEBHOOK_SECRET);
    if (!ok) return { ok: false, error: 'INVALID_SIGNATURE', status: 401 };
  } else if (ch === 'tiktok') {
    // sign 在 query 参数，由 routes 解析后传入 headers['x-tiktok-sign']
    const ok = await verifyTikTok(raw, headers['x-tiktok-sign'] ?? null, env.TIKTOK_APP_SECRET);
    if (!ok) return { ok: false, error: 'INVALID_SIGNATURE', status: 401 };
  } else {
    return { ok: false, error: 'UNKNOWN_CHANNEL', status: 404 };
  }

  // ---- 订单映射 ----
  let body: any = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'BAD_JSON', status: 400 };
  }

  const imageUrl = firstImage(body);
  const customerName =
    body?.customer?.first_name || body?.buyer?.username || body?.name || body?.email || '';
  const storeId = body?.shop_domain || body?.shop_id || body?.seller_id || '';

  const r = await db.createOrder(env.DB, {
    imageUrl,
    customerName: String(customerName),
    masterSku: '',
    source: ch,
    storeId: String(storeId),
  });
  if (r.error) return { ok: false, error: r.error, status: 500 };

  // 触发来单通知（三层）
  if (r.order) {
    const { notifyNewOrder } = await import('./notify');
    await notifyNewOrder(env, {
      order_id: r.order.order_id,
      pickup_code: r.order.pickup_code,
      master_sku: r.order.master_sku,
    });
  }
  return { ok: true, status: 201 };
}
