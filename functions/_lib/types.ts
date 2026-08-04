/**
 * Cloudflare Pages Functions 环境变量（绑定）类型
 * - DB: D1 数据库（替代本地 better-sqlite3，图片也内联存于 D1，免去 R2 订阅）
 */
import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
}
