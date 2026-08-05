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
  /** 印刷工艺 */
  printTechnique?: string;
  /** 价格（RSD / EUR） */
  priceRsd?: number;
  priceEur?: number;
  /** BOM 物料清单（缺料核算用） */
  bom?: { materialId: string; qty: number }[];
  /** 安全区（裁切线内再留白，关键内容不可超出），单位 mm。相框=5。 */
  safeZone?: number;
  /** 每个订单产出的物理印刷份数（同图多拼）。钥匙扣=2（同图双拼）。默认 1。 */
  copies?: number;
}

/**
 * 产品特殊规则（安全区 / 同图份数）的前端兜底。
 * 后端 D1 products 表已含 safe_zone_mm / copies 列（店员后台「商品」Tab 可编辑），
 * /api/skus 会返回；此处仅在后端不可用或字段缺失时兜底。
 * - PHOTO_FRAME_001：安全区 5mm（人脸/关键内容需落在裁切线内 5mm，避免裁掉）
 * - KEYCHAIN_ACRYLIC_001：copies=2（同一张图在一张相纸上拼印 2 份，示范文档「钥匙扣双拼」）
 */
const PRODUCT_RULES: Record<string, { safeZone?: number; copies?: number }> = {
  PHOTO_FRAME_001: { safeZone: 5 },
  KEYCHAIN_ACRYLIC_001: { copies: 2 },
};

/**
 * 静态兜底（与 sku.template.json 的启用产品保持一致）。
 * 仅在后端 /api/skus 不可用时使用。
 */
const FALLBACK_PRODUCTS: Product[] = [
  { id: 'PHOTO_FRAME_001', name: '纪念相框', description: '精致相框，留住美好瞬间', icon: '🖼️', enabled: true, priceRsd: 990, priceEur: 8.4, bleed: 3, physicalSize: { width: 120, height: 170, unit: 'mm' }, safeZone: 5 },
  { id: 'KEYCHAIN_ACRYLIC_001', name: '亚克力钥匙扣', description: '把你的照片做成精美亚克力钥匙扣', icon: '🔑', enabled: true, priceRsd: 590, priceEur: 5.0, bleed: 2, physicalSize: { width: 29, height: 48, unit: 'mm' }, copies: 2 },
  { id: 'PHONE_CASE_001', name: '定制手机壳', description: '热升华工艺，照片全幅覆盖手机壳', icon: '📱', enabled: true, priceRsd: 1290, priceEur: 11.0, bleed: 2, physicalSize: { width: 75, height: 150, unit: 'mm' } },
  { id: 'FRIDGE_MAGNET_001', name: '定制冰箱贴', description: '装饰你的生活，照片冰箱贴', icon: '🧲', enabled: true, priceRsd: 490, priceEur: 4.2, bleed: 2, physicalSize: { width: 70, height: 100, unit: 'mm' } },
  { id: 'CANVAS_BAG_001', name: '定制帆布袋', description: '环保帆布袋，单面热升华印照片', icon: '👜', enabled: true, priceRsd: 1490, priceEur: 12.7, bleed: 3, physicalSize: { width: 200, height: 250, unit: 'mm' } },
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
        printTechnique: String(p.printTechnique ?? 'direct_insert'),
        priceRsd: Number(p.priceRsd ?? 0),
        priceEur: Number(p.priceEur ?? 0),
        bleed: typeof p.printSettings === 'object' && p.printSettings ? Number((p.printSettings as Record<string, unknown>).bleed) || 0 : 0,
        bom: Array.isArray(p.bom)
          ? (p.bom as Array<Record<string, unknown>>).map((b) => ({ materialId: String(b.materialId ?? ''), qty: Number(b.qty ?? 0) }))
          : undefined,
        // 拼版规则：优先取后端 D1 返回（已下沉），PRODUCT_RULES 在前端 getProductById 处兜底
        safeZone: Number(p.safeZoneMm ?? 0),
        copies: Number(p.copies ?? 1),
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

/** 同步按 ID 查找（基于当前缓存/兜底），并合并 PRODUCT_RULES（安全区/份数） */
export function getProductById(id: string): Product | undefined {
  const base = getEnabledProducts().find((p) => p.id === id);
  if (!base) return undefined;
  const rule = PRODUCT_RULES[id];
  if (!rule) return base;
  return {
    ...base,
    safeZone: base.safeZone ?? rule.safeZone,
    copies: base.copies ?? rule.copies,
  };
}
