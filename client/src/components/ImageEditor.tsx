/**
 * 图片裁剪编辑器 — 基于 Konva.js 实现（任务 C 升级）
 *
 * 取代原先的原生 Canvas 实现，获得图层 / 变换手柄 / 拖拽缩放等能力，
 * 并保持一致的对内 API：
 *   - Props: imageUrl / width / height / initialCrop / onCropChange
 *   - CropData { x, y, scale, canvasW, canvasH }
 *   - forwardRef 暴露 exportPrintImage(scale) → PNG dataURL（店员端上传打印图用）
 *
 * 数据流：图片以 (canvasW/2 + x, canvasH/2 + y) 为中心，缩放 scale 倍，超出 canvas 部分被 Group clip 裁掉（cover 裁切）。
 */

import {
  forwardRef,
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
  useImperativeHandle,
} from 'react';
import { Stage, Layer, Group, Image as KonvaImage, Rect } from 'react-konva';
import Konva from 'konva';

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

/** 产品打印规格（来自 products 表：印刷区/内径 + 整体尺寸 + 出血 + DPI） */
export interface PrintProductSpec {
  printArea?: { x?: number; y?: number; width: number; height: number; unit?: string };
  physicalSize?: { width: number; height: number; unit?: string };
  bleed?: number;
  dpi?: number;
}

/**
 * 编辑画布尺寸 + 内径窗口参考线位置（仅用于屏幕显示）。
 * 画布按「印刷区(内径) + 两侧出血」的真实长宽比显示（最长边 = maxSide）。
 */
export function computePrintGeometry(
  product: PrintProductSpec | undefined,
  maxSide: number
): {
  canvasW: number;
  canvasH: number;
  bleedMm: number;
  window: { left: number; top: number; width: number; height: number } | null;
  boxWmm: number;
  boxHmm: number;
  winW: number;
  winH: number;
} {
  const pa = product?.printArea;
  const ps = product?.physicalSize;
  const winW = pa?.width ?? ps?.width ?? 0;
  const winH = pa?.height ?? ps?.height ?? 0;
  const hasWin = winW > 0 && winH > 0;
  const bleedMm = product?.bleed ?? 2;

  let canvasW = maxSide;
  let canvasH = maxSide;
  let windowBox: { left: number; top: number; width: number; height: number } | null = null;
  const boxWmm = winW + 2 * bleedMm;
  const boxHmm = winH + 2 * bleedMm;

  if (hasWin) {
    if (boxHmm >= boxWmm) {
      canvasH = maxSide;
      canvasW = Math.max(1, Math.round(maxSide * (boxWmm / boxHmm)));
    } else {
      canvasW = maxSide;
      canvasH = Math.max(1, Math.round(maxSide * (boxHmm / boxWmm)));
    }
    // 内径窗口在屏幕画布上的位置（居中，四周 = 出血）
    const left = Math.round((bleedMm / boxWmm) * canvasW);
    const top = Math.round((bleedMm / boxHmm) * canvasH);
    windowBox = { left, top, width: canvasW - 2 * left, height: canvasH - 2 * top };
  }
  return { canvasW, canvasH, bleedMm, window: windowBox, boxWmm, boxHmm, winW, winH };
}

/** 导出 DPI 下限（照片级印刷标准）与上限（防止文件过大） */
export const MIN_DPI = 300;
export const MAX_DPI = 600;

/**
 * 导出分辨率：在「物理尺寸 = (内径 + 出血) mm」恒定的前提下，尽量吃满原图分辨率。
 * - 物理尺寸恒定 → 打印一定贴合产品
 * - 像素数 = 裁切窗口实际能提供的原图分辨率，限制在 [MIN_DPI, MAX_DPI]
 *   · 原图清晰 → 用满（封顶 MAX_DPI）
 *   · 原图偏低 → 按下限放大并标记 lowRes（可能偏软）
 * cropWpx = canvasW / scale 为该裁切窗口对应的原图像素宽（1 屏幕 px = 1/scale 原图像素）。
 */
export function resolveExport(
  product: PrintProductSpec | undefined,
  canvasW: number,
  canvasH: number,
  srcW: number,
  srcH: number,
  scale: number
): {
  targetW: number;
  targetH: number;
  pixelRatio: number;
  srcDpi: number;
  outDpi: number;
  lowRes: boolean;
} | null {
  const pa = product?.printArea;
  const ps = product?.physicalSize;
  const winW = pa?.width ?? ps?.width ?? 0;
  const winH = pa?.height ?? ps?.height ?? 0;
  const bleed = product?.bleed ?? 2;
  const boxW = winW + 2 * bleed;
  const boxH = winH + 2 * bleed;
  if (winW <= 0 || winH <= 0 || !srcW || !srcH || !(scale > 0)) return null;
  const cropWpx = canvasW / scale; // 裁切窗口对应的原图像素宽
  const srcDpi = (cropWpx / boxW) * 25.4;
  const outDpi = Math.min(MAX_DPI, Math.max(MIN_DPI, srcDpi));
  const targetW = Math.round((boxW / 25.4) * outDpi);
  const targetH = Math.round((boxH / 25.4) * outDpi);
  const pixelRatio = targetW / canvasW;
  return { targetW, targetH, pixelRatio, srcDpi, outDpi, lowRes: srcDpi < MIN_DPI - 0.5 };
}

export interface ImageEditorHandle {
  /**
   * 导出高清打印图（PNG dataURL）
   * @param exportScale 相对屏幕 canvas 的放大倍数（默认 3 → 约 1080px）
   */
  exportPrintImage: (exportScale?: number) => string | null;
}

/**
 * 离线「AI 裁剪」主体检测（零依赖、零外网）。
 * 思路：裁图分析用小图 → (1) 肤色掩膜取包围盒中心（人脸优先）；
 * (2) 失败回退到细节方差加权质心（人眼/文字等高频区）；再失败用图像中心。
 * 实测：证件照/自拍/合照都能把人脸放到画面中心，避免头像被裁。
 * 升级路径：可换 MediaPipe FaceDetector（需 CDN 模型 + 外网），接口一致。
 */
function isSkinTone(r: number, g: number, b: number): boolean {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  if (max - min > 0.28) return false; // 过饱和（蓝天/绿草）
  if (rr < 0.45 || bb > 0.6) return false;
  if (rr >= bb && rr >= gg && rr - bb >= 0.08 && gg > 0.25) return true;
  return false;
}

function detailCentroid(
  data: Uint8ClampedArray, AW: number, AH: number, s: number, img: HTMLImageElement
): { x: number; y: number } {
  const step = 8;
  let sw = 0, sx = 0, sy = 0;
  for (let y = 0; y < AH - step; y += step) {
    for (let x = 0; x < AW - step; x += step) {
      const vals: number[] = [];
      let sum = 0;
      for (let dy = 0; dy < step; dy += 2) {
        for (let dx = 0; dx < step; dx += 2) {
          const i = ((y + dy) * AW + (x + dx)) * 4;
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          vals.push(lum); sum += lum;
        }
      }
      const mean = sum / vals.length;
      let v = 0;
      for (const l of vals) v += (l - mean) * (l - mean);
      v /= vals.length;
      sw += v; sx += v * x; sy += v * y;
    }
  }
  if (sw <= 0) return { x: img.width / 2, y: img.height / 2 };
  return { x: sx / sw / s, y: sy / sw / s };
}

export function detectSubjectCenter(img: HTMLImageElement): { x: number; y: number } {
  try {
    const AW = 240;
    const s = AW / img.width;
    const AH = Math.max(1, Math.round(img.height * s));
    const cv = document.createElement('canvas');
    cv.width = AW; cv.height = AH;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { x: img.width / 2, y: img.height / 2 };
    ctx.drawImage(img, 0, 0, AW, AH);
    const data = ctx.getImageData(0, 0, AW, AH).data;

    // 1) 肤色包围盒
    let minX = AW, minY = AH, maxX = -1, maxY = -1, skin = 0;
    const total = (AW >> 1) * (AH >> 1);
    for (let y = 0; y < AH; y += 2) {
      for (let x = 0; x < AW; x += 2) {
        const i = (y * AW + x) * 4;
        if (isSkinTone(data[i], data[i + 1], data[i + 2])) {
          skin++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (skin > total * 0.02 && maxX > minX && maxY > minY) {
      return {
        x: ((minX + maxX) / 2) / s,
        y: Math.max(((minY + maxY) / 2) / s, img.height * 0.25), // 轻微上移更自然
      };
    }
    // 2) 细节质心回退
    return detailCentroid(data, AW, AH, s, img);
  } catch {
    return { x: img.width / 2, y: img.height / 2 };
  }
}

interface Props {
  /** 图片 URL */
  imageUrl: string;
  /** Canvas 最长边（屏幕显示用，默认 360） */
  width?: number;
  /** 初始裁剪参数（从订单恢复） */
  initialCrop?: Partial<CropData> | null;
  /** 裁剪参数变化回调 */
  onCropChange?: (crop: CropData) => void;
  /** 产品打印规格（印刷区/内径 + 出血 + DPI），用于让打印图尺寸贴合产品 */
  product?: PrintProductSpec;
}

const ImageEditor = forwardRef<ImageEditorHandle, Props>(function ImageEditor(
  { imageUrl, width = 360, initialCrop, onCropChange, product },
  ref
) {
  const maxSide = width;
  const geo = computePrintGeometry(product, maxSide);
  const canvasW = geo.canvasW;
  const canvasH = geo.canvasH;

  const stageRef = useRef<Konva.Stage>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  // AI 裁剪（离线人脸/主体居中）
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');

  const [scale, setScale] = useState(initialCrop?.scale || 1);
  const [offsetX, setOffsetX] = useState(initialCrop?.x || 0);
  const [offsetY, setOffsetY] = useState(initialCrop?.y || 0);

  // 最小缩放 = cover 裁切（图片刚好覆盖 canvas）
  const minScale = img ? Math.max(canvasW / img.width, canvasH / img.height) : 1;

  // 导出分辨率（吃满原图，受 [MIN_DPI, MAX_DPI] 限制）
  const exp = useMemo(
    () => (product && img ? resolveExport(product, canvasW, canvasH, img.width, img.height, scale) : null),
    [product, img, canvasW, canvasH, scale]
  );

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

  // 加载图片
  useEffect(() => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      setImg(im);
      const initScale = Math.max(canvasW / im.width, canvasH / im.height);
      if (!initialCrop?.scale) setScale(initScale);
      setLoaded(true);
    };
    im.src = imageUrl;
  }, [imageUrl, canvasW, canvasH, initialCrop]);

  // 图片就绪后发射一次初始 crop。
  // 否则 onCropChange 只在拖拽/缩放/AI裁剪时触发：店员打开新订单若不做任何调整，
  // 父组件 currentCrop 始终为 null，「💾 保存裁剪」会被 `if (!currentCrop) return`
  // 静默拦截——按钮点了没反应也没报错。
  useEffect(() => {
    if (!loaded || !img) return;
    emitCrop();
    // 只在图片就绪时发一次；emitCrop 随 offset/scale 变化重建，不列为依赖以免重复发射
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, img]);

  // 暴露导出方法（用 Konva Stage 高分辨率导出，clip 保证只输出 canvas 区域）
  useImperativeHandle(
    ref,
    () => ({
      exportPrintImage: (scale?: number) => {
        const stage = stageRef.current;
        if (!stage || !loaded) return null;
        // 优先用「吃满原图」的分辨率；无产品规格时回退到 3x
        const pr = scale ?? (exp ? exp.pixelRatio : 3);
        try {
          return stage.toDataURL({ pixelRatio: pr, mimeType: 'image/png' });
        } catch {
          return null;
        }
      },
    }),
    [loaded, exp]
  );

  // 拖动：更新图片中心偏移
  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    setOffsetX(node.x() - canvasW / 2);
    setOffsetY(node.y() - canvasH / 2);
  };
  const handleDragEnd = () => emitCrop();

  // 滚轮缩放
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const delta = e.evt.deltaY > 0 ? -0.05 : 0.05;
    setScale((prev) => Math.round(Math.max(minScale * 0.8, Math.min(prev + delta, 3)) * 100) / 100);
    setTimeout(emitCrop, 100);
  };

  // 重置
  const handleReset = () => {
    setOffsetX(0);
    setOffsetY(0);
    setScale(minScale);
    setTimeout(emitCrop, 100);
  };

  // AI 裁剪：检测人脸/主体并居中到画布中心（相框等安全区即画面中心）
  const handleAiCrop = useCallback(() => {
    if (!img) return;
    setAiBusy(true);
    setAiMsg('检测中…');
    // 让 loading 先渲染
    setTimeout(() => {
      try {
        const c = detectSubjectCenter(img);
        const ns = Math.max(minScale, scale);
        const nx = -(c.x - img.width / 2) * ns;
        const ny = -(c.y - img.height / 2) * ns;
        const rScale = Math.round(ns * 100) / 100;
        const rX = Math.round(nx);
        const rY = Math.round(ny);
        setScale(rScale);
        setOffsetX(rX);
        setOffsetY(rY);
        onCropChange?.({ x: rX, y: rY, scale: rScale, canvasW, canvasH });
        setAiMsg('✅ 已按人脸/主体自动居中');
      } catch {
        setOffsetX(0);
        setOffsetY(0);
        onCropChange?.({ x: 0, y: 0, scale: Math.round(minScale * 100) / 100, canvasW, canvasH });
        setAiMsg('⚠ 检测失败，已回到居中');
      }
      setTimeout(() => setAiBusy(false), 400);
    }, 40);
  }, [img, minScale, scale, onCropChange, canvasW, canvasH]);

  return (
    <div className="image-editor">
      <div className="editor-stage-wrap" style={{ position: 'relative', width: canvasW, height: canvasH }}>
        <Stage
          ref={stageRef}
          width={canvasW}
          height={canvasH}
          style={{ width: canvasW, height: canvasH, borderRadius: 8, cursor: 'grab', touchAction: 'none' }}
          onWheel={handleWheel}
        >
          <Layer>
            {/* 白色底，避免透明 */}
            <Rect x={0} y={0} width={canvasW} height={canvasH} fill="#ffffff" />
            {/* clip 到 canvas 区域，实现 cover 裁切 */}
            <Group clipX={0} clipY={0} clipWidth={canvasW} clipHeight={canvasH}>
              {img && (
                <KonvaImage
                  image={img}
                  width={img.width}
                  height={img.height}
                  offsetX={img.width / 2}
                  offsetY={img.height / 2}
                  x={canvasW / 2 + offsetX}
                  y={canvasH / 2 + offsetY}
                  scaleX={scale}
                  scaleY={scale}
                  draggable
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                />
              )}
            </Group>
          </Layer>
        </Stage>
        {/* 内径窗口参考线（仅显示，不进入导出图） */}
        {geo.window && (
          <div
            className="editor-window-guide"
            style={{
              left: geo.window.left,
              top: geo.window.top,
              width: geo.window.width,
              height: geo.window.height,
            }}
          />
        )}
      </div>

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
        <button className="btn-ai-crop" onClick={handleAiCrop} disabled={aiBusy || !loaded} title="自动把人脸/主体居中到画面中心">
          {aiBusy ? '🤖…' : '🤖 AI 裁剪'}
        </button>
      </div>

      {aiMsg && <div className={`editor-ai-msg ${aiMsg.startsWith('⚠') ? 'warn' : 'ok'}`}>{aiMsg}</div>}

      <div className="editor-hint">
        拖动移动 · 滚轮缩放 · cover 裁切（Konva）
      </div>
      {product && (
        <div className="editor-spec">
          打印尺寸（内径）: {geo.winW}×{geo.winH} mm + 出血 {geo.bleedMm}mm
          {exp ? (
            <>
              {' → 导出 '}
              {exp.targetW}×{exp.targetH}px @ {Math.round(exp.outDpi)}dpi
              {exp.lowRes && <span className="editor-warn"> ⚠ 原图分辨率偏低，已按300dpi放大，可能偏软</span>}
            </>
          ) : (
            <> → 计算中…</>
          )}
        </div>
      )}

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
        .editor-stage-wrap {
          border-radius: 8px;
          overflow: hidden;
        }
        .editor-window-guide {
          position: absolute;
          border: 1.5px dashed #58a6ff;
          box-sizing: border-box;
          pointer-events: none;
          border-radius: 2px;
        }
        .editor-spec {
          font-size: 0.78rem;
          opacity: 0.85;
          color: #7ee787;
          text-align: center;
          max-width: 360px;
          line-height: 1.4;
        }
        .editor-warn {
          color: #f0a02b;
          font-weight: 500;
        }
        .btn-ai-crop {
          padding: 0.4rem 0.7rem;
          border: 1px solid rgba(124,207,255,0.5);
          border-radius: 6px;
          background: rgba(56,139,253,0.18);
          color: #c9e4ff;
          cursor: pointer;
          font-size: 0.85rem;
        }
        .btn-ai-crop:hover:not(:disabled) {
          background: rgba(56,139,253,0.35);
        }
        .btn-ai-crop:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .editor-ai-msg {
          font-size: 0.76rem;
          padding: 0.25rem 0.6rem;
          border-radius: 6px;
        }
        .editor-ai-msg.ok {
          color: #3fb950;
          background: #23863622;
        }
        .editor-ai-msg.warn {
          color: #f0a02b;
          background: #e3a00822;
        }
      `}</style>
    </div>
  );
});

export default ImageEditor;
