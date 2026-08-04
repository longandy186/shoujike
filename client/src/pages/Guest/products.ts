/**
 * 产品配置（Phase 1.5 重构）
 *
 * 产品定义已迁移到后端 sku.template.json（Master SKU 主数据）。
 * 本文件改为：从后端 /api/skus 拉取启用中的产品，并提供静态兜底，
 * 保证后端不可用时前端仍能展示（降级）。
 *
 * 扩展路径：
 *   MVP → 静态配置文件（本文件）
 *   V1.5 → 后端 Master SKU 表（sku.template.json，当前）
 *   V2 → 独立产品管理后台
 */

import { request } from '../../api';

/** 与后端 SkuProduct 对齐的精简前端结构 */
export interface Product {
  /** Master SKU（订单关联用） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 简要描述 */
  description: string;
  /** 产品图标/图片 */
  icon: string;
  /** 是否可用 */
  enabled: boolean;
  /** 物理尺寸（拼版打印用，mm） */
  physicalSize?: { width: number; height: number; unit: string };
  /** 出血值（mm，拼版裁切标记用） */
  bleed?: number;
  /** BOM 物料清单（缺料核算用） */
  bom?: { materialId: string; qty: number }[];
}

/**
 * 静态兜底（与 sku.template.json 的启用产品保持一致）。
 * 仅在后端 /api/skus 不可用时使用。
 */
const FALLBACK_PRODUCTS: Product[] = [
  {
    id: 'KEYCHAIN_ACRYLIC_001',
    name: '亚克力宠物钥匙扣',
    description: '把你的照片做成精美亚克力钥匙扣',
    icon: '🔑',
    enabled: true,
  },
  {
    id: 'PHOTO_FRAME_001',
    name: '纪念相框',
    description: '精致相框，留住美好瞬间',
    icon: '🖼️',
    enabled: false,
  },
  {
    id: 'MAGNET_001',
    name: '冰箱贴',
    description: '定制冰箱贴，装饰你的生活',
    icon: '🧲',
    enabled: false,
  },
];

/** 缓存（避免重复请求，页面切换时复用） */
let cache: Product[] | null = null;

/**
 * 从后端拉取启用中的产品，失败则回退到静态配置。
 * @param force 是否忽略缓存强制刷新
 */
export async function fetchProducts(force = false): Promise<Product[]> {
  if (cache && !force) return cache;
  try {
    const res = await request<unknown>('/skus');
    if (res.ok && Array.isArray(res.data)) {
      const mapped = (res.data as Array<Record<string, unknown>>).map((p) => ({
        id: String(p.masterSku ?? ''),
        name: String(p.name ?? ''),
        description: String(p.description ?? ''),
        icon: String(p.icon ?? '📦'),
        enabled: Boolean(p.enabled ?? true),
        physicalSize: p.physicalSize as { width: number; height: number; unit: string } | undefined,
        bleed: typeof p.printSettings === 'object' && p.printSettings ? Number((p.printSettings as Record<string, unknown>).bleed) || 0 : 0,
        bom: Array.isArray(p.bom)
          ? (p.bom as Array<Record<string, unknown>>).map((b) => ({ materialId: String(b.materialId ?? ''), qty: Number(b.qty ?? 0) }))
          : undefined,
      }));
      // 后端可能返回全部（含禁用），这里只取启用；若后端已过滤则全部保留
      const enabled = mapped.filter((p) => p.enabled);
      cache = enabled.length > 0 ? enabled : FALLBACK_PRODUCTS;
      return cache;
    }
  } catch {
    /* 网络错误，走兜底 */
  }
  cache = FALLBACK_PRODUCTS;
  return cache;
}

/** 同步获取缓存（已拉取过时）；未拉取则直接返回兜底 */
export function getEnabledProducts(): Product[] {
  return cache ?? FALLBACK_PRODUCTS;
}

/** 同步按 ID 查找（基于当前缓存/兜底） */
export function getProductById(id: string): Product | undefined {
  return getEnabledProducts().find((p) => p.id === id);
}
