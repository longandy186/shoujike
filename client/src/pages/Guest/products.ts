/**
 * 产品配置
 * 当前 MVP 阶段使用静态配置，未来可迁移到数据库 SKU 表
 *
 * 扩展路径：
 *   MVP → 静态配置文件
 *   V1.5 → 数据库 Master SKU 表
 *   V2 → 独立产品管理后台
 */

export interface Product {
  /** 产品唯一标识（对应 Master SKU） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 简要描述 */
  description: string;
  /** 产品图标/图片 */
  icon: string;
  /** 是否可用 */
  enabled: boolean;
}

/** 当前可用产品列表 */
export const PRODUCTS: Product[] = [
  {
    id: 'KEYCHAIN_ACRYLIC_001',
    name: '亚克力钥匙扣',
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

/** 获取启用的产品列表 */
export function getEnabledProducts(): Product[] {
  return PRODUCTS.filter((p) => p.enabled);
}

/** 根据 ID 查找产品 */
export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}
