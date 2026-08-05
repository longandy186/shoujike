/**
 * Durable Object：维护店员后台的 WebSocket 连接，来单时广播（站内实时响铃）。
 * 按 id ('global') 路由到单一实例，解决普通 Worker 多实例时广播送不到连接的问题。
 */
export class OrderNotifier {
  private state: DurableObjectState;
  private sessions: WebSocket[] = [];

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/websocket')) {
        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
        server.accept();
        this.sessions.push(server);
        const drop = (ws: WebSocket) => {
          this.sessions = this.sessions.filter((s) => s !== ws);
        };
        server.addEventListener('message', () => {});
        server.addEventListener('close', () => drop(server));
        server.addEventListener('error', () => drop(server));
        return new Response(null, { status: 101, webSocket: client });
      }
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
    } catch (e) {
      return new Response('DO_ERR: ' + (e instanceof Error ? e.message : String(e)), { status: 500 });
    }
  }
}
