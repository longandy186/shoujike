/**
 * 拼版打印视图（Task 6 升级：真实拼版）
 * 勾选多个可打印订单 → 按各自 SKU 的物理尺寸(+出血)在打印纸张上自动排版（拼版）
 * → 超出单页自动分页 → 浏览器打印 / 导出 PDF。
 *
 * 特性：
 * - 每张图绘制「裁切实线」（物理尺寸边界）与「出血虚线」（bleed 外扩边界）
 * - 排版算法：shelf 装箱 + 可选旋转（best-fit），比简单行优先更省纸（任务 B）
 * - 缺料核算：生成前检查 BOM 总需求，库存不足则拦截并提示
 * - 导出 PDF：用 jsPDF 把拼版页导出为多页 PDF（带出血/裁切标记），替代浏览器打印（任务 A）
 *
 * 不引入 Sharp / PDFKit（属 Phase 3 技术示范），拼版用原生 Canvas，PDF 用纯前端 jsPDF。
 */

import { useState, useEffect, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { getOrders } from '../../api';
import { getProductById } from '../Guest/products';

interface Order {
  order_id: string;
  pickup_code: string;
  master_sku: string;
  image_url: string;
  print_url: string;
  status: string;
}

interface Paper {
  label: string;
  w: number; // mm
  h: number; // mm
}

const PAPERS: Paper[] = [
  { label: 'A4 (210×297)', w: 210, h: 297 },
  { label: 'A5 (148×210)', w: 148, h: 210 },
  { label: '6寸 (102×152)', w: 102, h: 152 },
  { label: '5寸 (89×127)', w: 89, h: 127 },
];

// 拼版候选：任意已上传图片的订单（含新单/待审核/已驳回等），保证页面始终有内容可选
const HAS_IMAGE = (o: Order) => !!o.image_url || !!o.print_url;

interface Props {
  onNavigate: (tab: 'orders' | 'inventory' | 'imposition') => void;
}

interface Shortage {
  material: string;
  need: number;
  have: number;
}

interface Tile {
  order: Order;
  img: HTMLImageElement | null;
  w: number; // 物理宽 mm
  h: number; // 物理高 mm
  bleed: number; // mm
  safeZone: number; // mm，安全区（裁切线内再留白）
  /** 同一订单展开的第几份（钥匙扣同图双拼时 0/1），用于取件码后缀 */
  copy: number;
}

interface Placed {
  tile: Tile;
  x: number; // px（含出血盒，相对 usable 区左上角）
  y: number; // px
  w: number; // px（含出血盒，旋转后）
  h: number; // px（旋转后）
  rotated: boolean;
  code: string;
}

/**
 * shelf 装箱 + 可选旋转（best-fit）排版算法（任务 B）
 * - 按面积降序排列（best-bin-packing 启发式）
 * - 每个 tile 尝试原始/旋转两种朝向，优先放入当前 shelf 剩余宽度，其次开新 shelf，再次开新页
 * - allowRotate=false 时仅原始朝向（产品方向固定，如钥匙扣不可旋转）
 */
function packIntoShelves(
  items: Array<{ w: number; h: number; tile: Tile }>,
  W: number,
  H: number,
  gap: number,
  allowRotate: boolean
): Placed[][] {
  const pages: Placed[][] = [];
  let placed: Placed[] = [];
  let shelfY = 0;
  let shelfH = 0;
  let cursorX = 0;

  const newPage = () => {
    if (placed.length) pages.push(placed);
    placed = [];
    shelfY = 0;
    shelfH = 0;
    cursorX = 0;
  };

  const sorted = [...items].sort((a, b) => b.w * b.h - a.w * a.h);

  for (const it of sorted) {
    const orients: Array<{ w: number; h: number; rot: boolean }> = allowRotate
      ? [
          { w: it.w, h: it.h, rot: false },
          { w: it.h, h: it.w, rot: true },
        ]
      : [{ w: it.w, h: it.h, rot: false }];

    let chosen: { w: number; h: number; rot: boolean } | null = null;

    // 1) 尝试放入当前 shelf
    for (const o of orients) {
      if (cursorX + o.w <= W + 0.5 && (shelfH === 0 || o.h <= shelfH + 0.5)) {
        chosen = o;
        break;
      }
    }

    // 2) 尝试开新 shelf（同一页）
    if (!chosen) {
      const newShelfY = shelfY + shelfH + gap;
      for (const o of orients) {
        if (newShelfY + o.h <= H + 0.5 && o.w <= W + 0.5) {
          shelfY = newShelfY;
          shelfH = o.h;
          cursorX = 0;
          chosen = o;
          break;
        }
      }
    }

    // 3) 开新页
    if (!chosen) {
      newPage();
      for (const o of orients) {
        if (o.w <= W + 0.5 && o.h <= H + 0.5) {
          shelfY = 0;
          shelfH = o.h;
          cursorX = 0;
          chosen = o;
          break;
        }
      }
      if (!chosen) chosen = orients[0]; // 单张都放不下则仍放置（溢出）
    }

    placed.push({
      tile: it.tile,
      x: cursorX,
      y: shelfY,
      w: chosen.w,
      h: chosen.h,
      rotated: chosen.rot,
      code: it.tile.order.pickup_code || it.tile.order.order_id.slice(0, 6),
    });
    cursorX += chosen.w + gap;
    shelfH = Math.max(shelfH, chosen.h);
  }

  if (placed.length) pages.push(placed);
  return pages;
}

export default function PrintImposition({ onNavigate }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [paperIdx, setPaperIdx] = useState(0);
  const [dpi, setDpi] = useState(150);
  const [margin, setMargin] = useState(10); // mm
  const [gap, setGap] = useState(3); // mm
  const [allowRotate, setAllowRotate] = useState(false); // 任务 B：旋转装箱默认关（产品方向固定）

  // 拼版结果（每页一个 dataURL）
  const [pages, setPages] = useState<string[]>([]);
  const [placed, setPlaced] = useState(0);
  const [generating, setGenerating] = useState(false);

  // 缺料核算
  const [shortage, setShortage] = useState<Shortage[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getOrders();
    if (res.ok) {
      const all = res.data as Order[];
      setOrders(all.filter((o) => HAS_IMAGE(o)));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 缺料核算：所选订单 BOM 总需求 vs 当前库存
  const computeShortage = useCallback(async () => {
    if (selected.size === 0) { setShortage([]); return; }
    const demand = new Map<string, number>();
    for (const o of orders) {
      if (!selected.has(o.order_id)) continue;
      const prod = getProductById(o.master_sku);
      for (const b of prod?.bom || []) {
        demand.set(b.materialId, (demand.get(b.materialId) || 0) + b.qty);
      }
    }
    if (demand.size === 0) { setShortage([]); return; }
    try {
      const res = await fetch('/api/inventory/summary');
      const json = await res.json();
      const mats = (json.data?.materials || []) as Array<{ material_id: string; name: string; current_stock: number }>;
      const short: Shortage[] = [];
      for (const [mid, need] of demand) {
        const mat = mats.find((m) => m.material_id === mid);
        const have = mat?.current_stock ?? 0;
        if (need > have) short.push({ material: mat?.name || mid, need, have });
      }
      setShortage(short);
    } catch {
      setShortage([]);
    }
  }, [orders, selected]);

  useEffect(() => { computeShortage(); }, [computeShortage]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generate = useCallback(async () => {
    if (selected.size === 0) return;
    setGenerating(true);

    const paper = PAPERS[paperIdx];
    const pxPerMm = dpi / 25.4;
    const W = Math.round(paper.w * pxPerMm);
    const H = Math.round(paper.h * pxPerMm);
    const marginPx = margin * pxPerMm;
    const gapPx = gap * pxPerMm;
    const usableW = W - 2 * marginPx;
    const usableH = H - 2 * marginPx;
    const labelH = Math.max(12, Math.round(pxPerMm));

    const chosen = orders.filter((o) => selected.has(o.order_id));

    // 预加载图片（按订单去重，避免同图多份重复下载）
    const orderTiles: Array<Omit<Tile, 'copy'>> = await Promise.all(
      chosen.map(
        (o) =>
          new Promise<Omit<Tile, 'copy'>>((resolve) => {
            const prod = getProductById(o.master_sku);
            const pw = prod?.physicalSize?.width ?? 50;
            const ph = prod?.physicalSize?.height ?? 50;
            const bleed = prod?.bleed ?? 0;
            const safeZone = prod?.safeZone ?? 0;
            const base: Omit<Tile, 'copy'> = { order: o, img: null, w: pw, h: ph, bleed, safeZone };
            if (!o.print_url && !o.image_url) return resolve(base);
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.onload = () => resolve({ ...base, img: im });
            im.onerror = () => resolve(base);
            im.src = o.print_url || o.image_url;
          })
      )
    );

    // 展开 copies（钥匙扣同图双拼 = 2 份相同印刷图）
    const tiles: Tile[] = [];
    for (const ot of orderTiles) {
      const copies = Math.max(1, getProductById(ot.order.master_sku)?.copies ?? 1);
      for (let i = 0; i < copies; i++) tiles.push({ ...ot, copy: i });
    }

    // 计算每个 tile 含出血的像素盒尺寸，并排版
    const boxes = tiles.map((t) => ({
      w: (t.w + 2 * t.bleed) * pxPerMm,
      h: (t.h + 2 * t.bleed) * pxPerMm,
      tile: t,
    }));
    const pagesLayout = packIntoShelves(boxes, usableW, usableH, gapPx, allowRotate);

    // 逐页渲染（content 区从 marginPx 起，但 packIntoShelves 已用 usableW/H，需平移到 margin）
    const pagesData = pagesLayout.map((layout) => {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const c = cv.getContext('2d');
      if (!c) return '';
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, W, H);

      for (const it of layout) {
        const fx = marginPx + it.x;
        const fy = marginPx + it.y;
        const fw = it.w;
        const fh = it.h;
        const bleedPx = it.tile.bleed * pxPerMm;

        // 出血区底色
        c.fillStyle = '#ffffff';
        c.fillRect(fx, fy, fw, fh);

        // 图片（cover 填满含出血的整块）
        if (it.tile.img) {
          const scale = Math.max(fw / it.tile.img.naturalWidth, fh / it.tile.img.naturalHeight);
          const dw = it.tile.img.naturalWidth * scale;
          const dh = it.tile.img.naturalHeight * scale;
          c.drawImage(it.tile.img, fx + (fw - dw) / 2, fy + (fh - dh) / 2, dw, dh);
        } else {
          c.fillStyle = '#cccccc';
          c.fillRect(fx, fy, fw, fh);
        }

        // 出血虚线（外边界）
        c.strokeStyle = '#999999';
        c.lineWidth = 1;
        c.setLineDash([4, 3]);
        c.strokeRect(fx, fy, fw, fh);
        c.setLineDash([]);

        // 裁切实线（物理尺寸内边界）
        const cx = fx + bleedPx;
        const cy = fy + bleedPx;
        const cw = fw - 2 * bleedPx;
        const ch = fh - 2 * bleedPx;
        c.strokeStyle = '#000000';
        c.lineWidth = Math.max(1, pxPerMm * 0.15);
        c.strokeRect(cx, cy, cw, ch);

        // 安全区虚线（裁切线内再留白，关键内容/人脸不可超出）——相框=5mm 等
        if (it.tile.safeZone > 0) {
          const sz = it.tile.safeZone * pxPerMm;
          const sx = cx + sz;
          const sy = cy + sz;
          const sw = cw - 2 * sz;
          const sh = ch - 2 * sz;
          if (sw > 2 && sh > 2) {
            c.strokeStyle = '#e63946';
            c.lineWidth = Math.max(1, pxPerMm * 0.12);
            c.setLineDash([4, 3]);
            c.strokeRect(sx, sy, sw, sh);
            c.setLineDash([]);
          }
        }

        // 取件码标签
        c.fillStyle = '#000000';
        c.font = `${Math.round(labelH * 0.7)}px sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(`#${it.code}`, fx + fw / 2, fy + fh + labelH / 2);
      }
      return cv.toDataURL('image/png');
    });

    setPages(pagesData);
    setPlaced(tiles.length);
    setGenerating(false);
  }, [orders, selected, paperIdx, dpi, margin, gap, allowRotate]);

  const handlePrint = () => window.print();

  // 任务 A：导出 PDF（jsPDF，纯前端）
  const handleExportPdf = () => {
    if (pages.length === 0) return;
    const paper = PAPERS[paperIdx];
    const orientation = paper.w > paper.h ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ unit: 'mm', format: [paper.w, paper.h], orientation });
    pages.forEach((src, i) => {
      if (i > 0) pdf.addPage([paper.w, paper.h], orientation);
      pdf.addImage(src, 'PNG', 0, 0, paper.w, paper.h);
    });
    pdf.save(`imposition-${Date.now()}.pdf`);
  };

  return (
    <div className="staff-page-inner">
      <header className="inv-header">
        <button className="inv-back" onClick={() => onNavigate('orders')}>← 返回订单</button>
        <h1>拼版打印</h1>
        <button className="inv-refresh" onClick={load}>🔄</button>
      </header>

      {/* 设置栏 */}
      <section className="imp-settings">
        <label>
          纸张
          <select value={paperIdx} onChange={(e) => setPaperIdx(Number(e.target.value))}>
            {PAPERS.map((p, i) => (
              <option key={p.label} value={i}>{p.label}</option>
            ))}
          </select>
        </label>
        <label>
          DPI
          <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
            <option value={72}>72</option>
            <option value={150}>150</option>
            <option value={300}>300</option>
          </select>
        </label>
        <label>
          边距(mm)
          <input type="number" min="0" value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
        </label>
        <label>
          间距(mm)
          <input type="number" min="0" value={gap} onChange={(e) => setGap(Number(e.target.value))} />
        </label>
        <label className="imp-rotate">
          <input type="checkbox" checked={allowRotate} onChange={(e) => setAllowRotate(e.target.checked)} />
          允许旋转(省纸)
        </label>
      </section>

      {/* 订单选择 */}
      <section className="imp-section">
        <h2 className="inv-title">选择订单（{selected.size} 已选 / {orders.length} 有图）</h2>
        {loading ? (
          <div className="list-empty">加载中...</div>
        ) : orders.length === 0 ? (
          <div className="list-empty">暂无可打印订单</div>
        ) : (
          <div className="imp-order-grid">
            {orders.map((o) => (
              <label key={o.order_id} className={`imp-chip ${selected.has(o.order_id) ? 'on' : ''}`}>
                <input type="checkbox" checked={selected.has(o.order_id)} onChange={() => toggle(o.order_id)} />
                <span className="imp-chip-code">#{o.pickup_code || o.order_id.slice(0, 6)}</span>
                <span className="imp-chip-sku">{getProductById(o.master_sku)?.name || o.master_sku}</span>
                {!o.print_url && <span className="imp-chip-warn" title="未生成打印图，将用原图">原图</span>}
              </label>
            ))}
          </div>
        )}
      </section>

      {/* 缺料提示 */}
      {shortage.length > 0 && (
        <div className="imp-shortage">
          ⚠️ 物料不足，无法生成拼版：
          {shortage.map((s) => (
            <span key={s.material} className="imp-shortage-item">
              {s.material}（需 {s.need} / 余 {s.have}）
            </span>
          ))}
          <span className="imp-shortage-hint">请先到「库存」页补货</span>
        </div>
      )}

      {/* 操作 */}
      <section className="imp-actions">
        <button className="btn-impose" onClick={generate} disabled={selected.size === 0 || shortage.length > 0 || generating}>
          {generating ? '生成中...' : '🧩 生成拼版'}
        </button>
        <button className="btn-print-sheet" onClick={handlePrint} disabled={pages.length === 0}>
          🖨️ 打印
        </button>
        <button className="btn-export-pdf" onClick={handleExportPdf} disabled={pages.length === 0}>
          📄 导出 PDF
        </button>
      </section>
      {placed > 0 && (
        <div className="imp-result ok">
          ✅ 已排版 {placed} 张（含同图多拼），共 {pages.length} 页（{PAPERS[paperIdx].label}）
          {allowRotate && ' · 已启用旋转省纸'}
        </div>
      )}

      <div className="imp-legend">
        <span><i className="lg-cut" /> 黑色实线 = 裁切线（物理尺寸）</span>
        <span><i className="lg-bleed" /> 灰色虚线 = 出血线</span>
        <span><i className="lg-safe" /> 红色虚线 = 安全区（关键内容/人脸勿超）</span>
      </div>

      {/* 拼版预览（打印时仅显示这些页） */}
      <div className="print-sheet-wrap">
        {pages.map((src, i) => (
          <img key={i} className="imp-page" src={src} alt={`拼版第 ${i + 1} 页`} style={{ width: `${PAPERS[paperIdx].w}mm`, height: `${PAPERS[paperIdx].h}mm` }} />
        ))}
      </div>

      <nav className="inv-tabbar">
        <button onClick={() => onNavigate('orders')}>📋 订单</button>
        <button onClick={() => onNavigate('inventory')}>📦 库存</button>
        <button className="active" onClick={() => onNavigate('imposition')}>🖨️ 拼版</button>
      </nav>
    </div>
  );
}
