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
  const canvasW = width;
  const canvasH = height || width;

  const stageRef = useRef<Konva.Stage>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [scale, setScale] = useState(initialCrop?.scale || 1);
  const [offsetX, setOffsetX] = useState(initialCrop?.x || 0);
  const [offsetY, setOffsetY] = useState(initialCrop?.y || 0);

  // 最小缩放 = cover 裁切（图片刚好覆盖 canvas）
  const minScale = img ? Math.max(canvasW / img.width, canvasH / img.height) : 1;

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

  // 暴露导出方法（用 Konva Stage 高分辨率导出，clip 保证只输出 canvas 区域）
  useImperativeHandle(
    ref,
    () => ({
      exportPrintImage: (exportScale = 3) => {
        const stage = stageRef.current;
        if (!stage || !loaded) return null;
        try {
          return stage.toDataURL({ pixelRatio: exportScale, mimeType: 'image/png' });
        } catch {
          return null;
        }
      },
    }),
    [loaded]
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

  return (
    <div className="image-editor">
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
        拖动移动 · 滚轮缩放 · cover 裁切（Konva）
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
