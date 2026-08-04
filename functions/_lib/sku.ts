/**
 * SKU 主数据（Phase 1.5）
 * 直接复用 server/src/config/sku.template.json（单一数据源），
 * 加新品 = 加一条 product 配置，无需改代码。
 */
import config from '../../server/src/config/sku.template.json';

export interface SkuBomItem {
  materialId: string;
  qty: number;
}

export interface SkuProduct {
  masterSku: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  category: string;
  physicalSize: { width: number; height: number; unit: string };
  printArea: { x: number; y: number; width: number; height: number; unit: string };
  printSettings: { dpi: number; bleed: number; mirror: boolean };
  template: { mask?: string; overlay?: string };
  paper: { type: string; widthMm: number; heightMm: number };
  bom: SkuBomItem[];
}

export interface SkuMaterial {
  materialId: string;
  name: string;
  category: string;
  unit: string;
  safetyStock: number;
}

interface SkuConfig {
  version?: string;
  description?: string;
  products: SkuProduct[];
  materials: SkuMaterial[];
}

const cfg = config as SkuConfig;

export function getAllProducts(): SkuProduct[] {
  return cfg.products;
}

export function getEnabledProducts(): SkuProduct[] {
  return cfg.products.filter((p) => p.enabled);
}

export function getProductBySku(sku: string): SkuProduct | undefined {
  return cfg.products.find((p) => p.masterSku === sku);
}

export function getAllMaterials(): SkuMaterial[] {
  return cfg.materials;
}
