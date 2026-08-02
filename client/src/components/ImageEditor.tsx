/**
 * 图片裁剪编辑器 — 原生 Canvas 实现
 *
 * 功能：拖动 / 缩放 / cover 裁切 / 保存调整参数 / 导出高清打印图
 *
 * 数据流：
 *   cropData { x, y, scale, canvasW, canvasH }
 *   实际绘制时：图片以 (x, y) 为中心，缩放 scale 倍，超出的部分被 canvas clip
 */

import {
  forwardRef,
  useRef,
  useEffect,
  useCallback,
  useState,
  useImperativeHandle,
} from 'react';

export interface CropData {
  /** 图片中心 X 偏移（px，相对于 canvas 中心） */
  x: number;
  /** 图片中心 Y 偏移 */
  y: number;
  /** 缩放比例 */
  scale: number;
  /** Canvas 宽度 */
  canvasW: number;
  /** Canvas 高度 */
  canvasH: number;
}

export interface ImageEditorHandle {
  /**
   * 导出高清打印图（PNG dataURL）
   * @param exportScale 相对屏幕 canvas 的放大倍数（默认 3 → 约 1080px）
   */
  exportPrintImage: (exportScale?: number) => string | null;
}

interface Props {
  /** 图片 URL */
  imageUrl: string;
  /** Canvas 宽度 */
  width?: number;
  /** Canvas 高度（如不传则自动按比例） */
  height?: number;
  /** 初始裁剪参数（从订单恢复） */
  initialCrop?: Partial<CropData> | null;
  /** 裁剪参数变化回调 */
  onCropChange?: (crop: CropData) => void;
}

const ImageEditor = forwardRef<ImageEditorHandle, Props>(function ImageEditor(
  { imageUrl, width = 360, height, initialCrop, onCropChange },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // 视口尺寸
  const canvasW = width;
  const canvasH = height || width; // 默认正方形

  // 状态
  const [scale, setScale] = useState(initialCrop?.scale || 1);
  const [offsetX, setOffsetX] = useState(initialCrop?.x || 0);
  const [offsetY, setOffsetY] = useState(initialCrop?.y || 0);
  const [loaded, setLoaded] = useState(false);
  const [imgNaturalW, setImgNaturalW] = useState(0);
  const [imgNaturalH, setImgNaturalH] = useState(0);

  // 拖动状态
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragOffsetStart = useRef({ x: 0, y: 0 });

  // 最小缩放 = cover 裁切（图片刚好覆盖 canvas）
  const minScale = imgNaturalW && imgNaturalH
    ? Math.max(canvasW / imgNaturalW, canvasH / imgNaturalH)
    : 1;

  // 发射 crop 数据
  const emitCrop = useCallback(() => {
    onCropChange?.({
      x: Math.round(offsetX),
      y: Math.round(offsetY),
      scale: Math.round(scale * 100) / 100,
      canvasW,
      canvasH,
    });
  }, [offsetX, offsetY, scale, canvasW, canvasH, onCropChange]);

  // 核心绘制逻辑（可复用于屏幕与导出）
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, s: number, ox: number, oy: number, img: HTMLImageElement) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2 + ox;
      const cy = h / 2 + oy;
      const sw = img.naturalWidth * s;
      const sh = img.naturalHeight * s;

      // cover 裁切
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      ctx.drawImage(img, cx - sw / 2, cy - sh / 2, sw, sh);
      ctx.restore();
    },
    []
  );

  // 绘制屏幕 canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paint(ctx, canvasW, canvasH, scale, offsetX, offsetY, img);
  }, [canvasW, canvasH, scale, offsetX, offsetY, paint]);

  // 加载图片
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setImgNaturalW(img.naturalWidth);
      setImgNaturalH(img.naturalHeight);

      const initScale = Math.max(canvasW / img.naturalWidth, canvasH / img.naturalHeight);
      if (!initialCrop?.scale) {
        setScale(initScale);
      }
      setLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl, canvasW, canvasH, initialCrop]);

  // 重绘
  useEffect(() => {
    if (loaded) draw();
  }, [loaded, offsetX, offsetY, scale, draw]);

  // 暴露导出方法
  useImperativeHandle(ref, () => ({
    exportPrintImage: (exportScale = 3) => {
      const img = imageRef.current;
      if (!img || !loaded) return null;
      const out = document.createElement('canvas');
      out.width = Math.round(canvasW * exportScale);
      out.height = Math.round(canvasH * exportScale);
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      paint(ctx, out.width, out.height, scale * exportScale, offsetX * exportScale, offsetY * exportScale, img);
      return out.toDataURL('image/png');
    },
  }), [loaded, canvasW, canvasH, scale, offsetX, offsetY, paint]);

  // -------------------- 事件处理 --------------------

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    dragging.current = true;
    dragStart.current = pos;
    dragOffsetStart.current = { x: offsetX, y: offsetY };
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging.current) return;
    e.preventDefault();
    const pos = getPos(e);
    const dx = pos.x - dragStart.current.x;
    const dy = pos.y - dragStart.current.y;
    setOffsetX(dragOffsetStart.current.x + dx);
    setOffsetY(dragOffsetStart.current.y + dy);
  };

  const handleEnd = () => {
    if (dragging.current) {
      dragging.current = false;
      emitCrop();
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setScale((prev) => {
      const next = Math.max(minScale * 0.8, Math.min(prev + delta, 3));
      return Math.round(next * 100) / 100;
    });
    setTimeout(emitCrop, 100);
  };

  // 重置
  const handleReset = () => {
    setOffsetX(0);
    setOffsetY(0);
    setScale(minScale);
    setTimeout(emitCrop, 100);
  };

  return (
    <div className="image-editor">
      <canvas
        ref={canvasRef}
        width={canvasW * 2}
        height={canvasH * 2}
        style={{ width: canvasW, height: canvasH }}
        className="editor-canvas"
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        onWheel={handleWheel}
      />

      <div className="editor-controls">
        <button onClick={() => setScale((s) => Math.round(Math.min(s + 0.1, 3) * 100) / 100)} title="放大">
          🔍+
        </button>
        <button onClick={() => setScale((s) => Math.round(Math.max(s - 0.1, minScale * 0.8) * 100) / 100)} title="缩小">
          🔍-
        </button>
        <button onClick={handleReset} title="重置">
          ↺ 重置
        </button>
      </div>

      <div className="editor-hint">
        拖动移动 · 滚轮缩放 · cover 裁切
      </div>

      <style>{`
        .image-editor {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.6rem;
        }
        .editor-canvas {
          border-radius: 8px;
          cursor: grab;
          touch-action: none;
        }
        .editor-canvas:active {
          cursor: grabbing;
        }
        .editor-controls {
          display: flex;
          gap: 0.5rem;
        }
        .editor-controls button {
          padding: 0.4rem 0.8rem;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 6px;
          background: rgba(255,255,255,0.08);
          color: #e0e0e0;
          cursor: pointer;
          font-size: 0.85rem;
        }
        .editor-controls button:hover {
          background: rgba(233,69,96,0.2);
        }
        .editor-hint {
          font-size: 0.75rem;
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
});

export default ImageEditor;
