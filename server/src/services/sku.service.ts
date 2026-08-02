/**
 * SKU 主数据服务（Phase 1.5）
 * 读取 sku.template.json，提供产品/SKU 查询能力。
 * 加新品 = 加一条 product 配置，无需改代码。
 */

import fs from 'fs';
import path from 'path';

export interface SkuPrintArea {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: string;
}

export interface SkuPrintSettings {
  dpi: number;
  bleed: number;
  mirror: boolean;
}

export interface SkuTemplate {
  mask?: string;
  overlay?: string;
}

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
  printArea: SkuPrintArea;
  printSettings: SkuPrintSettings;
  template: SkuTemplate;
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

let config: SkuConfig | null = null;

function loadConfig(): SkuConfig {
  if (config) return config;
  const cfgPath = path.resolve(__dirname, '..', 'config', 'sku.template.json');
  const raw = fs.readFileSync(cfgPath, 'utf-8');
  config = JSON.parse(raw) as SkuConfig;
  return config;
}

/** 获取所有产品（含禁用） */
export function getAllProducts(): SkuProduct[] {
  return loadConfig().products;
}

/** 获取启用中的产品（游客端用） */
export function getEnabledProducts(): SkuProduct[] {
  return loadConfig().products.filter((p) => p.enabled);
}

/** 根据 masterSku 查询单个产品 */
export function getProductBySku(masterSku: string): SkuProduct | undefined {
  return loadConfig().products.find((p) => p.masterSku === masterSku);
}

/** 获取所有物料主数据 */
export function getAllMaterials(): SkuMaterial[] {
  return loadConfig().materials;
}
