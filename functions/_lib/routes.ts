/**
 * Hono 路由注册 —— 将原有 Express 路由移植到 Pages Functions。
 * 所有 /api/* 请求由 functions/api/[[route]].ts 转发至此。
 * DB 用 D1（异步），图片存 R2 对象存储。
 */
import { Hono } from 'hono';
import type { Env } from './types';
import * as db from './db';
import { putImage, getObject } from './r2';
import { getEnabledProducts, getAllProducts, getProductBySku, getAllMaterials, ensureProductsSeeded, ensureSchema } from './sku';
import { notifyNewOrder } from './notify';
import { processWebhook } from './webhook';

const VALID_STATUS = ['NEW', 'WAITING_CHECK', 'READY_PRINT', 'PRINTED', 'PROCESSING', 'COMPLETED', 'REJECTED'];
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_UPLOAD = 20 * 1024 * 1024;

export function registerRoutes(app: Hono<{ Bindings: Env }>) {
  // ---------- schema 自愈（本地 wrangler pages dev 每次可能新建空库，确保表存在） ----------
  app.use('/api/*', async (c, next) => {
    try {
      await ensureSchema(c.env.DB);
    } catch {
      /* 自愈失败不阻断请求，交由各 handler 报错 */
    }
    await next();
  });

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

      const key = await putImage(c.env.BUCKET, await file.arrayBuffer(), file.type || 'image/jpeg');
      return c.json({
        ok: true,
        data: { filename: key, originalName: file.name, size: file.size, url: `/api/files/${key}` },
      });
    } catch (e) {
      return c.json({ ok: false, error: 'UPLOAD_ERROR', message: msg(e) }, 400);
    }
  });

  // ---------- 订单 ----------
  app.post('/api/orders', async (c) => {
    try {
      const body = await c.req.json<{
        imageUrl?: string;
        masterSku?: string;
        customerName?: string;
        customerPhone?: string;
        language?: string;
        source?: string;
        storeId?: string;
        totalRsd?: number;
        totalEur?: number;
        items?: { masterSku: string; imageUrl: string; previewUrl?: string; crop?: unknown }[];
      }>();
      // 多商品（V2 游客购物车）或单品（兼容）
      const hasItems = Array.isArray(body.items) && body.items.length > 0;
      const singleOk = !!body.imageUrl;
      if (!hasItems && !singleOk) {
        return c.json({ ok: false, error: 'MISSING_IMAGE', message: '请上传图片' }, 400);
      }
      const r = await db.createOrder(c.env.DB, {
        imageUrl: body.imageUrl,
        masterSku: body.masterSku,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        language: body.language,
        source: body.source,
        storeId: body.storeId,
        items: body.items,
        totalRsdOverride: typeof body.totalRsd === 'number' ? body.totalRsd : undefined,
        totalEurOverride: typeof body.totalEur === 'number' ? body.totalEur : undefined,
      });
      if (r.error) return c.json({ ok: false, error: 'CODE_FAILED', message: '取件码生成失败，请重试' }, 500);
      // 来单通知（三层：Web Push / WebSocket / Telegram）
      if (r.order) {
        await notifyNewOrder(c.env, {
          order_id: r.order.order_id,
          pickup_code: r.order.pickup_code,
          master_sku: r.order.master_sku,
        });
      }
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
      const key = await putImage(c.env.BUCKET, await file.arrayBuffer(), 'image/jpeg');
      const r = await db.savePrintUrl(c.env.DB, c.req.param('orderId'), `/api/files/${key}`);
      if (r.error === 'NOT_FOUND') return c.json({ ok: false, error: 'NOT_FOUND', message: '订单不存在' }, 404);
      return c.json({ ok: true, data: r.order }, 201);
    } catch (e) {
      return c.json({ ok: false, error: 'UPLOAD_ERROR', message: msg(e) }, 400);
    }
  });

  // ---------- 驳回（反馈闭环） ----------
  app.patch('/api/orders/:orderId/reject', async (c) => {
    try {
      const body = await c.req.json<{ reason?: string }>();
      if (!body.reason) return c.json({ ok: false, error: 'MISSING_REASON', message: '请选择驳回原因' }, 400);
      const r = await db.rejectOrder(c.env.DB, c.req.param('orderId'), body.reason);
      if (r.error === 'NOT_FOUND') return c.json({ ok: false, error: 'NOT_FOUND', message: '订单不存在' }, 404);
      return c.json({ ok: true, data: r.order });
    } catch (e) {
      return c.json({ ok: false, error: 'REJECT_FAILED', message: msg(e) }, 500);
    }
  });

  // ---------- Web Push 订阅 / VAPID 公钥 ----------
  app.get('/api/vapid-public-key', (c) =>
    c.json({ ok: true, data: { publicKey: c.env.VAPID_PUBLIC_KEY ?? '' } })
  );

  app.post('/api/push/subscribe', async (c) => {
    try {
      const body = await c.req.json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>();
      if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
        return c.json({ ok: false, error: 'BAD_SUB', message: '订阅信息不完整' }, 400);
      }
      await db.savePushSubscription(c.env.DB, {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ ok: false, error: 'SUB_FAILED', message: msg(e) }, 500);
    }
  });

  // ---------- 外部电商 Webhook（零轮询） ----------
  app.post('/api/webhook/:channel', async (c) => {
    try {
      const channel = c.req.param('channel');
      const raw = await c.req.text();
      const headers: Record<string, string | undefined> = {
        'x-shopify-hmac-sha256': c.req.header('x-shopify-hmac-sha256'),
        'x-etsy-signature': c.req.header('x-etsy-signature'),
      };
      const u = new URL(c.req.url);
      headers['x-tiktok-sign'] = u.searchParams.get('sign') ?? undefined;
      const r = await processWebhook(channel, raw, headers, c.env);
      return c.json({ ok: r.ok, error: r.error }, r.status);
    } catch (e) {
      return c.json({ ok: false, error: 'WEBHOOK_ERROR', message: msg(e) }, 500);
    }
  });

  // ---------- 商品主数据（数据驱动，来源 D1 products 表） ----------
  app.get('/api/skus', async (c) => {
    try {
      return c.json({ ok: true, data: await getEnabledProducts(c.env.DB) });
    } catch (e) {
      return c.json({ ok: false, error: 'QUERY_FAILED', message: msg(e) }, 500);
    }
  });
  app.get('/api/skus/all', async (c) => {
    try {
      return c.json({ ok: true, data: await getAllProducts(c.env.DB) });
    } catch (e) {
      return c.json({ ok: false, error: 'QUERY_FAILED', message: msg(e) }, 500);
    }
  });
  app.get('/api/skus/:masterSku', async (c) => {
    const p = await getProductBySku(c.env.DB, c.req.param('masterSku'));
    if (!p) return c.json({ ok: false, error: 'NOT_FOUND', message: '未找到该 SKU' }, 404);
    return c.json({ ok: true, data: p });
  });

  // ---------- 店员后台：商品管理（数据驱动 CRUD，无需改代码） ----------
  const requireAdmin = (c: any): boolean => {
    const key = c.req.header('x-admin-key');
    const expected = c.env.ADMIN_API_KEY;
    // 未配置密钥时（仅本地未设置），放行便于预览；生产务必配置 ADMIN_API_KEY secret
    if (!expected) return true;
    return key === expected;
  };

  app.get('/api/admin/products', async (c) => {
    try {
      return c.json({ ok: true, data: await getAllProducts(c.env.DB) });
    } catch (e) {
      return c.json({ ok: false, error: 'QUERY_FAILED', message: msg(e) }, 500);
    }
  });

  app.post('/api/admin/products', async (c) => {
    try {
      if (!requireAdmin(c)) return c.json({ ok: false, error: 'FORBIDDEN', message: '无权限' }, 403);
      const b = await c.req.json<any>();
      const sku = b.masterSku || b.sku;
      if (!sku) return c.json({ ok: false, error: 'MISSING_SKU', message: 'SKU 必填' }, 400);
      const existing = await c.env.DB.prepare('SELECT sku FROM products WHERE sku = ?').bind(sku).first();
      if (existing) return c.json({ ok: false, error: 'DUP_SKU', message: 'SKU 已存在' }, 409);
      await c.env.DB
        .prepare(
          `INSERT INTO products
           (id, sku, category, name_zh, name_en, name_sr, desc_zh, desc_en, desc_sr,
            image_url, mockup_asset_url, print_area, physical_size, bleed, print_technique,
            price_rsd, price_eur, stock, safe_zone_mm, copies, bom, enabled, sort_order)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(
          crypto.randomUUID(),
          sku,
          b.category || '',
          b.name_zh || b.name || '',
          b.name_en || '',
          b.name_sr || '',
          b.desc_zh || b.description || '',
          b.desc_en || '',
          b.desc_sr || '',
          b.image_url || '',
          b.mockup_asset_url || '',
          JSON.stringify(b.print_area || {}),
          JSON.stringify(b.physical_size || {}),
          Number(b.bleed) || 0,
          b.print_technique || 'direct_insert',
          Number(b.price_rsd) || 0,
          Number(b.price_eur) || 0,
          Number(b.stock) || 0,
          Number(b.safeZoneMm ?? b.safe_zone_mm) || 0,
          Number(b.copies) || 1,
          JSON.stringify(b.bom || []),
          b.enabled === false ? 0 : 1,
          Number(b.sort_order) || 0
        )
        .run();
      const p = await getProductBySku(c.env.DB, sku);
      return c.json({ ok: true, data: p }, 201);
    } catch (e) {
      return c.json({ ok: false, error: 'CREATE_FAILED', message: msg(e) }, 500);
    }
  });

  app.put('/api/admin/products/:sku', async (c) => {
    try {
      if (!requireAdmin(c)) return c.json({ ok: false, error: 'FORBIDDEN', message: '无权限' }, 403);
      const sku = c.req.param('sku');
      const b = await c.req.json<any>();
      const exists = await c.env.DB.prepare('SELECT sku FROM products WHERE sku = ?').bind(sku).first();
      if (!exists) return c.json({ ok: false, error: 'NOT_FOUND', message: '商品不存在' }, 404);
      const sets: string[] = [];
      const vals: any[] = [];
      const map: Record<string, any> = {
        category: b.category,
        name_zh: b.name_zh ?? b.name,
        name_en: b.name_en,
        name_sr: b.name_sr,
        desc_zh: b.desc_zh ?? b.description,
        desc_en: b.desc_en,
        desc_sr: b.desc_sr,
        image_url: b.image_url,
        mockup_asset_url: b.mockup_asset_url,
        print_area: b.print_area != null ? JSON.stringify(b.print_area) : undefined,
        physical_size: b.physical_size != null ? JSON.stringify(b.physical_size) : undefined,
        bleed: b.bleed != null ? Number(b.bleed) : undefined,
        print_technique: b.print_technique,
        price_rsd: b.price_rsd != null ? Number(b.price_rsd) : undefined,
        price_eur: b.price_eur != null ? Number(b.price_eur) : undefined,
        stock: b.stock != null ? Number(b.stock) : undefined,
        safe_zone_mm: (b.safeZoneMm ?? b.safe_zone_mm) != null ? Number(b.safeZoneMm ?? b.safe_zone_mm) : undefined,
        copies: b.copies != null ? Number(b.copies) : undefined,
        bom: b.bom != null ? JSON.stringify(b.bom) : undefined,
        enabled: b.enabled != null ? (b.enabled ? 1 : 0) : undefined,
        sort_order: b.sort_order != null ? Number(b.sort_order) : undefined,
      };
      for (const [col, val] of Object.entries(map)) {
        if (val !== undefined) {
          sets.push(`${col} = ?`);
          vals.push(val);
        }
      }
      if (sets.length === 0) return c.json({ ok: true, data: await getProductBySku(c.env.DB, sku) });
      sets.push(`updated_at = datetime('now')`);
      await c.env.DB
        .prepare(`UPDATE products SET ${sets.join(', ')} WHERE sku = ?`)
        .bind(...vals, sku)
        .run();
      return c.json({ ok: true, data: await getProductBySku(c.env.DB, sku) });
    } catch (e) {
      return c.json({ ok: false, error: 'UPDATE_FAILED', message: msg(e) }, 500);
    }
  });

  app.delete('/api/admin/products/:sku', async (c) => {
    try {
      if (!requireAdmin(c)) return c.json({ ok: false, error: 'FORBIDDEN', message: '无权限' }, 403);
      const sku = c.req.param('sku');
      await c.env.DB.prepare('DELETE FROM products WHERE sku = ?').bind(sku).run();
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ ok: false, error: 'DELETE_FAILED', message: msg(e) }, 500);
    }
  });

  // 入库（调整库存）
  app.post('/api/admin/products/:sku/stock-in', async (c) => {
    try {
      if (!requireAdmin(c)) return c.json({ ok: false, error: 'FORBIDDEN', message: '无权限' }, 403);
      const sku = c.req.param('sku');
      const b = await c.req.json<{ qty?: number; note?: string }>();
      const n = Number(b.qty);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        return c.json({ ok: false, error: 'INVALID_QTY', message: '请输入正整数入库数量' }, 400);
      }
      const r = await c.env.DB.prepare(
        'UPDATE products SET stock = stock + ?, updated_at = datetime(\'now\') WHERE sku = ?'
      ).bind(n, sku).run();
      if (!r.success) return c.json({ ok: false, error: 'STOCK_IN_FAILED', message: '入库失败' }, 400);
      const p = await getProductBySku(c.env.DB, sku);
      return c.json({ ok: true, data: p });
    } catch (e) {
      return c.json({ ok: false, error: 'STOCK_IN_FAILED', message: msg(e) }, 500);
    }
  });

  // 商品图片上传（R2），返回可访问 URL
  app.post('/api/admin/products/image', async (c) => {
    try {
      if (!requireAdmin(c)) return c.json({ ok: false, error: 'FORBIDDEN', message: '无权限' }, 403);
      const form = await c.req.parseBody();
      const file = form['image'];
      if (!(file instanceof File)) return c.json({ ok: false, error: 'NO_FILE', message: '请上传图片' }, 400);
      if (!ALLOWED_IMAGE.includes(file.type)) return c.json({ ok: false, error: 'INVALID_TYPE', message: '仅支持 JPG/PNG/WebP/GIF' }, 400);
      if (file.size > MAX_UPLOAD) return c.json({ ok: false, error: 'FILE_TOO_LARGE', message: '文件大小不能超过 20MB' }, 400);
      const key = await putImage(c.env.BUCKET, await file.arrayBuffer(), file.type || 'image/jpeg');
      return c.json({ ok: true, data: { url: `/api/files/${key}` } });
    } catch (e) {
      return c.json({ ok: false, error: 'UPLOAD_ERROR', message: msg(e) }, 400);
    }
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
    const obj = await getObject(c.env.BUCKET, key);
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
