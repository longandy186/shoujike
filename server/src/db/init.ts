/**
 * 数据库初始化 — 建表脚本
 *
 * 设计原则：
 * - 当前只创建 MVP 必需的 Order 表
 * - 预留 master_sku / channel_sku / source 等扩展字段
 * - 状态使用字符串枚举便于未来扩展
 * - 所有表使用 IF NOT EXISTS 保证幂等
 */

import db from './connection';

/**
 * 订单状态枚举
 *
 * 状态流转：
 *   NEW → WAITING_CHECK → READY_PRINT → PRINTED → PROCESSING → COMPLETED
 */
export enum OrderStatus {
  /** 新订单：游客刚提交 */
  NEW = 'NEW',
  /** 等待店员审核 */
  WAITING_CHECK = 'WAITING_CHECK',
  /** 审核通过，可以打印 */
  READY_PRINT = 'READY_PRINT',
  /** 已打印 */
  PRINTED = 'PRINTED',
  /** 制作中 */
  PROCESSING = 'PROCESSING',
  /** 已完成交付 */
  COMPLETED = 'COMPLETED',
}

/** 订单来源枚举（预留多渠道扩展） */
export enum OrderSource {
  /** 线下扫码 */
  OFFLINE = 'offline',
  /** 独立站 */
  WEBSITE = 'website',
  /** Shopify（预留） */
  SHOPIFY = 'shopify',
  /** Etsy（预留） */
  ETSY = 'etsy',
  /** TikTok Shop（预留） */
  TIKTOK = 'tiktok',
}

export function initDatabase(): void {
  console.log('[DB] 开始初始化数据库...');

  // ============================================================
  // Order 表 — 订单主表
  //
  // 扩展预留说明：
  // - master_sku: 关联未来 Master SKU 表
  // - channel_sku: 多渠道 SKU 映射
  // - source: 订单渠道来源
  // - store_id: 多门店支持
  // - crop_data: Canvas 裁剪参数 (JSON)
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      -- 主键
      id            INTEGER PRIMARY KEY AUTOINCREMENT,

      -- 订单编号（UUID，内部唯一标识）
      order_id      TEXT NOT NULL UNIQUE,

      -- 取件码（4位数字，顾客展示给店员用）
      pickup_code   TEXT DEFAULT '',

      -- 客户信息
      customer_name TEXT DEFAULT '',

      -- 渠道信息（预留多门店/多渠道）
      source        TEXT NOT NULL DEFAULT 'offline',
      store_id      TEXT DEFAULT '',

      -- SKU 信息（预留 Master SKU 体系）
      master_sku    TEXT DEFAULT '',
      channel_sku   TEXT DEFAULT '',

      -- 图片数据
      image_url     TEXT DEFAULT '',
      preview_url   TEXT DEFAULT '',
      print_url     TEXT DEFAULT '',

      -- Canvas 裁剪数据 (JSON string)
      crop_data     TEXT DEFAULT '{}',

      -- 订单状态
      status        TEXT NOT NULL DEFAULT 'NEW',

      -- 备注
      remark        TEXT DEFAULT '',

      -- 时间戳
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- 索引：按状态查询（店员后台常用）
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    -- 索引：按创建时间排序
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

    -- 索引：按来源查询（未来多渠道报表）
    CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);

    -- 索引：按 Master SKU 查询（未来生产统计）
    CREATE INDEX IF NOT EXISTS idx_orders_master_sku ON orders(master_sku);

    -- 索引：按取件码查询（店员最常用）
    CREATE INDEX IF NOT EXISTS idx_orders_pickup_code ON orders(pickup_code);
  `);

  // 兼容旧数据库：无 pickup_code 列时自动添加
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN pickup_code TEXT DEFAULT ''`);
  } catch { /* 列已存在则忽略 */ }

  console.log('[DB] 数据库初始化完成');
  console.log('[DB] 已创建表: orders');
  console.log('[DB] 订单状态枚举:', Object.values(OrderStatus).join(' → '));
}

// 直接运行时执行初始化
if (require.main === module) {
  initDatabase();
  console.log('[DB] 初始化脚本执行完毕');
}
