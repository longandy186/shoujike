-- 0001_initial_schema.sql
-- AI文创快速生产系统 — D1 初始化（与本地 better-sqlite3 init.ts 一致）
-- 注意：D1 自动跟踪迁移，仅首次应用。

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
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);
CREATE INDEX IF NOT EXISTS idx_orders_master_sku ON orders(master_sku);
CREATE INDEX IF NOT EXISTS idx_orders_pickup_code ON orders(pickup_code);

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

CREATE TABLE IF NOT EXISTS bom_consumption_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT NOT NULL,
  master_sku  TEXT NOT NULL,
  material_id TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_bom_log_order ON bom_consumption_log(order_id);
CREATE INDEX IF NOT EXISTS idx_bom_log_material ON bom_consumption_log(material_id);

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id   TEXT NOT NULL,
  material_name TEXT DEFAULT '',
  remaining     INTEGER NOT NULL,
  safety_stock  INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_material ON inventory_alerts(material_id);

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
CREATE INDEX IF NOT EXISTS idx_inv_tx_type ON inventory_transactions(type);

-- 物料种子（初始库存 100 / 安全库存 20，与 sku.template.json 一致）
INSERT OR IGNORE INTO materials (material_id, name, category, unit, current_stock, safety_stock) VALUES
  ('ACRYLIC_3MM', '3mm 亚克力片', '亚克力', 'pcs', 100, 20),
  ('KEY_RING',    '钥匙圈',       '五金',   'pcs', 100, 20),
  ('FRAME_001',   '相框基座',     '相框',   'pcs', 100, 20),
  ('MAGNET_001',  '磁贴背板',     '磁贴',   'pcs', 100, 20);

-- 初始入库流水（便于库存统计 / 已使用数量）
INSERT INTO inventory_transactions (material_id, material_name, type, qty, ref, note)
SELECT material_id, name, 'IN', 100, 'seed', '初始库存'
FROM materials
WHERE material_id IN ('ACRYLIC_3MM', 'KEY_RING', 'FRAME_001', 'MAGNET_001');
