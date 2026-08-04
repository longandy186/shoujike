/**
 * 来单通知编排（非轮询三层）。统一由 createOrder / webhook 调用。
 * 三层：1) Web Push（最稳定） 2) WebSocket(DO) 站内实时 3) Telegram（兜底）
 * 任一层失败不影响下单主流程（各自 try/catch）。
 */
import { sendWebPush } from './webpush';
import { getPushSubscriptions } from './db';
import type { Env } from './types';

export interface NewOrderNotify {
  order_id: string;
  pickup_code: string;
  master_sku: string;
}

export async function notifyNewOrder(env: Env, order: NewOrderNotify): Promise<void> {
  const text = `🔔 新订单 #${order.pickup_code}`;

  // 1) Web Push（最稳定层；同时驱动系统通知 + 站内 Toast/响铃）
  try {
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      const subs = await getPushSubscriptions(env.DB);
      await Promise.all(
        subs.map((s) => sendWebPush(env, s.endpoint, s.p256dh, s.auth, text).catch(() => {}))
      );
    }
  } catch {
    /* ignore */
  }

  // 2) WebSocket(DO) 站内实时（页面打开时的在线响铃，最像"屏幕前来单"体验）
  // Pages 函数 → 独立 notifier Worker 的 /broadcast（Cloudflare 内网 HTTP，避开跨脚本 DO 绑定 API 差异）
  try {
    const base = env.NOTIFIER_WORKER_URL || 'https://ai-cc-prod-notifier.longandy2026.workers.dev';
    await fetch(`${base}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'new_order', pickup_code: order.pickup_code }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }

  // 3) Telegram（兜底层）
  try {
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
      }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}
