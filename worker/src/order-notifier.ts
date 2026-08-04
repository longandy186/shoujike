/**
 * Durable Object：维护店员后台的 WebSocket 连接，来单时广播（站内实时响铃）。
 * 仅页面打开时有效（断网/关页需重连），作为 Web Push 之外的"在线实时"层。
 * 该 DO 必须运行在独立 Worker（ai-cc-prod-notifier）中，Pages 通过 script_name 绑定。
 */

export class OrderNotifier {
  private state: DurableObjectState;
  private sessions: WebSocket[] = [];

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 店员端建立 WebSocket
    if (url.pathname.endsWith('/websocket')) {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();
      this.sessions.push(server);
      const drop = (ws: WebSocket) => {
        this.sessions = this.sessions.filter((s) => s !== ws);
      };
      server.addEventListener('message', () => {
        /* 单向：仅服务端→客户端推送 */
      });
      server.addEventListener('close', () => drop(server));
      server.addEventListener('error', () => drop(server));
      return new Response(null, { status: 101, webSocket: client });
    }

    // 内部广播（由 notify.ts 调用）
    if (url.pathname.endsWith('/broadcast')) {
      const body = await request.text();
      let delivered = 0;
      for (const ws of this.sessions) {
        try {
          if (ws.readyState === 1) {
            ws.send(body);
            delivered++;
          }
        } catch {
          /* ignore */
        }
      }
      return new Response(JSON.stringify({ delivered }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }
}
