/**
 * Hono 路由注册 —— 将原有 Express 路由移植到 Pages Functions。
 * 所有 /api/* 请求由 functions/api/[[route]].ts 转发至此。
 * DB 用 D1（异步），图片内联存 D1（Base64，免去 R2 订阅）。
 */
import { Hono } from 'hono';
import type { Env } from './types';
import * as db from './db';
import { putImage, getObject } from './r2';
import { getEnabledProducts, getAllProducts, getProductBySku, getAllMaterials } from './sku';

const VALID_STATUS = ['NEW', 'WAITING_CHECK', 'READY_PRINT', 'PRINTED', 'PROCESSING', 'COMPLETED'];
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_UPLOAD = 20 * 1024 * 1024;

export function registerRoutes(app: Hono<{ Bindings: Env }>) {
  // ---------- 健康检查 ----------
  app.get('/api/health', (c) =>
    c.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0, env: 'cloudflare' })
  );
  app.get('/api/ping', (c) => c.json({ message: 'pong', timestamp: Date.now() }));

  // ---------- 图片上传 ----------
  app.post('/api/upload', async (c) => {
    try {
      const form = await c.req.parseBody();
      const file = form['image'];
      if (!(file instanceof File)) return c.json({ ok: false, error: 'NO_FILE', message: '请上传图片' }, 400);
      if (!ALLOWED_IMAGE.includes(file.type)) return c.json({ ok: false, error: 'INVALID_TYPE', message: '仅支持 JPG/PNG/WebP/GIF' }, 400);
      if (file.size > MAX_UPLOAD) return c.json({ ok: false, error: 'FILE_TOO_LARGE', message: '文件大小不能超过 20MB' }, 400);

      const id = await putImage(c.env.DB, await file.arrayBuffer(), file.type || 'image/jpeg');
      return c.json({
        ok: true,
        data: { filename: String(id), originalName: file.name, size: file.size, url: `/api/files/${id}` },
      });
    } catch (e) {
      return c.json({ ok: false, error: 'UPLOAD_ERROR', message: msg(e) }, 400);
    }
  });

  // ---------- 订单 ----------
  app.post('/api/orders', async (c) => {
    try {
      const body = await c.req.json<{ imageUrl?: string; customerName?: string; masterSku?: string; source?: string; storeId?: string }>();
      if (!body.imageUrl) return c.json({ ok: false, error: 'MISSING_IMAGE', message: '请上传图片' }, 400);
      const r = await db.createOrder(c.env.DB, body);
      if (r.error) return c.json({ ok: false, error: 'CODE_FAILED', message: '取件码生成失败，请重试' }, 500);
      return c.json({ ok: true, data: r.order }, 201);
    } catch (e) {
      return c.json({ ok: false, error: 'CREATE_FAILED', message: msg(e) }, 500);
    }
  });

  app.get('/api/orders', async (c) => {
    try {
      return c.json({ ok: true, data: await db.getOrders(c.env.DB) });
    } catch (e) {
      return c.json({ ok: false, error: 'QUERY_FAILED', message: msg(e) }, 500);
    }
  });

  app.get('/api/orders/code/:code', async (c) => {
    try {
      const order = await db.getOrderByCode(c.env.DB, c.req.param('code'));
      if (!order) return c.json({ ok: false, error: 'NOT_FOUND', message: '未找到该取件码对应的订单' }, 404);
      return c.json({ ok: true, data: order });
    } catch (e) {
      return c.json({ ok: false, error: 'QUERY_FAILED', message: msg(e) }, 500);
    }
  });

  app.get('/api/orders/:orderId', async (c) => {
    try {
      const order = await db.getOrderById(c.env.DB, c.req.param('orderId'));
      if (!order) return c.json({ ok: false, error: 'NOT_FOUND', message: '订单不存在' }, 404);
      return c.json({ ok: true, data: order });
    } catch (e) {
      return c.json({ ok: false, error: 'QUERY_FAILED', message: msg(e) }, 500);
    }
  });

  app.patch('/api/orders/:orderId/status', async (c) => {
    try {
      const body = await c.req.json<{ status?: string }>();
      const status = body.status;
      if (!status || !VALID_STATUS.includes(status)) return c.json({ ok: false, error: 'INVALID_STATUS', message: '无效的订单状态' }, 400);
      const r = await db.updateOrderStatus(c.env.DB, c.req.param('orderId'), status);
      if (r.error === 'NOT_FOUND') return c.json({ ok: false, error: 'NOT_FOUND', message: '订单不存在' }, 404);
      return c.json({ ok: true, data: r.order, alerts: r.bomAlerts });
    } catch (e) {
      return c.json({ ok: false, error: 'UPDATE_FAILED', message: msg(e) }, 500);
    }
  });

  app.patch('/api/orders/:orderId/crop', async (c) => {
    try {
      const body = await c.req.json<{ cropData?: unknown }>();
      if (!body.cropData) return c.json({ ok: false, error: 'MISSING_DATA', message: '请提供裁剪参数' }, 400);
      const cropJson = typeof body.cropData === 'string' ? body.cropData : JSON.stringify(body.cropData);
      const r = await db.saveCrop(c.env.DB, c.req.param('orderId'), cropJson);
      if (r.error === 'NOT_FOUND') return c.json({ ok: false, error: 'NOT_FOUND', message: '订单不存在' }, 404);
      return c.json({ ok: true, data: r.order });
    } catch (e) {
      return c.json({ ok: false, error: 'UPDATE_FAILED', message: msg(e) }, 500);
    }
  });

  app.post('/api/orders/:orderId/print', async (c) => {
    try {
      const form = await c.req.parseBody();
      const file = form['image'];
      if (!(file instanceof File)) return c.json({ ok: false, error: 'NO_FILE', message: '请提供打印图' }, 400);
      const id = await putImage(c.env.DB, await file.arrayBuffer(), 'image/jpeg');
      const r = await db.savePrintUrl(c.env.DB, c.req.param('orderId'), `/api/files/${id}`);
      if (r.error === 'NOT_FOUND') return c.json({ ok: false, error: 'NOT_FOUND', message: '订单不存在' }, 404);
      return c.json({ ok: true, data: r.order }, 201);
    } catch (e) {
      return c.json({ ok: false, error: 'UPLOAD_ERROR', message: msg(e) }, 400);
    }
  });

  // ---------- SKU 主数据 ----------
  app.get('/api/skus', (c) => c.json({ ok: true, data: getEnabledProducts() }));
  app.get('/api/skus/all', (c) => c.json({ ok: true, data: getAllProducts() }));
  app.get('/api/skus/:masterSku', (c) => {
    const p = getProductBySku(c.req.param('masterSku'));
    if (!p) return c.json({ ok: false, error: 'NOT_FOUND', message: '未找到该 SKU' }, 404);
    return c.json({ ok: true, data: p });
  });
  app.get('/api/materials', async (c) => {
    try {
      return c.json({ ok: true, data: await db.getInventory(c.env.DB) });
    } catch (e) {
      return c.json({ ok: false, error: 'QUERY_FAILED', message: msg(e) }, 500);
    }
  });
  app.get('/api/materials/all', (c) => c.json({ ok: true, data: getAllMaterials() }));

  // ---------- 库存 ----------
  app.get('/api/inventory/summary', async (c) => {
    try {
      return c.json({ ok: true, data: await db.getInventorySummary(c.env.DB) });
    } catch (e) {
      return c.json({ ok: false, error: 'QUERY_FAILED', message: msg(e) }, 500);
    }
  });
  app.get('/api/inventory/alerts', async (c) => {
    try {
      return c.json({ ok: true, data: await db.getActiveAlerts(c.env.DB) });
    } catch (e) {
      return c.json({ ok: false, error: 'QUERY_FAILED', message: msg(e) }, 500);
    }
  });
  app.post('/api/inventory/stock-in', async (c) => {
    try {
      const body = await c.req.json<{ materialId?: string; qty?: number; note?: string }>();
      if (!body.materialId || !Number.isInteger(body.qty) || (body.qty as number) <= 0) {
        return c.json({ ok: false, error: 'INVALID_PARAM', message: '请提供有效的物料与正整数入库数量' }, 400);
      }
      const r = await db.stockIn(c.env.DB, String(body.materialId), Number(body.qty), body.note || '');
      if (!r.ok) return c.json({ ok: false, error: 'STOCK_IN_FAILED', message: r.error }, 400);
      return c.json({ ok: true, data: r.material });
    } catch (e) {
      return c.json({ ok: false, error: 'STOCK_IN_FAILED', message: msg(e) }, 500);
    }
  });

  // ---------- R2 文件服务（同源，避免 CORS） ----------
  app.get('/api/files/*', async (c) => {
    const key = c.req.path.replace('/api/files/', '');
    const obj = await getObject(c.env.DB, key);
    if (!obj) return new Response('Not found', { status: 404 });
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  });
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
