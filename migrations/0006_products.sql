-- 商品主数据表（数据驱动，店员后台可 CRUD，无需改代码）
-- 替代原 server/src/config/sku.template.json 的硬编码；JSON 仅作首次播种。
CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  sku             TEXT UNIQUE NOT NULL,
  category        TEXT NOT NULL DEFAULT '',
  name_zh         TEXT NOT NULL DEFAULT '',
  name_en         TEXT NOT NULL DEFAULT '',
  name_sr         TEXT NOT NULL DEFAULT '',
  desc_zh         TEXT NOT NULL DEFAULT '',
  desc_en         TEXT NOT NULL DEFAULT '',
  desc_sr         TEXT NOT NULL DEFAULT '',
  image_url       TEXT NOT NULL DEFAULT '',
  mockup_asset_url TEXT NOT NULL DEFAULT '',
  print_area      TEXT NOT NULL DEFAULT '{}',   -- JSON {x,y,width,height,unit}
  physical_size   TEXT NOT NULL DEFAULT '{}',   -- JSON {width,height,unit}
  bleed           REAL NOT NULL DEFAULT 0,
  print_technique TEXT NOT NULL DEFAULT '',
  price_rsd       REAL NOT NULL DEFAULT 0,
  price_eur       REAL NOT NULL DEFAULT 0,
  stock           INTEGER NOT NULL DEFAULT 0,
  bom             TEXT NOT NULL DEFAULT '[]',   -- JSON [{materialId,qty}]
  enabled         INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_enabled ON products(enabled);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
