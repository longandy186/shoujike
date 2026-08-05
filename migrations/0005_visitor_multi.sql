-- 0005_visitor_multi.sql
-- V2 游客多产品：orders 增加多商品(items_json)、RSD/EUR 合计、语言、手机号；
-- 新增两种物料（手机壳空白坯 / 帆布袋空白坯）种子。

ALTER TABLE orders ADD COLUMN items_json   TEXT NOT NULL DEFAULT '[]';
ALTER TABLE orders ADD COLUMN total_rsd    REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN total_eur    REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN language      TEXT NOT NULL DEFAULT 'zh';
ALTER TABLE orders ADD COLUMN customer_phone TEXT NOT NULL DEFAULT '';

-- 新物料种子（初始库存 100 / 安全库存 20）
INSERT OR IGNORE INTO materials (material_id, name, category, unit, current_stock, safety_stock) VALUES
  ('PHONE_CASE_BLANK', '手机壳空白坯', '手机壳', 'pcs', 100, 20),
  ('CANVAS_BAG_BLANK', '帆布袋空白坯', '帆布袋', 'pcs', 100, 20);

INSERT INTO inventory_transactions (material_id, material_name, type, qty, ref, note)
SELECT material_id, name, 'IN', 100, 'seed', '初始库存'
FROM materials
WHERE material_id IN ('PHONE_CASE_BLANK', 'CANVAS_BAG_BLANK')
  AND material_id NOT IN (SELECT material_id FROM inventory_transactions WHERE ref = 'seed');
