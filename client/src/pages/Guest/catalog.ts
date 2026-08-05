/**
 * 游客产品目录加载器
 * 优先从后端 /api/skus 拉取（含三语/价格/印刷区），失败回退到内置 3 语文案。
 */
import { request } from '../../api';
import type { VisitorProduct } from './types';

let cache: VisitorProduct[] | null = null;

const FALLBACK: VisitorProduct[] = [
  {
    masterSku: 'PHOTO_FRAME_001',
    names: { zh: '纪念相框', en: 'Photo Frame', sr: 'Ram za sliku' },
    descs: { zh: '精致相框，留住美好瞬间', en: 'Elegant frame to keep your moments', sr: 'Elegantan ram za vaše trenutke' },
    icon: '🖼️',
    category: 'frame',
    physicalSize: { width: 120, height: 170, unit: 'mm' },
    printArea: { x: 9.5, y: 9, width: 101, height: 152, unit: 'mm' },
    bleed: 3,
    printTechnique: 'direct_insert',
    priceRsd: 990,
    priceEur: 8.4,
  },
  {
    masterSku: 'KEYCHAIN_ACRYLIC_001',
    names: { zh: '亚克力钥匙扣', en: 'Acrylic Keychain', sr: 'Akrilni privesak' },
    descs: { zh: '把你的照片做成精美亚克力钥匙扣', en: 'Turn your photo into a keychain', sr: 'Pretvorite fotografiju u privesak' },
    icon: '🔑',
    category: 'keychain',
    physicalSize: { width: 29, height: 48, unit: 'mm' },
    printArea: { x: 0.5, y: 0.5, width: 28, height: 47, unit: 'mm' },
    bleed: 2,
    printTechnique: 'direct_insert',
    priceRsd: 590,
    priceEur: 5.0,
  },
  {
    masterSku: 'PHONE_CASE_001',
    names: { zh: '定制手机壳', en: 'Custom Phone Case', sr: 'Masna za telefon' },
    descs: { zh: '热升华工艺，照片全幅覆盖手机壳', en: 'Sublimation full-bleed phone case', sr: 'Sublimacija preko cele masne' },
    icon: '📱',
    category: 'phonecase',
    physicalSize: { width: 75, height: 150, unit: 'mm' },
    printArea: { x: 2.5, y: 2.5, width: 70, height: 145, unit: 'mm' },
    bleed: 2,
    printTechnique: 'heat_sublimation',
    priceRsd: 1290,
    priceEur: 11.0,
  },
  {
    masterSku: 'FRIDGE_MAGNET_001',
    names: { zh: '定制冰箱贴', en: 'Fridge Magnet', sr: 'Magnet za frižider' },
    descs: { zh: '装饰你的生活，照片冰箱贴', en: 'Decorate with a photo magnet', sr: 'Ukrasite magnetom sa fotografijom' },
    icon: '🧲',
    category: 'magnet',
    physicalSize: { width: 70, height: 100, unit: 'mm' },
    printArea: { x: 2.5, y: 2.5, width: 65, height: 95, unit: 'mm' },
    bleed: 2,
    printTechnique: 'heat_sublimation',
    priceRsd: 490,
    priceEur: 4.2,
  },
  {
    masterSku: 'CANVAS_BAG_001',
    names: { zh: '定制帆布袋', en: 'Canvas Tote Bag', sr: 'Platnena torba' },
    descs: { zh: '环保帆布袋，单面热升华印照片', en: 'Eco tote with sublimation print', sr: 'Ekološka torba sa štampom' },
    icon: '👜',
    category: 'canvasbag',
    physicalSize: { width: 200, height: 250, unit: 'mm' },
    printArea: { x: 10, y: 10, width: 180, height: 230, unit: 'mm' },
    bleed: 3,
    printTechnique: 'heat_sublimation',
    priceRsd: 1490,
    priceEur: 12.7,
  },
];

interface RawSku {
  masterSku: string;
  name?: string;
  nameEn?: string;
  nameSr?: string;
  description?: string;
  descriptionEn?: string;
  descriptionSr?: string;
  icon?: string;
  category?: string;
  physicalSize?: { width: number; height: number; unit: string };
  printArea?: { x: number; y: number; width: number; height: number; unit: string };
  printSettings?: { dpi: number; bleed: number; mirror: boolean };
  printTechnique?: string;
  priceRsd?: number;
  priceEur?: number;
  stock?: number;
  imageUrl?: string;
}

export async function loadCatalog(force = false): Promise<VisitorProduct[]> {
  if (cache && !force) return cache;
  try {
    const res = await request<RawSku[]>('/skus');
    if (res.ok && Array.isArray(res.data)) {
      const mapped = (res.data as RawSku[])
        .filter((p) => p.masterSku)
        .map((p) => ({
          masterSku: p.masterSku,
          names: { zh: p.name || p.masterSku, en: p.nameEn || p.name || p.masterSku, sr: p.nameSr || p.name || p.masterSku },
          descs: { zh: p.description || '', en: p.descriptionEn || p.description || '', sr: p.descriptionSr || p.description || '' },
          icon: p.icon || '📦',
          category: p.category || 'rect',
          physicalSize: p.physicalSize,
          printArea: p.printArea || { x: 0, y: 0, width: p.physicalSize?.width || 50, height: p.physicalSize?.height || 50, unit: 'mm' },
          bleed: p.printSettings?.bleed ?? 2,
          printTechnique: p.printTechnique || 'direct_insert',
          priceRsd: p.priceRsd ?? 0,
          priceEur: p.priceEur ?? 0,
          stock: p.stock,
          imageUrl: p.imageUrl,
        }));
      if (mapped.length > 0) {
        cache = mapped;
        return cache;
      }
    }
  } catch {
    /* 回退 */
  }
  cache = FALLBACK;
  return cache;
}

export function getCatalog(): VisitorProduct[] {
  return cache ?? FALLBACK;
}
