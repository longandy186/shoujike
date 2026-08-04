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
import fs from 'fs';
import path from 'path';

/** 初始库存 / 安全库存（与 data/init.sql 种子保持一致） */
const MATERIAL_INITIAL_STOCK = 100;
const MATERIAL_SAFETY_STOCK = 20;

/**
 * 读取 sku.template.json 的物料主数据，用于初始化物料库存表
 */
function loadSkuMaterials(): Array<{ materialId: string; name: string; category: string; unit: string; safetyStock: number }> {
  try {
    const cfgPath = path.resolve(__dirname, '..', 'config', 'sku.template.json');
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    const cfg = JSON.parse(raw) as { materials?: Array<{ materialId: string; name: string; category: string; unit: string; safetyStock: number }> };
    return cfg.materials ?? [];
  } catch {
    return [];
  }
}

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

  // ============================================================
  // materials 表 — 物料库存主表（Phase 1.5）
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS materials (
      material_id   TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      category      TEXT DEFAULT '',
      unit          TEXT DEFAULT 'pcs',
      current_stock INTEGER NOT NULL DEFAULT 0,
      safety_stock  INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
  `);

  // ============================================================
  // bom_consumption_log 表 — BOM 扣减流水（Phase 1.5）
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS bom_consumption_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    TEXT NOT NULL,
      master_sku  TEXT NOT NULL,
      material_id TEXT NOT NULL,
      qty         INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_bom_log_order     ON bom_consumption_log(order_id);
    CREATE INDEX IF NOT EXISTS idx_bom_log_material  ON bom_consumption_log(material_id);
  `);

  // ============================================================
  // inventory_alerts 表 — 低库存预警记录（Phase 1.5）
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_alerts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id   TEXT NOT NULL,
      material_name TEXT DEFAULT '',
      remaining     INTEGER NOT NULL,
      safety_stock  INTEGER NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_alerts_material ON inventory_alerts(material_id);
  `);

  // ============================================================
  // inventory_transactions 表 — 库存流水（Phase 1.5 统计/入库/出库）
  // type: IN（入库）/ OUT（出库扣减）/ ADJUST（调整）
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id   TEXT NOT NULL,
      material_name TEXT DEFAULT '',
      type          TEXT NOT NULL,
      qty           INTEGER NOT NULL,
      ref           TEXT DEFAULT '',
      note          TEXT DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_inv_tx_material ON inventory_transactions(material_id);
    CREATE INDEX IF NOT EXISTS idx_inv_tx_type    ON inventory_transactions(type);
  `);

  // ============================================================
  // 物料种子数据（幂等：仅 INSERT 不存在的物料，保留已有库存）
  // 初始库存 100、安全库存 20，与 data/init.sql 保持一致
  // 新物料额外写一条 IN 流水（初始库存），便于库存统计/入库历史
  // ============================================================
  const seedMaterials = loadSkuMaterials();
  if (seedMaterials.length > 0) {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO materials (material_id, name, category, unit, current_stock, safety_stock)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const txStmt = db.prepare(`
      INSERT INTO inventory_transactions (material_id, material_name, type, qty, ref, note)
      VALUES (?, ?, 'IN', ?, 'seed', '初始库存')
    `);
    const seed = db.transaction(() => {
      for (const m of seedMaterials) {
        const info = stmt.run(m.materialId, m.name, m.category, m.unit, MATERIAL_INITIAL_STOCK, m.safetyStock || MATERIAL_SAFETY_STOCK);
        // changes === 1 表示是新插入的物料，才补写初始 IN 流水（避免重复统计）
        if (info.changes === 1) {
          txStmt.run(m.materialId, m.name, MATERIAL_INITIAL_STOCK);
        }
      }
    });
    seed();
    console.log(`[DB] 物料种子已写入: ${seedMaterials.length} 种（初始库存 ${MATERIAL_INITIAL_STOCK}）`);
  }

  // 兼容旧数据库：无 pickup_code 列时自动添加
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN pickup_code TEXT DEFAULT ''`);
  } catch { /* 列已存在则忽略 */ }

  console.log('[DB] 数据库初始化完成');
  console.log('[DB] 已创建表: orders, materials, bom_consumption_log, inventory_alerts');
  console.log('[DB] 订单状态枚举:', Object.values(OrderStatus).join(' → '));
}

// 直接运行时执行初始化
if (require.main === module) {
  initDatabase();
  console.log('[DB] 初始化脚本执行完毕');
}
