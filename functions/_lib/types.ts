/**
 * Cloudflare Pages Functions 环境变量（绑定）类型
 * - DB: D1 数据库（替代本地 better-sqlite3）
 * - BUCKET: R2 对象存储（游客照片 / 打印图）
 */
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
}
