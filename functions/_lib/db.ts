/**
 * D1 数据访问层（替代 better-sqlite3 的同步调用）
 * 全部为 async（D1 是异步 API）。业务逻辑从 server/src/services 移植，
 * 保持与本地 Express 版本一致的行为（BOM 扣减、库存预警、可生产数量等）。
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { getProductBySku, getEnabledProducts } from './sku';

export interface MaterialRow {
  material_id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  safety_stock: number;
}

export type TxType = 'IN' | 'OUT' | 'ADJUST';

export interface MaterialWithStats extends MaterialRow {
  used: number;
}

export interface BomCapacity {
  materialId: string;
  name: string;
  need: number;
  have: number;
  enough: boolean;
}

export interface ProductCapacity {
  masterSku: string;
  name: string;
  producible: number;
  bom: BomCapacity[];
}

export interface ActiveAlert {
  material_id: string;
  material_name: string;
  remaining: number;
  safety_stock: number;
  created_at: string;
}

export interface InventorySummary {
  materials: MaterialWithStats[];
  products: ProductCapacity[];
  alerts: ActiveAlert[];
}

export interface OrderRow {
  id: number;
  order_id: string;
  pickup_code: string;
  customer_name: string;
  source: string;
  store_id: string;
  master_sku: string;
  channel_sku: string;
  image_url: string;
  preview_url: string;
  print_url: string;
  crop_data: string;
  status: string;
  remark: string;
  created_at: string;
  updated_at: string;
}

/** D1 .all() 返回 { results }，统一取出数组 */
async function allRows<T>(stmt: D1PreparedStatement): Promise<T[]> {
  const res = (await stmt.all<T>()) as unknown as { results?: T[] } | T[];
  return Array.isArray(res) ? res : res.results ?? [];
}

/** 查询全部物料库存 */
export async function getInventory(db: D1Database): Promise<MaterialRow[]> {
  return allRows<MaterialRow>(db.prepare('SELECT * FROM materials ORDER BY material_id'));
}

/** 查询单物料 */
export async function getMaterial(db: D1Database, materialId: string): Promise<MaterialRow | undefined> {
  return db.prepare('SELECT * FROM materials WHERE material_id = ?').bind(materialId).first<MaterialRow>();
}

/** 写一条库存流水 */
export async function logTransaction(
  db: D1Database,
  materialId: string,
  type: TxType,
  qty: number,
  ref = '',
  note = ''
): Promise<void> {
  const mat = await getMaterial(db, materialId);
  const name = mat?.name ?? materialId;
  await db
    .prepare(`INSERT INTO inventory_transactions (material_id, material_name, type, qty, ref, note) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(materialId, name, type, qty, ref, note)
    .run();
}

/** 历史已使用数量（OUT 流水之和） */
export async function getUsedCount(db: D1Database, materialId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(qty), 0) AS total FROM inventory_transactions WHERE material_id = ? AND type = 'OUT'`)
    .bind(materialId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** 判断订单是否已扣减 BOM（幂等） */
export async function hasConsumed(db: D1Database, orderId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM bom_consumption_log WHERE order_id = ? LIMIT 1').bind(orderId).first();
  return !!row;
}

/** 采购入库（写 IN 流水 + 增加库存） */
export async function stockIn(
  db: D1Database,
  materialId: string,
  qty: number,
  note = ''
): Promise<{ ok: boolean; material?: MaterialRow; error?: string }> {
  if (!materialId) return { ok: false, error: '缺少 materialId' };
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: '入库数量必须为正整数' };
  const mat = await getMaterial(db, materialId);
  if (!mat) return { ok: false, error: `未知物料: ${materialId}` };

  await db.batch([
    db
      .prepare(`UPDATE materials SET current_stock = current_stock + ?, updated_at = datetime('now', 'localtime') WHERE material_id = ?`)
      .bind(qty, materialId),
    db
      .prepare(`INSERT INTO inventory_transactions (material_id, material_name, type, qty, ref, note) VALUES (?, ?, 'IN', ?, '', ?)`)
      .bind(materialId, mat.name, qty, note || '采购入库'),
  ]);
  return { ok: true, material: await getMaterial(db, materialId) };
}

/**
 * 订单完成时扣减 BOM（幂等）
 */
export async function consumeBom(
  db: D1Database,
  orderId: string,
  masterSku: string
): Promise<{ ok: boolean; consumed: boolean; alerts: string[]; error?: string }> {
  if (await hasConsumed(db, orderId)) return { ok: true, consumed: false, alerts: [] };

  const product = getProductBySku(masterSku);
  if (!product) return { ok: false, consumed: false, alerts: [], error: `未知 SKU: ${masterSku}` };
  if (!product.bom || product.bom.length === 0) return { ok: true, consumed: false, alerts: [] };

  const alerts: string[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const item of product.bom) {
    statements.push(
      db
        .prepare(`UPDATE materials SET current_stock = current_stock - ?, updated_at = datetime('now', 'localtime') WHERE material_id = ?`)
        .bind(item.qty, item.materialId)
    );
    statements.push(
      db
        .prepare(`INSERT INTO bom_consumption_log (order_id, master_sku, material_id, qty) VALUES (?, ?, ?, ?)`)
        .bind(orderId, masterSku, item.materialId, item.qty)
    );
    statements.push(
      db
        .prepare(`INSERT INTO inventory_transactions (material_id, material_name, type, qty, ref, note) VALUES (?, (SELECT name FROM materials WHERE material_id = ?), 'OUT', ?, ?, '订单完成扣减')`)
        .bind(item.materialId, item.materialId, item.qty, orderId)
    );
  }

  await db.batch(statements);

  // 扣减后低于安全库存 → 写预警
  for (const item of product.bom) {
    const mat = await getMaterial(db, item.materialId);
    if (mat && mat.current_stock < mat.safety_stock) {
      await db
        .prepare(`INSERT INTO inventory_alerts (material_id, material_name, remaining, safety_stock) VALUES (?, ?, ?, ?)`)
        .bind(mat.material_id, mat.name, mat.current_stock, mat.safety_stock)
        .run();
      alerts.push(`⚠️ ${mat.name}(${mat.material_id}) 库存剩 ${mat.current_stock}，低于安全线 ${mat.safety_stock}`);
    }
  }

  return { ok: true, consumed: true, alerts };
}

/** 各启用产品的可生产数量（按 BOM 取最小瓶颈） */
export async function getProductCapacities(db: D1Database): Promise<ProductCapacity[]> {
  const products = getEnabledProducts();
  const result: ProductCapacity[] = [];
  for (const p of products) {
    const bom: BomCapacity[] = [];
    let producible = p.bom && p.bom.length > 0 ? Infinity : 0;
    for (const item of p.bom || []) {
      const mat = await getMaterial(db, item.materialId);
      const have = mat?.current_stock ?? 0;
      const need = item.qty;
      bom.push({ materialId: item.materialId, name: mat?.name ?? item.materialId, need, have, enough: have >= need });
      if (need > 0) producible = Math.min(producible, Math.floor(have / need));
    }
    if (!isFinite(producible)) producible = 0;
    result.push({ masterSku: p.masterSku, name: p.name, producible, bom });
  }
  return result;
}

/** 当前活跃低库存预警（按物料去重，取最新一条） */
export async function getActiveAlerts(db: D1Database): Promise<ActiveAlert[]> {
  const rows = await allRows<ActiveAlert>(
    db.prepare(`
      SELECT material_id, material_name, remaining, safety_stock, created_at
      FROM inventory_alerts
      WHERE material_id NOT IN (SELECT material_id FROM materials WHERE current_stock >= safety_stock)
      ORDER BY created_at DESC
    `)
  );
  const seen = new Set<string>();
  const dedup: ActiveAlert[] = [];
  for (const r of rows) {
    if (seen.has(r.material_id)) continue;
    seen.add(r.material_id);
    dedup.push(r);
  }
  return dedup;
}

/** 库存总览（物料 + 可生产数量 + 预警） */
export async function getInventorySummary(db: D1Database): Promise<InventorySummary> {
  const mats = await getInventory(db);
  const materials: MaterialWithStats[] = [];
  for (const m of mats) {
    materials.push({ ...m, used: await getUsedCount(db, m.material_id) });
  }
  return {
    materials,
    products: await getProductCapacities(db),
    alerts: await getActiveAlerts(db),
  };
}

/** 创建订单（生成 4 位当日唯一取件码） */
export async function createOrder(
  db: D1Database,
  p: { imageUrl: string; customerName?: string; masterSku?: string; source?: string; storeId?: string }
): Promise<{ order?: OrderRow; error?: string }> {
  const orderId = crypto.randomUUID();
  let pickupCode = '';
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const exists = await db
      .prepare(`SELECT id FROM orders WHERE pickup_code = ? AND date(created_at) = date('now', 'localtime')`)
      .bind(code)
      .first();
    if (!exists) {
      pickupCode = code;
      break;
    }
  }
  if (!pickupCode) return { error: 'CODE_FAILED' };

  const res = await db
    .prepare(`INSERT INTO orders (order_id, pickup_code, customer_name, source, store_id, master_sku, image_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(orderId, pickupCode, p.customerName || '', p.source || 'offline', p.storeId || '', p.masterSku || '', p.imageUrl, 'NEW')
    .run();

  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind((res.meta as { last_row_id: number }).last_row_id).first<OrderRow>();
  return { order: order ?? undefined };
}

export async function getOrders(db: D1Database): Promise<OrderRow[]> {
  return allRows<OrderRow>(db.prepare('SELECT * FROM orders ORDER BY created_at DESC'));
}

export async function getOrderByCode(db: D1Database, code: string): Promise<OrderRow | undefined> {
  return db
    .prepare(`SELECT * FROM orders WHERE pickup_code = ? AND date(created_at) = date('now', 'localtime') ORDER BY created_at DESC LIMIT 1`)
    .bind(code)
    .first<OrderRow>();
}

export async function getOrderById(db: D1Database, orderId: string): Promise<OrderRow | undefined> {
  return db.prepare('SELECT * FROM orders WHERE order_id = ?').bind(orderId).first<OrderRow>();
}

export async function updateOrderStatus(
  db: D1Database,
  orderId: string,
  status: string
): Promise<{ order?: OrderRow; error?: string; bomAlerts?: string[] }> {
  const res = await db
    .prepare(`UPDATE orders SET status = ?, updated_at = datetime('now', 'localtime') WHERE order_id = ?`)
    .bind(status, orderId)
    .run();
  if ((res.meta as { changes: number }).changes === 0) return { error: 'NOT_FOUND' };

  const order = await getOrderById(db, orderId);
  let bomAlerts: string[] = [];
  if (order && status === 'COMPLETED') {
    const bom = await consumeBom(db, order.order_id, order.master_sku);
    if (bom.alerts.length) bomAlerts = bom.alerts;
  }
  return { order, bomAlerts };
}

export async function saveCrop(
  db: D1Database,
  orderId: string,
  cropData: string
): Promise<{ order?: OrderRow; error?: string }> {
  const res = await db
    .prepare(`UPDATE orders SET crop_data = ?, updated_at = datetime('now', 'localtime') WHERE order_id = ?`)
    .bind(cropData, orderId)
    .run();
  if ((res.meta as { changes: number }).changes === 0) return { error: 'NOT_FOUND' };
  return { order: await getOrderById(db, orderId) };
}

export async function savePrintUrl(
  db: D1Database,
  orderId: string,
  printUrl: string
): Promise<{ order?: OrderRow; error?: string }> {
  const res = await db
    .prepare(`UPDATE orders SET print_url = ?, updated_at = datetime('now', 'localtime') WHERE order_id = ?`)
    .bind(printUrl, orderId)
    .run();
  if ((res.meta as { changes: number }).changes === 0) return { error: 'NOT_FOUND' };
  return { order: await getOrderById(db, orderId) };
}

/**
 * 图片内联存储（替代 R2）
 */
export async function saveImage(db: D1Database, data: string, contentType: string): Promise<number> {
  const res = await db.prepare('INSERT INTO images (data, content_type) VALUES (?, ?)').bind(data, contentType).run();
  return (res.meta as { last_row_id: number }).last_row_id;
}

export async function getImage(
  db: D1Database,
  id: number
): Promise<{ data: string; content_type: string } | null> {
  return db.prepare('SELECT data, content_type FROM images WHERE id = ?').bind(id).first<{ data: string; content_type: string }>();
}
