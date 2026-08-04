/**
 * 通知用 Durable Object 宿主 Worker。
 * Pages 函数通过 script_name=ai-cc-prod-notifier + class_name=OrderNotifier 绑定本 Worker 的 DO。
 * 本 Worker 的默认 fetch 不直接处理业务，所有请求由 OrderNotifier 接管。
 */
import { OrderNotifier } from './order-notifier';

export { OrderNotifier };

export default {
  async fetch(): Promise<Response> {
    return new Response('ai-cc-prod-notifier worker', { status: 200 });
  },
};
