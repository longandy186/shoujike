/**
 * 库存管理路由（Phase 1.5）
 * 提供库存总览 / 低库存预警 / 采购入库 API。
 */

import { Router, Request, Response } from 'express';
import { getInventorySummary, getActiveAlerts, stockIn } from '../services/inventory.service';

const router = Router();

/** GET /api/inventory/summary — 库存总览（物料+可生产数量+预警） */
router.get('/inventory/summary', (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: getInventorySummary() });
  } catch {
    res.status(500).json({ error: 'QUERY_FAILED', message: '库存查询失败' });
  }
});

/** GET /api/inventory/alerts — 活跃低库存预警 */
router.get('/inventory/alerts', (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: getActiveAlerts() });
  } catch {
    res.status(500).json({ error: 'QUERY_FAILED', message: '预警查询失败' });
  }
});

/** POST /api/inventory/stock-in — 采购入库 */
router.post('/inventory/stock-in', (req: Request, res: Response) => {
  try {
    const { materialId, qty, note } = req.body || {};
    if (!materialId || !Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: 'INVALID_PARAM', message: '请提供有效的物料与正整数入库数量' });
    }
    const result = stockIn(String(materialId), Number(qty), note || '');
    if (!result.ok) {
      return res.status(400).json({ error: 'STOCK_IN_FAILED', message: result.error });
    }
    res.json({ ok: true, data: result.material });
  } catch (err) {
    const message = err instanceof Error ? err.message : '入库失败';
    res.status(500).json({ error: 'STOCK_IN_FAILED', message });
  }
});

export default router;
