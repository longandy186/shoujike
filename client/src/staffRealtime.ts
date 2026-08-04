/**
 * 店员端实时层初始化（非轮询）。
 * 1) Service Worker + Web Push 订阅（最稳定，关页面也能收到）
 * 2) WebSocket 连接（在线实时站内响铃）
 * 来单时：onNewOrder(code) 回调 + 网页蜂鸣。
 */
import { getVapidPublicKey, subscribePush } from './api';

type NewOrderCb = (pickupCode: string) => void;

export function initStaffRealtime(onNewOrder: NewOrderCb): void {
  if (typeof window === 'undefined') return;
  setupPush();
  setupWebSocket(onNewOrder);
}

/** 注册 Service Worker 并订阅 Web Push */
async function setupPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const res = await getVapidPublicKey();
    const publicKey = (res.data as { publicKey?: string } | undefined)?.publicKey;
    if (!publicKey) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
    }
    await subscribePush(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
  } catch {
    /* 推送不可用不影响主流程 */
  }
}

/** 连接 WebSocket，来单时回调 + 蜂鸣 */
function setupWebSocket(onNewOrder: NewOrderCb): void {
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.type === 'new_order') {
          onNewOrder(data.pickup_code || '');
          beep();
        }
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      /* 连接失败静默，不影响 */
    };
  } catch {
    /* ignore */
  }
}

/** 网页蜂鸣（无需音频资源） */
function beep(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.start();
    setTimeout(() => {
      try {
        o.stop();
        ac.close();
      } catch {
        /* ignore */
      }
    }, 400);
  } catch {
    /* ignore */
  }
}
