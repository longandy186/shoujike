/**
 * 订单路由
 * 处理订单创建和查询
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, OrderStatus, OrderSource } from '../db';

const router = Router();

/** POST /api/orders — 创建新订单 */
router.post('/orders', (req: Request, res: Response) => {
  try {
    const {
      customerName = '',
      imageUrl = '',
      masterSku = '',
      source = OrderSource.OFFLINE,
      storeId = '',
    } = req.body;

    // 参数校验
    if (!imageUrl) {
      return res.status(400).json({ error: 'MISSING_IMAGE', message: '请上传图片' });
    }

    const orderId = uuidv4();

    // 生成4位取件码（今日范围内唯一，0点自动重置）
    let pickupCode = '';
    for (let i = 0; i < 20; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const exists = db.prepare(
        "SELECT id FROM orders WHERE pickup_code = ? AND date(created_at) = date('now', 'localtime')"
      ).get(code);
      if (!exists) {
        pickupCode = code;
        break;
      }
    }
    if (!pickupCode) {
      return res.status(500).json({ error: 'CODE_FAILED', message: '取件码生成失败，请重试' });
    }

    const stmt = db.prepare(`
      INSERT INTO orders (order_id, pickup_code, customer_name, source, store_id, master_sku, image_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      orderId,
      pickupCode,
      customerName,
      source,
      storeId,
      masterSku,
      imageUrl,
      OrderStatus.NEW
    );

    // 查询刚创建的订单
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);

    console.log(`[Order] 新订单: ${orderId}`);

    res.status(201).json({ ok: true, data: order });
  } catch (err) {
    console.error('[Order] 创建失败:', err);
    res.status(500).json({ error: 'CREATE_FAILED', message: '订单创建失败' });
  }
});

/** GET /api/orders — 获取订单列表（店员后台用） */
router.get('/orders', (_req: Request, res: Response) => {
  try {
    const orders = db.prepare(
      'SELECT * FROM orders ORDER BY created_at DESC'
    ).all();

    res.json({ ok: true, data: orders });
  } catch (err) {
    console.error('[Order] 查询失败:', err);
    res.status(500).json({ error: 'QUERY_FAILED', message: '订单查询失败' });
  }
});

/** GET /api/orders/code/:code — 按取件码查询（今日范围内） */
router.get('/orders/code/:code', (req: Request, res: Response) => {
  try {
    const order = db.prepare(
      "SELECT * FROM orders WHERE pickup_code = ? AND date(created_at) = date('now', 'localtime') ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.code);

    if (!order) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '未找到该取件码对应的订单' });
    }

    res.json({ ok: true, data: order });
  } catch (err) {
    console.error('[Order] 查询失败:', err);
    res.status(500).json({ error: 'QUERY_FAILED', message: '订单查询失败' });
  }
});

/** GET /api/orders/:orderId — 获取单个订单 */
router.get('/orders/:orderId', (req: Request, res: Response) => {
  try {
    const order = db.prepare(
      'SELECT * FROM orders WHERE order_id = ?'
    ).get(req.params.orderId);

    if (!order) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '订单不存在' });
    }

    res.json({ ok: true, data: order });
  } catch (err) {
    console.error('[Order] 查询失败:', err);
    res.status(500).json({ error: 'QUERY_FAILED', message: '订单查询失败' });
  }
});

/** PATCH /api/orders/:orderId/status — 更新订单状态 */
router.patch('/orders/:orderId/status', (req: Request, res: Response) => {
  try {
    const { status } = req.body;

    if (!Object.values(OrderStatus).includes(status)) {
      return res.status(400).json({ error: 'INVALID_STATUS', message: '无效的订单状态' });
    }

    const result = db.prepare(
      "UPDATE orders SET status = ?, updated_at = datetime('now', 'localtime') WHERE order_id = ?"
    ).run(status, req.params.orderId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '订单不存在' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);

    res.json({ ok: true, data: order });
  } catch (err) {
    console.error('[Order] 更新失败:', err);
    res.status(500).json({ error: 'UPDATE_FAILED', message: '状态更新失败' });
  }
});

/** PATCH /api/orders/:orderId/crop — 保存裁剪参数 */
router.patch('/orders/:orderId/crop', (req: Request, res: Response) => {
  try {
    const { cropData } = req.body;

    if (!cropData) {
      return res.status(400).json({ error: 'MISSING_DATA', message: '请提供裁剪参数' });
    }

    const cropJson = typeof cropData === 'string' ? cropData : JSON.stringify(cropData);

    const result = db.prepare(
      "UPDATE orders SET crop_data = ?, updated_at = datetime('now', 'localtime') WHERE order_id = ?"
    ).run(cropJson, req.params.orderId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '订单不存在' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);

    console.log(`[Order] 裁剪参数已保存: ${req.params.orderId}`);

    res.json({ ok: true, data: order });
  } catch (err) {
    console.error('[Order] 保存裁剪参数失败:', err);
    res.status(500).json({ error: 'UPDATE_FAILED', message: '裁剪参数保存失败' });
  }
});

export default router;
