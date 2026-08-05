/**
 * SKU / 商品主数据
 * 单一数据源改为 Cloudflare D1 `products` 表（店员后台可增删改，无需改代码）。
 * server/src/config/sku.template.json 仅作为「首次部署的播种数据」(seed)，
 * 表为空时自动灌入，之后以 D1 为准。
 */
import type { D1Database } from '@cloudflare/workers-types';
import config from '../../server/src/config/sku.template.json';

export interface SkuBomItem {
  materialId: string;
  qty: number;
}

export type PrintTechnique = 'direct_insert' | 'heat_sublimation' | 'direct_uv_print';

export interface SkuProduct {
  masterSku: string;
  name: string;
  nameEn?: string;
  nameSr?: string;
  description: string;
  descriptionEn?: string;
  descriptionSr?: string;
  icon: string;
  enabled: boolean;
  category: string;
  physicalSize: { width: number; height: number; unit: string };
  printArea: { x: number; y: number; width: number; height: number; unit: string };
  printSettings: { dpi: number; bleed: number; mirror: boolean };
  printTechnique: PrintTechnique;
  imageUrl?: string;
  mockupAssetUrl?: string;
  stock?: number;
  template: { mask?: string; overlay?: string };
  paper: { type: string; widthMm: number; heightMm: number };
  priceRsd: number;
  priceEur: number;
  bom: SkuBomItem[];
  /** 安全区（裁切线内再留白，关键内容/人脸不可超出），单位 mm。相框=5。 */
  safeZoneMm?: number;
  /** 每个订单产出的物理印刷份数（同图多拼）。钥匙扣=2（同图双拼）。默认 1。 */
  copies?: number;
}

export interface SkuMaterial {
  materialId: string;
  name: string;
  nameEn?: string;
  nameSr?: string;
  category: string;
  unit: string;
  safetyStock: number;
}

interface SkuConfig {
  version?: string;
  description?: string;
  products: any[];
  materials: SkuMaterial[];
}

const cfg = config as SkuConfig;

/** 物料仍由 JSON 配置驱动（库存独立系统管理） */
export function getAllMaterials(): SkuMaterial[] {
  return cfg.materials;
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** 单行 → 对外产品对象（camelCase，兼容游客端 catalog.ts 映射） */
function rowToProduct(r: Record<string, any>): SkuProduct {
  return {
    masterSku: r.sku,
    name: r.name_zh || r.name_en || r.sku,
    nameEn: r.name_en || r.name_zh,
    nameSr: r.name_sr || r.name_zh,
    description: r.desc_zh || '',
    descriptionEn: r.desc_en || r.desc_zh || '',
    descriptionSr: r.desc_sr || r.desc_zh || '',
    icon: '',
    enabled: !!r.enabled,
    category: r.category || 'rect',
    physicalSize: safeJson(r.physical_size, { width: 50, height: 50, unit: 'mm' }),
    printArea: safeJson(r.print_area, { x: 0, y: 0, width: 50, height: 50, unit: 'mm' }),
    printSettings: { dpi: 300, bleed: r.bleed ?? 2, mirror: false },
    printTechnique: (r.print_technique || 'direct_insert') as PrintTechnique,
    imageUrl: r.image_url || '',
    mockupAssetUrl: r.mockup_asset_url || '',
    stock: r.stock ?? 0,
    safeZoneMm: r.safe_zone_mm ?? 0,
    copies: r.copies ?? 1,
    template: {},
    paper: { type: 'A4', widthMm: 210, heightMm: 297 },
    priceRsd: r.price_rsd ?? 0,
    priceEur: r.price_eur ?? 0,
    bom: safeJson(r.bom, []),
  };
}

/** 全量 schema DDL（与 migrations/0001~0006 的「最终合并态」保持一致）。
 * 做「自愈」：本地 `wrangler pages dev` 每次可能新建空的本地 D1 库，而 Miniflare 的
 * 全局迁移追踪认为迁移已应用（旧库），不会在新库重建任何表，导致运行时报
 * "no such table: orders / products / ..."。故首次请求时确保全部表存在再播种。
 * 生产环境迁移已建表，CREATE TABLE IF NOT EXISTS 为幂等 no-op，无副作用。
 * 注意：这里给出的是「最终合并 schema」（已含 0003/0005 的 ALTER 合并列），
 * 不能用增量 ALTER，否则重复列会报错。 */
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE,
  pickup_code TEXT DEFAULT '',
  customer_name TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'offline',
  store_id TEXT DEFAULT '',
  master_sku TEXT DEFAULT '',
  channel_sku TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  preview_url TEXT DEFAULT '',
  print_url TEXT DEFAULT '',
  crop_data TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'NEW',
  remark TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  feedback_reason TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL DEFAULT '[]',
  total_rsd REAL NOT NULL DEFAULT 0,
  total_eur REAL NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'zh',
  customer_phone TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);
CREATE INDEX IF NOT EXISTS idx_orders_master_sku ON orders(master_sku);
CREATE INDEX IF NOT EXISTS idx_orders_pickup_code ON orders(pickup_code);

CREATE TABLE IF NOT EXISTS materials (
  material_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  unit TEXT DEFAULT 'pcs',
  current_stock INTEGER NOT NULL DEFAULT 0,
  safety_stock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);

CREATE TABLE IF NOT EXISTS bom_consumption_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  master_sku TEXT NOT NULL,
  material_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_bom_log_order ON bom_consumption_log(order_id);
CREATE INDEX IF NOT EXISTS idx_bom_log_material ON bom_consumption_log(material_id);

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id TEXT NOT NULL,
  material_name TEXT DEFAULT '',
  remaining INTEGER NOT NULL,
  safety_stock INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_material ON inventory_alerts(material_id);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id TEXT NOT NULL,
  material_name TEXT DEFAULT '',
  type TEXT NOT NULL,
  qty INTEGER NOT NULL,
  ref TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_inv_tx_material ON inventory_transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_type ON inventory_transactions(type);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscriptions(endpoint);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  name_zh TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  name_sr TEXT NOT NULL DEFAULT '',
  desc_zh TEXT NOT NULL DEFAULT '',
  desc_en TEXT NOT NULL DEFAULT '',
  desc_sr TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  mockup_asset_url TEXT NOT NULL DEFAULT '',
  print_area TEXT NOT NULL DEFAULT '{}',
  physical_size TEXT NOT NULL DEFAULT '{}',
  bleed REAL NOT NULL DEFAULT 0,
  print_technique TEXT NOT NULL DEFAULT '',
  price_rsd REAL NOT NULL DEFAULT 0,
  price_eur REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  safe_zone_mm REAL NOT NULL DEFAULT 0,
  copies INTEGER NOT NULL DEFAULT 1,
  bom TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_enabled ON products(enabled);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
`;

// 进程内只跑一次（wrangler pages dev 单进程复用模块）
let schemaEnsured = false;

/**
 * 既有表补列声明表（schema 自愈）。
 *
 * 背景：SCHEMA_DDL 用的是 CREATE TABLE IF NOT EXISTS——对**已存在**的表完全不生效。
 * 因此任何“给已上线的表加字段”都必须在这里登记一条，否则新建库正常、老库（生产）
 * 会因缺列在运行时报 `table X has no column named Y`。
 *
 * 历史事故：orders 的 items_json/total_rsd/total_eur/language/customer_phone 五列
 * 只加进了 DDL 未登记补列，导致生产库游客多商品下单长期 500。
 *
 * 新增字段规则：改 SCHEMA_DDL 的同时，必须在此处补一行同名同类型同默认值。
 */
const COLUMN_PATCHES: Record<string, Record<string, string>> = {
  products: {
    safe_zone_mm: 'REAL NOT NULL DEFAULT 0',
    copies: 'INTEGER NOT NULL DEFAULT 1',
  },
  orders: {
    items_json: "TEXT NOT NULL DEFAULT '[]'",
    total_rsd: 'REAL NOT NULL DEFAULT 0',
    total_eur: 'REAL NOT NULL DEFAULT 0',
    language: "TEXT NOT NULL DEFAULT 'zh'",
    customer_phone: "TEXT NOT NULL DEFAULT ''",
  },
};

/**
 * 对既有表按 COLUMN_PATCHES 逐列补齐，幂等。
 * 用 pragma_table_info 判断列是否已存在，避免重复 ALTER 报错。
 */
async function ensureColumns(db: D1Database): Promise<void> {
  for (const [table, patches] of Object.entries(COLUMN_PATCHES)) {
    const cols = await db
      .prepare('SELECT name FROM pragma_table_info(?1)')
      .bind(table)
      .all<{ name: string }>();
    const existing = new Set((cols.results || []).map((c) => c.name));
    if (existing.size === 0) continue; // 表不存在（理论上 DDL 已建），跳过
    for (const [col, def] of Object.entries(patches)) {
      if (existing.has(col)) continue;
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run();
    }
  }
}

/** 物料种子（与 migrations/0001、0005 一致），表空时灌入 */
async function seedMaterialsIfEmpty(db: D1Database): Promise<void> {
  const r = await db.prepare('SELECT COUNT(*) AS c FROM materials').first<{ c: number }>();
  if (r && r.c > 0) return;
  const mats: [string, string, string, string, number, number][] = [
    ['ACRYLIC_3MM', '3mm 亚克力片', '亚克力', 'pcs', 100, 20],
    ['KEY_RING', '钥匙圈', '五金', 'pcs', 100, 20],
    ['FRAME_001', '相框基座', '相框', 'pcs', 100, 20],
    ['MAGNET_001', '磁贴背板', '磁贴', 'pcs', 100, 20],
    ['PHONE_CASE_BLANK', '手机壳空白坯', '手机壳', 'pcs', 100, 20],
    ['CANVAS_BAG_BLANK', '帆布袋空白坯', '帆布袋', 'pcs', 100, 20],
  ];
  for (const [id, name, cat, unit, stock, safety] of mats) {
    await db
      .prepare('INSERT OR IGNORE INTO materials (material_id,name,category,unit,current_stock,safety_stock) VALUES (?,?,?,?,?,?)')
      .bind(id, name, cat, unit, stock, safety)
      .run();
    await db
      .prepare('INSERT INTO inventory_transactions (material_id,material_name,type,qty,ref,note) VALUES (?,?,?,?,?,?)')
      .bind(id, name, 'IN', stock, 'seed', '初始库存')
      .run();
  }
}

/** 确保全部表存在并播种（幂等，进程内只执行一次） */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaEnsured) return;
  schemaEnsured = true;
  try {
    // 逐条执行：D1 的 db.prepare().run() 只接受单条语句（exec 多语句在本运行时解析失败）
    const stmts = SCHEMA_DDL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const s of stmts) {
      await db.prepare(s).run();
    }
    await ensureColumns(db);
    await seedMaterialsIfEmpty(db);
    const pr = await db.prepare('SELECT COUNT(*) AS c FROM products').first<{ c: number }>();
    if (!pr || pr.c === 0) await seedFromTemplate(db);
  } catch (e) {
    schemaEnsured = false; // 失败则下次请求重试
    throw e;
  }
}

/** 兼容旧调用点：确保 products 表已播种 */
export async function ensureProductsSeeded(db: D1Database): Promise<void> {
  await ensureSchema(db);
}

async function seedFromTemplate(db: D1Database): Promise<void> {
  for (const p of cfg.products) {
    if (!p.masterSku) continue;
    await db
      .prepare(
        `INSERT OR IGNORE INTO products
         (id, sku, category, name_zh, name_en, name_sr, desc_zh, desc_en, desc_sr,
          image_url, mockup_asset_url, print_area, physical_size, bleed, print_technique,
          price_rsd, price_eur, stock, safe_zone_mm, copies, bom, enabled, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        crypto.randomUUID(),
        p.masterSku,
        p.category || '',
        p.name || '',
        p.nameEn || '',
        p.nameSr || '',
        p.description || '',
        p.descriptionEn || '',
        p.descriptionSr || '',
        p.imageUrl || '',
        p.mockupAssetUrl || '',
        JSON.stringify(p.printArea || {}),
        JSON.stringify(p.physicalSize || {}),
        (p.printSettings?.bleed) ?? 2,
        p.printTechnique || 'direct_insert',
        p.priceRsd ?? 0,
        p.priceEur ?? 0,
        p.stock ?? 100,
        p.safeZoneMm ?? 0,
        p.copies ?? 1,
        JSON.stringify(p.bom || []),
        p.enabled === false ? 0 : 1,
        p.sortOrder ?? 0
      )
      .run();
  }
}

/** 启用中的商品（游客端 /api/skus） */
export async function getEnabledProducts(db: D1Database): Promise<SkuProduct[]> {
  await ensureProductsSeeded(db);
  const rows = await db
    .prepare('SELECT * FROM products WHERE enabled = 1 ORDER BY sort_order ASC, id ASC')
    .all<Record<string, any>>();
  return (rows.results || []).map(rowToProduct);
}

/** 全部商品（含禁用，店员后台 / 管理端） */
export async function getAllProducts(db: D1Database): Promise<SkuProduct[]> {
  await ensureProductsSeeded(db);
  const rows = await db
    .prepare('SELECT * FROM products ORDER BY sort_order ASC, id ASC')
    .all<Record<string, any>>();
  return (rows.results || []).map(rowToProduct);
}

/** 按 SKU 取单个商品（订单总价计算用） */
export async function getProductBySku(db: D1Database, sku: string): Promise<SkuProduct | undefined> {
  await ensureProductsSeeded(db);
  const row = await db.prepare('SELECT * FROM products WHERE sku = ?').bind(sku).first<Record<string, any>>();
  return row ? rowToProduct(row) : undefined;
}
