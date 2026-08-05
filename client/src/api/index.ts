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

/** 基础请求封装（供其他模块复用，如 SKU 拉取） */
export { request };

/** 健康检查 — 验证后端连通性 */
export async function healthCheck() {
  return request<{ status: string; timestamp: string }>('/health');
}

/** Ping 测试 */
export async function ping() {
  return request<{ message: string; timestamp: number }>('/ping');
}

/** 上传图片（前端压缩以控制体积、加快上传；R2 不限单列大小，可保留较高质量） */
export async function uploadImage(file: File) {
  const blob = await compressToJpeg(file, 2000, 2 * 1024 * 1024);
  const formData = new FormData();
  formData.append('image', blob, 'photo.jpg');

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

/** 游客多商品下单（V2）：items[] + 合计（优惠后） */
export async function createVisitorOrder(params: {
  items: { masterSku: string; imageUrl: string; previewUrl?: string }[];
  customerName?: string;
  customerPhone?: string;
  language?: string;
  totalRsd?: number;
  totalEur?: number;
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

/** 驳回订单（店员选预置原因） */
export async function rejectOrder(orderId: string, reason: string) {
  return request(`/orders/${orderId}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ reason }),
  });
}

/** 凭取件码查询订单 */
export async function getOrderByCode(code: string) {
  return request(`/orders/code/${code}`);
}

/** Web Push 订阅 */
export async function subscribePush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  return request('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(sub),
  });
}

/** 获取 VAPID 公钥 */
export async function getVapidPublicKey() {
  return request('/vapid-public-key');
}

/** 预置驳回原因（店员下拉，非手填） */
export const REJECT_REASONS = [
  '照片模糊',
  '亮度不足或曝光',
  '比例或尺寸不符',
  '非人像或内容不符',
  '背景杂乱',
  '其他',
] as const;

/** 库存总览（物料 + 可生产数量 + 预警） */
export async function getInventorySummary() {
  return request('/inventory/summary');
}

/** 低库存预警 */
export async function getInventoryAlerts() {
  return request('/inventory/alerts');
}

/** 采购入库 */
export async function stockIn(materialId: string, qty: number, note?: string) {
  return request('/inventory/stock-in', {
    method: 'POST',
    body: JSON.stringify({ materialId, qty, note }),
  });
}

/** 上传高清打印图（dataURL → 压缩 JPEG → 上传 R2，保留较高分辨率以保打印质量） */
export async function uploadPrint(orderId: string, dataUrl: string) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const compressed = await compressToJpeg(blob, 2400, 3 * 1024 * 1024);
  const formData = new FormData();
  formData.append('image', compressed, 'print.jpg');

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

/**
 * 将图片（File/Blob）缩放重压为 JPEG：目标最长边 maxDim、体积 < maxBytes。
 * R2 对单列大小没有限制，这里压缩仅用于控制上传体积与存储成本、加快传输，
 * 因此可保留比 D1 内联方案更高的分辨率与质量。
 */
async function compressToJpeg(input: Blob, maxDim: number, maxBytes: number): Promise<Blob> {
  const bitmap = await createImageBitmap(input);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return input;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let q = 0.9;
  let blob = await canvasToJpeg(canvas, q);
  while (blob.size > maxBytes && q > 0.4) {
    q = Math.round((q - 0.1) * 100) / 100;
    blob = await canvasToJpeg(canvas, q);
  }
  // 若仍超，尺寸减半再压
  if (blob.size > maxBytes) {
    const c2 = document.createElement('canvas');
    c2.width = Math.max(1, Math.round(w / 2));
    c2.height = Math.max(1, Math.round(h / 2));
    const c2ctx = c2.getContext('2d');
    if (c2ctx) {
      c2ctx.drawImage(canvas, 0, 0, c2.width, c2.height);
      q = 0.85;
      blob = await canvasToJpeg(c2, q);
      let guard = 0;
      while (blob.size > maxBytes && q > 0.4 && guard < 6) {
        q = Math.round((q - 0.1) * 100) / 100;
        blob = await canvasToJpeg(c2, q);
        guard++;
      }
    }
  }
  return blob;
}

function canvasToJpeg(c: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', q);
  });
}

/** 店员后台商品管理（数据驱动 CRUD，携带 x-admin-key） */
const ADMIN_KEY = (import.meta.env.VITE_ADMIN_API_KEY as string | undefined) || '';

async function adminRequest<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  return request<T>(endpoint, {
    headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
    ...options,
  });
}

export interface AdminProduct {
  masterSku: string;
  name_zh?: string;
  name_en?: string;
  name_sr?: string;
  desc_zh?: string;
  desc_en?: string;
  desc_sr?: string;
  category?: string;
  image_url?: string;
  mockup_asset_url?: string;
  print_area?: { x: number; y: number; width: number; height: number; unit: string };
  physical_size?: { width: number; height: number; unit: string };
  bleed?: number;
  print_technique?: string;
  price_rsd?: number;
  price_eur?: number;
  stock?: number;
  bom?: { materialId: string; qty: number }[];
  enabled?: boolean;
  sort_order?: number;
}

export async function getAdminProducts() {
  return adminRequest<AdminProduct[]>('/admin/products');
}
export async function createAdminProduct(payload: AdminProduct) {
  return adminRequest('/admin/products', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateAdminProduct(sku: string, payload: Partial<AdminProduct>) {
  return adminRequest(`/admin/products/${encodeURIComponent(sku)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
export async function deleteAdminProduct(sku: string) {
  return adminRequest(`/admin/products/${encodeURIComponent(sku)}`, { method: 'DELETE' });
}
export async function adminStockIn(sku: string, qty: number, note?: string) {
  return adminRequest(`/admin/products/${encodeURIComponent(sku)}/stock-in`, {
    method: 'POST',
    body: JSON.stringify({ qty, note }),
  });
}
/** 商品图片上传到 R2，返回可访问 URL */
export async function adminUploadProductImage(file: File): Promise<ApiResponse<{ url: string }>> {
  const blob = await compressToJpeg(file, 1600, 2 * 1024 * 1024);
  const formData = new FormData();
  formData.append('image', blob, 'product.jpg');
  try {
    const res = await fetch(`${API_BASE}/admin/products/image`, {
      method: 'POST',
      headers: { 'x-admin-key': ADMIN_KEY },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.message || '上传失败' };
    return { ok: true, data: data.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络连接失败' };
  }
}

export default {
  healthCheck,
  ping,
  uploadImage,
  createOrder,
  getOrder,
  rejectOrder,
  getOrderByCode,
  subscribePush,
  getVapidPublicKey,
  getAdminProducts,
  createAdminProduct,
  updateAdminProduct,
  deleteAdminProduct,
  adminStockIn,
  adminUploadProductImage,
};
