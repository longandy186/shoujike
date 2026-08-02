/**
 * 库存 / BOM 扣减服务（Phase 1.5）
 * - 查询物料库存
 * - 订单 COMPLETED 时按 SKU 的 BOM 自动扣减物料库存
 * - 扣减后低于安全库存时写入 inventory_alerts 预警记录
 * - 幂等：已对该订单扣减过则跳过（防止重复完成重复扣减）
 */

import { db } from '../db';
import { getProductBySku } from './sku.service';

export interface MaterialRow {
  material_id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  safety_stock: number;
}

/** 查询全部物料库存 */
export function getInventory(): MaterialRow[] {
  return db.prepare('SELECT * FROM materials ORDER BY material_id').all() as MaterialRow[];
}

/** 查询单物料库存 */
export function getMaterial(materialId: string): MaterialRow | undefined {
  return db.prepare('SELECT * FROM materials WHERE material_id = ?').get(materialId) as MaterialRow | undefined;
}

/** 判断某订单是否已完成 BOM 扣减（幂等检查） */
export function hasConsumed(orderId: string): boolean {
  const row = db.prepare('SELECT 1 FROM bom_consumption_log WHERE order_id = ? LIMIT 1').get(orderId);
  return !!row;
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
