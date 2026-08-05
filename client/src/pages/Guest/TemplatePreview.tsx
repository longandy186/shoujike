/**
 * 模板适配预览（核心差异化功能）
 * 把游客原图按产品的「印刷区(printArea)」比例精准 cover 适配，
 * 合成到产品外形（按分类生成的占位外形，无需真实素材），
 * 并叠加「出血虚线 + 裁切实线」与生产端一致，让游客看到最终实物的样子。
 *
 * 收货：photoSrc + PreviewProduct（含 printArea / bleed / physicalSize / category）
 */
import { useEffect, useRef } from 'react';

export interface PreviewProduct {
  masterSku: string;
  category: string; // frame | keychain | phonecase | magnet | canvasbag
  printArea: { x: number; y: number; width: number; height: number; unit: string };
  bleed: number;
  physicalSize?: { width: number; height: number; unit: string };
}

interface Props {
  photoSrc: string;
  product: PreviewProduct;
  width?: number;
  height?: number;
}

const CATEGORY_SHAPE: Record<string, 'rect' | 'keychain' | 'phone' | 'bag'> = {
  frame: 'rect',
  keychain: 'keychain',
  phonecase: 'phone',
  magnet: 'rect',
  canvasbag: 'bag',
};

/** 把图片 cover 绘制到目标矩形 */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, dx: number, dy: number, dw: number, dh: number) {
  const scale = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
  const sw = img.naturalWidth * scale;
  const sh = img.naturalHeight * scale;
  ctx.drawImage(img, dx + (dw - sw) / 2, dy + (dh - sh) / 2, sw, sh);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export default function TemplatePreview({ photoSrc, product, width = 300, height = 380 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => renderProduct(ctx, img);
    img.onerror = () => renderProduct(ctx, null);
    img.src = photoSrc;

    function renderProduct(c: CanvasRenderingContext2D, photo: HTMLImageElement | null) {
      const phys = product.physicalSize ?? { width: product.printArea.width + 10, height: product.printArea.height + 10, unit: 'mm' };
      const pad = 18;
      const availW = width - pad * 2;
      const availH = height - pad * 2;
      const scale = Math.min(availW / phys.width, availH / phys.height);
      const bw = phys.width * scale;
      const bh = phys.height * scale;
      const bx = (width - bw) / 2;
      const by = (height - bh) / 2;

      const shape = CATEGORY_SHAPE[product.category] ?? 'rect';

      // ---- 产品外形 ----
      c.save();
      if (shape === 'keychain') {
        // 圆环 + 亚克力片
        c.strokeStyle = '#b9b9c0';
        c.lineWidth = 5;
        c.beginPath();
        c.arc(bx + bw / 2, by - 8, 8, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = '#f3f4f8';
        roundRect(c, bx, by, bw, bh, 8);
        c.fill();
        c.strokeStyle = '#d7d8e0';
        c.lineWidth = 2;
        c.stroke();
      } else if (shape === 'phone') {
        c.fillStyle = '#1c1f26';
        roundRect(c, bx, by, bw, bh, Math.min(bw, bh) * 0.12);
        c.fill();
        // 摄像头
        c.fillStyle = '#3a3f4a';
        c.beginPath();
        c.arc(bx + bw * 0.18, by + bh * 0.06, Math.min(bw, bh) * 0.03, 0, Math.PI * 2);
        c.fill();
      } else if (shape === 'bag') {
        // 提手
        c.strokeStyle = '#caa66a';
        c.lineWidth = 6;
        c.beginPath();
        c.arc(bx + bw * 0.32, by, bw * 0.18, Math.PI, 0);
        c.stroke();
        c.beginPath();
        c.arc(bx + bw * 0.68, by, bw * 0.18, Math.PI, 0);
        c.stroke();
        // 袋身
        c.fillStyle = '#efe6d2';
        roundRect(c, bx, by + bh * 0.04, bw, bh * 0.96, 6);
        c.fill();
        c.strokeStyle = '#d8c8a4';
        c.lineWidth = 2;
        c.stroke();
      } else {
        // rect（相框/冰箱贴）：白边外形
        c.fillStyle = product.category === 'frame' ? '#e9e4da' : '#ffffff';
        roundRect(c, bx, by, bw, bh, 6);
        c.fill();
        c.strokeStyle = '#cfc8ba';
        c.lineWidth = 2;
        c.stroke();
      }
      c.restore();

      // ---- 印刷区（按 printArea 真实偏移/尺寸）----
      const innerX = bx + (product.printArea.x / phys.width) * bw;
      const innerY = by + (product.printArea.y / phys.height) * bh;
      const innerW = (product.printArea.width / phys.width) * bw;
      const innerH = (product.printArea.height / phys.height) * bh;

      // 照片 cover 进印刷区
      c.save();
      if (shape === 'keychain' || shape === 'phone') roundRect(c, innerX, innerY, innerW, innerH, 4);
      else c.rect(innerX, innerY, innerW, innerH);
      c.clip();
      if (photo) drawCover(c, photo, innerX, innerY, innerW, innerH);
      else {
        c.fillStyle = '#cccccc';
        c.fillRect(innerX, innerY, innerW, innerH);
      }
      c.restore();

      // ---- 裁切实线（印刷区边界，黑实线）----
      c.strokeStyle = '#000000';
      c.lineWidth = 1;
      if (shape === 'keychain' || shape === 'phone') {
        roundRect(c, innerX, innerY, innerW, innerH, 4);
        c.stroke();
      } else {
        c.strokeRect(innerX, innerY, innerW, innerH);
      }

      // ---- 出血虚线（印刷区外扩 bleed，灰虚线）----
      const bleedPx = (product.bleed / phys.width) * bw;
      const bl = Math.max(bleedPx, 3);
      c.strokeStyle = '#9a9a9a';
      c.lineWidth = 1;
      c.setLineDash([4, 3]);
      c.strokeRect(innerX - bl, innerY - bl, innerW + bl * 2, innerH + bl * 2);
      c.setLineDash([]);
    }
  }, [photoSrc, product, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 10 }} />;
}
