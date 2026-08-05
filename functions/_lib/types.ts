/**
 * Cloudflare Pages Functions 环境变量（绑定）类型
 * - DB: D1 数据库（替代本地 better-sqlite3）
 * - BUCKET: R2 对象存储（游客照片 / 打印图）
 * - VAPID_*: Web Push 应用服务器密钥（站内实时响铃第一层）
 * - TELEGRAM_*: 来单 Telegram 兜底通知
 * - *_WEBHOOK_SECRET / *_APP_SECRET: 外部电商渠道签名校验
 */
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  /** notifier Worker 公网地址（店员端 WebSocket 站内实时响铃第二层）。Cloudflare 内网 HTTP 调用 /broadcast */
  NOTIFIER_WORKER_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  SHOPIFY_WEBHOOK_SECRET?: string;
  ETSY_WEBHOOK_SECRET?: string;
  TIKTOK_APP_SECRET?: string;
}
