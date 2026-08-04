/**
 * 通知用 Durable Object 宿主 Worker。
 * 路由 /websocket、/broadcast 到 OrderNotifier DO。/_selftest 用于诊断 DO 调用 API。
 */
import { OrderNotifier } from './order-notifier';

export { OrderNotifier };

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/websocket') || url.pathname.endsWith('/broadcast')) {
      try {
        const id = env.Notifier.idFromName('global');
        const stub = env.Notifier.get(id);
        return await stub.fetch(request);
      } catch (e) {
        return new Response('WORKER_ERR: ' + (e instanceof Error ? e.message : String(e)), {
          status: 500,
        });
      }
    }
    return new Response('ai-cc-prod-notifier worker', { status: 200 });
  },
};
