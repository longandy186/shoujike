/**
 * API 客户端封装
 * 统一管理所有后端 API 请求，包含基础错误处理
 */

const API_BASE = '/api';

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * 基础请求封装
 */
async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const url = `${API_BASE}${endpoint}`;
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        ok: false,
        error: data.message || `请求失败 (${res.status})`,
      };
    }

    // 后端统一返回 { ok: true, data: T }，解包后交给调用方
    return { ok: true, data: data.data ?? data };
  } catch (err) {
    const message = err instanceof Error ? err.message : '网络连接失败';
    return { ok: false, error: message };
  }
}

// ============================================================
// API 方法
// ============================================================

/** 健康检查 — 验证后端连通性 */
export async function healthCheck() {
  return request<{ status: string; timestamp: string }>('/health');
}

/** Ping 测试 */
export async function ping() {
  return request<{ message: string; timestamp: number }>('/ping');
}

/** 上传图片 */
export async function uploadImage(file: File) {
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.message || '上传失败' };
    }
    return { ok: true, data: data.data };
  } catch (err) {
    const message = err instanceof Error ? err.message : '网络连接失败';
    return { ok: false, error: message };
  }
}

/** 创建订单 */
export async function createOrder(params: {
  imageUrl: string;
  customerName?: string;
  masterSku?: string;
}) {
  return request('/orders', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** 获取订单详情 */
export async function getOrder(orderId: string) {
  return request(`/orders/${orderId}`);
}

/** 获取订单列表 */
export async function getOrders() {
  return request('/orders');
}

/** 保存裁剪参数 */
export async function saveCrop(orderId: string, cropData: { x: number; y: number; scale: number; canvasW: number; canvasH: number }) {
  return request(`/orders/${orderId}/crop`, {
    method: 'PATCH',
    body: JSON.stringify({ cropData }),
  });
}

/** 更新订单状态 */
export async function updateOrderStatus(orderId: string, status: string) {
  return request(`/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/** 上传高清打印图（dataURL → 文件） */
export async function uploadPrint(orderId: string, dataUrl: string) {
  // 将 dataURL 转为 blob 再上传
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const formData = new FormData();
  formData.append('image', blob, 'print.png');

  try {
    const r = await fetch(`${API_BASE}/orders/${orderId}/print`, {
      method: 'POST',
      body: formData,
    });
    const data = await r.json();
    if (!r.ok) {
      return { ok: false, error: data.message || '生成打印图失败' };
    }
    return { ok: true, data: (data.data ?? data) };
  } catch (err) {
    const message = err instanceof Error ? err.message : '网络连接失败';
    return { ok: false, error: message };
  }
}

export default {
  healthCheck,
  ping,
  uploadImage,
  createOrder,
  getOrder,
};
