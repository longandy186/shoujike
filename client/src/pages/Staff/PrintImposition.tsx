/**
 * 拼版打印视图（Task 6 升级：真实拼版）
 * 勾选多个可打印订单 → 按各自 SKU 的物理尺寸在打印纸张上自动排版（拼版）
 * → 浏览器打印（@media print 只输出拼版纸张）。
 *
 * 不引入 Sharp/PDFKit（属 Phase 3 技术示范，暂不开发），使用原生 Canvas 实现，
 * 纸张尺寸与产品尺寸均按 mm 换算，DPI 可选，保证拼版物理尺寸正确。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
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

const PRINTABLE = ['READY_PRINT', 'PRINTED', 'PROCESSING', 'COMPLETED'];

interface Props {
  onNavigate: (tab: 'orders' | 'inventory' | 'imposition') => void;
}

export default function PrintImposition({ onNavigate }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [paperIdx, setPaperIdx] = useState(0);
  const [dpi, setDpi] = useState(150);
  const [margin, setMargin] = useState(10); // mm
  const [gap, setGap] = useState(3); // mm

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [placed, setPlaced] = useState(0);
  const [fitting, setFitting] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getOrders();
    if (res.ok) {
      const all = res.data as Order[];
      setOrders(all.filter((o) => PRINTABLE.includes(o.status)));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generate = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paper = PAPERS[paperIdx];
    const pxPerMm = dpi / 25.4;
    const W = Math.round(paper.w * pxPerMm);
    const H = Math.round(paper.h * pxPerMm);
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 白底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const marginPx = margin * pxPerMm;
    const gapPx = gap * pxPerMm;
    const usableW = W - 2 * marginPx;
    const usableH = H - 2 * marginPx;

    // 收集被勾选订单，按产品高度降序以便更紧凑排版
    const chosen = orders.filter((o) => selected.has(o.order_id));
    const tiles = chosen.map((o) => {
      const prod = getProductById(o.master_sku);
      const size = prod?.physicalSize;
      const pw = size?.width ?? 50;
      const ph = size?.height ?? 50;
      return {
        order: o,
        imgUrl: o.print_url || o.image_url,
        w: pw * pxPerMm,
        h: ph * pxPerMm,
      };
    });
    tiles.sort((a, b) => b.h - a.h);

    // 预加载图片
    const imgs = await Promise.all(
      tiles.map(
        (t) =>
          new Promise<{ img: HTMLImageElement | null; tile: typeof t }>((resolve) => {
            if (!t.imgUrl) return resolve({ img: null, tile: t });
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.onload = () => resolve({ img: im, tile: t });
            im.onerror = () => resolve({ img: null, tile: t });
            im.src = t.imgUrl;
          })
      )
    );

    const labelH = Math.max(10, 6 * pxPerMm / 25.4 * 6); // 标签高度（约 12px@150dpi）
    let x = marginPx;
    let y = marginPx;
    let rowMaxH = 0;
    let count = 0;
    let allFit = true;

    for (const { img, tile } of imgs) {
      const tileW = tile.w;
      const tileH = tile.h + labelH;

      if (x + tileW > marginPx + usableW + 0.5) {
        // 换行
        x = marginPx;
        y += rowMaxH + gapPx;
        rowMaxH = 0;
      }
      if (y + tileH > marginPx + usableH + 0.5) {
        allFit = false;
        break;
      }

      // 图片区（cover 裁切）
      const ix = x;
      const iy = y;
      const iw = tileW;
      const ih = tile.h;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ix, iy, iw, ih);
      if (img) {
        const scale = Math.max(iw / img.naturalWidth, ih / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = '#cccccc';
        ctx.fillRect(ix, iy, iw, ih);
      }
      // 边框
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = Math.max(1, pxPerMm * 0.2);
      ctx.strokeRect(ix, iy, iw, ih);

      // 取件码标签
      ctx.fillStyle = '#000000';
      ctx.font = `${Math.round(labelH * 0.7)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`#${tile.order.pickup_code || tile.order.order_id.slice(0, 6)}`, ix + iw / 2, iy + ih + labelH / 2);

      x += tileW + gapPx;
      rowMaxH = Math.max(rowMaxH, tileH);
      count++;
    }

    setPlaced(count);
    setFitting(allFit && count === tiles.length);
  }, [orders, selected, paperIdx, dpi, margin, gap]);

  const handlePrint = () => window.print();

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
      </section>

      {/* 订单选择 */}
      <section className="imp-section">
        <h2 className="inv-title">选择订单（{selected.size} 已选 / {orders.length} 可打印）</h2>
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

      {/* 操作 */}
      <section className="imp-actions">
        <button className="btn-impose" onClick={generate} disabled={selected.size === 0}>
          🧩 生成拼版
        </button>
        <button className="btn-print-sheet" onClick={handlePrint} disabled={placed === 0}>
          🖨️ 打印
        </button>
      </section>
      {placed > 0 && (
        <div className={`imp-result ${fitting ? 'ok' : 'warn'}`}>
          {fitting
            ? `✅ 已排版 ${placed} 张到 ${PAPERS[paperIdx].label}`
            : `⚠️ 纸张空间不足，已排版 ${placed} 张（共选 ${selected.size} 张），请换更大纸张或减少选择`}
        </div>
      )}

      {/* 拼版预览（打印时仅显示此区域） */}
      <div className="print-sheet-wrap">
        <canvas
          ref={canvasRef}
          className="print-sheet"
          style={{ width: `${PAPERS[paperIdx].w}mm`, height: `${PAPERS[paperIdx].h}mm` }}
        />
      </div>

      <nav className="inv-tabbar">
        <button onClick={() => onNavigate('orders')}>📋 订单</button>
        <button onClick={() => onNavigate('inventory')}>📦 库存</button>
        <button className="active" onClick={() => onNavigate('imposition')}>🖨️ 拼版</button>
      </nav>
    </div>
  );
}
