-- ============================================================
-- AI文创快速生产系统 — 独立迁移脚本（init.sql）
-- 与 server/src/db/init.ts 的建表逻辑保持一致，供纯 SQL 部署使用。
-- 运行方式（SQLite 命令行）：
--   sqlite3 server/storage/prod.db < data/init.sql
-- 全部使用 IF NOT EXISTS / INSERT OR IGNORE，可重复执行（幂等）。
-- ============================================================

-- ============================================================
-- Order 表 — 订单主表
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT NOT NULL UNIQUE,
  pickup_code   TEXT DEFAULT '',
  customer_name TEXT DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'offline',
  store_id      TEXT DEFAULT '',
  master_sku    TEXT DEFAULT '',
  channel_sku   TEXT DEFAULT '',
  image_url     TEXT DEFAULT '',
  preview_url   TEXT DEFAULT '',
  print_url     TEXT DEFAULT '',
  crop_data     TEXT DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'NEW',
  remark        TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at   ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_source       ON orders(source);
CREATE INDEX IF NOT EXISTS idx_orders_master_sku   ON orders(master_sku);
CREATE INDEX IF NOT EXISTS idx_orders_pickup_code  ON orders(pickup_code);

-- ============================================================
-- materials 表 — 物料库存主表（Phase 1.5）
-- ============================================================
CREATE TABLE IF NOT EXISTS materials (
  material_id     TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT DEFAULT '',
  unit            TEXT DEFAULT 'pcs',
  current_stock   INTEGER NOT NULL DEFAULT 0,
  safety_stock    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);

-- ============================================================
-- bom_consumption_log 表 — BOM 扣减流水（Phase 1.5）
-- ============================================================
CREATE TABLE IF NOT EXISTS bom_consumption_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT NOT NULL,
  master_sku    TEXT NOT NULL,
  material_id   TEXT NOT NULL,
  qty           INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_bom_log_order      ON bom_consumption_log(order_id);
CREATE INDEX IF NOT EXISTS idx_bom_log_material   ON bom_consumption_log(material_id);

-- ============================================================
-- inventory_alerts 表 — 低库存预警记录（Phase 1.5）
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id   TEXT NOT NULL,
  material_name TEXT DEFAULT '',
  remaining     INTEGER NOT NULL,
  safety_stock  INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_alerts_material ON inventory_alerts(material_id);

-- ============================================================
-- 物料种子数据（初始库存 100，安全库存 20）
-- 注意：重复执行时用 INSERT OR IGNORE 保留已有库存，不会覆盖。
-- ============================================================
INSERT OR IGNORE INTO materials (material_id, name, category, unit, current_stock, safety_stock) VALUES
  ('ACRYLIC_3MM', '3mm 亚克力片', '亚克力', 'pcs', 100, 20),
  ('KEY_RING',    '钥匙圈',       '五金',   'pcs', 100, 20),
  ('FRAME_001',   '相框基座',     '相框',   'pcs', 100, 20),
  ('MAGNET_001',  '磁贴背板',     '磁贴',   'pcs', 100, 20);
