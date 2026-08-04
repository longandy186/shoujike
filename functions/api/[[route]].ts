/**
 * Pages Functions 入口：捕获所有 /api/* 请求，转发给 Hono 应用。
 * 前端同源调用 /api/*，由本文件统一处理后端的 D1 + R2 逻辑。
 */
import { Hono } from 'hono';
import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_lib/types';
import { registerRoutes } from '../_lib/routes';

const app = new Hono<{ Bindings: Env }>();
registerRoutes(app);

export const onRequest: PagesFunction<Env> = (ctx) => {
  return app.fetch(ctx.request, ctx.env, ctx);
};
