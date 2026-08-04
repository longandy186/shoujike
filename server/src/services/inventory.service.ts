/**
 * 库存 / BOM 扣减服务（Phase 1.5）
 * - 查询物料库存
 * - 订单 COMPLETED 时按 SKU 的 BOM 自动扣减物料库存（写 OUT 流水）
 * - 扣减后低于安全库存时写入 inventory_alerts 预警记录
 * - 采购入库（stock-in）写 IN 流水
 * - 库存统计：已使用数量 = 历史 OUT 流水之和
 * - 可生产数量：按 BOM 计算各产品当前最大可产件数
 * - 幂等：已对该订单扣减过则跳过（防止重复完成重复扣减）
 */

import { db } from '../db';
import { getProductBySku, getAllProducts, getEnabledProducts } from './sku.service';

export interface MaterialRow {
  material_id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  safety_stock: number;
}

export type TxType = 'IN' | 'OUT' | 'ADJUST';

export interface InventoryTx {
  id: number;
  material_id: string;
  material_name: string;
  type: TxType;
  qty: number;
  ref: string;
  note: string;
  created_at: string;
}

export interface MaterialWithStats extends MaterialRow {
  /** 历史已使用数量（OUT 流水之和） */
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
  /** 当前最大可生产件数 */
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

/** 查询全部物料库存 */
export function getInventory(): MaterialRow[] {
  return db.prepare('SELECT * FROM materials ORDER BY material_id').all() as MaterialRow[];
}

/** 查询单物料库存 */
export function getMaterial(materialId: string): MaterialRow | undefined {
  return db.prepare('SELECT * FROM materials WHERE material_id = ?').get(materialId) as MaterialRow | undefined;
}

/** 写入一条库存流水 */
export function logTransaction(materialId: string, type: TxType, qty: number, ref = '', note = ''): void {
  const mat = getMaterial(materialId);
  const name = mat?.name ?? materialId;
  db.prepare(`
    INSERT INTO inventory_transactions (material_id, material_name, type, qty, ref, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(materialId, name, type, qty, ref, note);
}

/** 历史已使用数量（OUT 流水之和） */
export function getUsedCount(materialId: string): number {
  const row = db.prepare(
    "SELECT COALESCE(SUM(qty), 0) AS total FROM inventory_transactions WHERE material_id = ? AND type = 'OUT'"
  ).get(materialId) as { total: number };
  return row.total;
}

/** 判断某订单是否已完成 BOM 扣减（幂等检查） */
export function hasConsumed(orderId: string): boolean {
  const row = db.prepare('SELECT 1 FROM bom_consumption_log WHERE order_id = ? LIMIT 1').get(orderId);
  return !!row;
}

/**
 * 采购入库（手动入库）
 * 增加 current_stock 并写一条 IN 流水。
 */
export function stockIn(
  materialId: string,
  qty: number,
  note = ''
): { ok: boolean; material?: MaterialRow; error?: string } {
  if (!materialId) return { ok: false, error: '缺少 materialId' };
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: '入库数量必须为正整数' };
  const mat = getMaterial(materialId);
  if (!mat) return { ok: false, error: `未知物料: ${materialId}` };

  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE materials SET current_stock = current_stock + ?, updated_at = datetime('now', 'localtime') WHERE material_id = ?"
    ).run(qty, materialId);
    logTransaction(materialId, 'IN', qty, '', note || '采购入库');
  });
  try {
    tx();
  } catch (err) {
    const message = err instanceof Error ? err.message : '入库失败';
    return { ok: false, error: message };
  }
  return { ok: true, material: getMaterial(materialId) };
}

/**
 * 订单完成时扣减 BOM 物料
 * @returns { ok, consumed, alerts, error }
 */
export function consumeBom(
  orderId: string,
  masterSku: string
): { ok: boolean; consumed: boolean; alerts: string[]; error?: string } {
  // 幂等：已扣减则跳过
  if (hasConsumed(orderId)) {
    return { ok: true, consumed: false, alerts: [] };
  }

  const product = getProductBySku(masterSku);
  if (!product) {
    return { ok: false, consumed: false, alerts: [], error: `未知 SKU: ${masterSku}` };
  }

  if (!product.bom || product.bom.length === 0) {
    return { ok: true, consumed: false, alerts: [] };
  }

  const alerts: string[] = [];

  const tx = db.transaction(() => {
    const insertLog = db.prepare(`
      INSERT INTO bom_consumption_log (order_id, master_sku, material_id, qty)
      VALUES (?, ?, ?, ?)
    `);
    const updateMaterial = db.prepare(`
      UPDATE materials
      SET current_stock = current_stock - ?, updated_at = datetime('now', 'localtime')
      WHERE material_id = ?
    `);
    const getMaterial = db.prepare(`SELECT * FROM materials WHERE material_id = ?`);

    for (const item of product.bom) {
      // 扣减库存（可能因库存不足变负，但允许记录，便于发现缺料）
      updateMaterial.run(item.qty, item.materialId);
      insertLog.run(orderId, masterSku, item.materialId, item.qty);
      // 写 OUT 流水（用于库存统计）
      logTransaction(item.materialId, 'OUT', item.qty, orderId, '订单完成扣减');

      const mat = getMaterial.get(item.materialId) as MaterialRow | undefined;
      if (mat && mat.current_stock < mat.safety_stock) {
        // 写入低库存预警
        db.prepare(`
          INSERT INTO inventory_alerts (material_id, material_name, remaining, safety_stock)
          VALUES (?, ?, ?, ?)
        `).run(mat.material_id, mat.name, mat.current_stock, mat.safety_stock);

        alerts.push(`⚠️ ${mat.name}(${mat.material_id}) 库存剩 ${mat.current_stock}，低于安全线 ${mat.safety_stock}`);
      }
    }
  });

  try {
    tx();
  } catch (err) {
    const message = err instanceof Error ? err.message : '库存扣减失败';
    return { ok: false, consumed: false, alerts: [], error: message };
  }

  return { ok: true, consumed: true, alerts };
}

/**
 * 计算各启用产品的可生产数量（按 BOM 取最小瓶颈）
 */
export function getProductCapacities(): ProductCapacity[] {
  const products = getEnabledProducts();
  return products.map((p) => {
    const bom: BomCapacity[] = (p.bom || []).map((item) => {
      const mat = getMaterial(item.materialId);
      const have = mat?.current_stock ?? 0;
      const need = item.qty;
      return {
        materialId: item.materialId,
        name: mat?.name ?? item.materialId,
        need,
        have,
        enough: have >= need,
      };
    });
    let producible = Infinity;
    for (const b of bom) {
      if (b.need <= 0) continue;
      producible = Math.min(producible, Math.floor(b.have / b.need));
    }
    if (bom.length === 0) producible = 0;
    if (!isFinite(producible)) producible = 0;
    return {
      masterSku: p.masterSku,
      name: p.name,
      producible,
      bom,
    };
  });
}

/**
 * 当前活跃的低库存预警（按物料去重，取最近一条）
 */
export function getActiveAlerts(): ActiveAlert[] {
  const rows = db.prepare(`
    SELECT material_id, material_name, remaining, safety_stock, created_at
    FROM inventory_alerts
    WHERE material_id NOT IN (
      SELECT material_id FROM materials WHERE current_stock >= safety_stock
    )
    ORDER BY created_at DESC
  `).all() as ActiveAlert[];

  // 去重：同一物料只保留最新一条
  const seen = new Set<string>();
  const dedup: ActiveAlert[] = [];
  for (const r of rows) {
    if (seen.has(r.material_id)) continue;
    seen.add(r.material_id);
    dedup.push(r);
  }
  return dedup;
}

/** 库存总览（供前端库存页一次性拉取） */
export function getInventorySummary(): InventorySummary {
  const materials: MaterialWithStats[] = getInventory().map((m) => ({
    ...m,
    used: getUsedCount(m.material_id),
  }));
  return {
    materials,
    products: getProductCapacities(),
    alerts: getActiveAlerts(),
  };
}
