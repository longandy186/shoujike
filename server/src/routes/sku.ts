/**
 * SKU 主数据路由（Phase 1.5）
 * 提供产品列表 / 单个产品 / 物料库存查询。
 */

import { Router, Request, Response } from 'express';
import { getEnabledProducts, getProductBySku, getAllProducts, getAllMaterials } from '../services/sku.service';
import { getInventory } from '../services/inventory.service';

const router = Router();

/** GET /api/skus — 启用中的产品（游客端选品用） */
router.get('/skus', (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: getEnabledProducts() });
  } catch (err) {
    res.status(500).json({ error: 'QUERY_FAILED', message: 'SKU 查询失败' });
  }
});

/** GET /api/skus/all — 全部产品（含禁用，管理用） */
router.get('/skus/all', (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: getAllProducts() });
  } catch {
    res.status(500).json({ error: 'QUERY_FAILED', message: 'SKU 查询失败' });
  }
});

/** GET /api/skus/:masterSku — 单个产品详情 */
router.get('/skus/:masterSku', (req: Request, res: Response) => {
  try {
    const product = getProductBySku(String(req.params.masterSku));
    if (!product) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '未找到该 SKU' });
    }
    res.json({ ok: true, data: product });
  } catch {
    res.status(500).json({ error: 'QUERY_FAILED', message: 'SKU 查询失败' });
  }
});

/** GET /api/materials — 物料库存列表 */
router.get('/materials', (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: getInventory() });
  } catch {
    res.status(500).json({ error: 'QUERY_FAILED', message: '物料查询失败' });
  }
});

/** GET /api/materials/all — 物料主数据（含未建库存的） */
router.get('/materials/all', (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: getAllMaterials() });
  } catch {
    res.status(500).json({ error: 'QUERY_FAILED', message: '物料查询失败' });
  }
});

export default router;
