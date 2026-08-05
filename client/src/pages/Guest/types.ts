/** 游客端类型定义 */

export interface VisitorProduct {
  masterSku: string;
  names: { zh: string; en: string; sr: string };
  descs: { zh: string; en: string; sr: string };
  icon: string;
  category: string;
  physicalSize?: { width: number; height: number; unit: string };
  printArea: { x: number; y: number; width: number; height: number; unit: string };
  bleed: number;
  printTechnique: string;
  priceRsd: number;
  priceEur: number;
  stock?: number;
  imageUrl?: string;
}

export interface CartItem {
  uid: string;
  product: VisitorProduct;
  photoSrc: string; // 本地预览（dataURL）
  imageUrl: string; // 已上传 R2 的 URL
}
