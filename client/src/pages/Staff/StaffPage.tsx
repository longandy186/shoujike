/**
 * 店员后台
 *
 * 列表页 → 查看所有订单，按取件码快速查找
 * 编辑页 → Canvas 调整图片，保存裁剪，流转状态
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ImageEditor, { type CropData, type ImageEditorHandle } from '../../components/ImageEditor';
import { getOrder, getOrders, saveCrop, updateOrderStatus, uploadPrint, rejectOrder, REJECT_REASONS } from '../../api';
import { initStaffRealtime } from '../../staffRealtime';
import { getProductById } from '../Guest/products';
import InventoryView from './InventoryView';
import PrintImposition from './PrintImposition';
import './Staff.css';

interface Order {
  id: number;
  order_id: string;
  pickup_code: string;
  image_url: string;
  status: string;
  master_sku: string;
  crop_data: string;
  print_url: string;
  created_at: string;
  customer_name: string;
}

type View = 'list' | 'edit';

const STATUS_LABEL: Record<string, string> = {
  NEW: '新订单',
  WAITING_CHECK: '待审核',
  READY_PRINT: '可打印',
  PRINTED: '已打印',
  PROCESSING: '制作中',
  COMPLETED: '已完成',
  REJECTED: '已驳回',
};

const STATUS_COLOR: Record<string, string> = {
  NEW: '#58a6ff',
  WAITING_CHECK: '#d29922',
  READY_PRINT: '#3fb950',
  PRINTED: '#8b949e',
  PROCESSING: '#bc8cff',
  COMPLETED: '#8b949e',
  REJECTED: '#f85149',
};

export default function StaffPage() {
  const [tab, setTab] = useState<'orders' | 'inventory' | 'imposition'>('orders');
  const [view, setView] = useState<View>('list');

  // 订单列表
  const [orders, setOrders] = useState<Order[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // 状态筛选
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'READY' | 'DONE'>('ALL');

  // 低库存预警数量（店员首页红点）
  const [alertCount, setAlertCount] = useState(0);

  // 取件码查询
  const [lookupCode, setLookupCode] = useState('');
  const [lookupError, setLookupError] = useState('');

  // 编辑模式
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printed, setPrinted] = useState(false);
  const [currentCrop, setCurrentCrop] = useState<CropData | null>(null);
  const editorRef = useRef<ImageEditorHandle>(null);

  // 来单 Toast + 实时响铃
  const [toast, setToast] = useState<string | null>(null);
  // 驳回
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState<string>('');

  // 加载订单列表
  const loadOrders = useCallback(async () => {
    setListLoading(true);
    const res = await getOrders();
    if (res.ok) {
      setOrders(res.data as Order[]);
    }
    setListLoading(false);
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // 拉取低库存预警数量（用于首页红点）
  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/alerts');
      const json = await res.json();
      setAlertCount(Array.isArray(json.data) ? json.data.length : 0);
    } catch {
      setAlertCount(0);
    }
  }, []);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  // 初始化店员端实时（Web Push + WebSocket 站内响铃）
  useEffect(() => {
    initStaffRealtime((code) => {
      setToast(`🔔 新订单 #${code}`);
      setTimeout(() => setToast(null), 6000);
    });
  }, []);

  // 按筛选过滤
  const filteredOrders = useMemo(() => {
    if (filter === 'ALL') return orders;
    if (filter === 'PENDING') return orders.filter((o) => ['NEW', 'WAITING_CHECK'].includes(o.status));
    if (filter === 'READY') return orders.filter((o) => o.status === 'READY_PRINT');
    if (filter === 'DONE') return orders.filter((o) => ['PRINTED', 'COMPLETED', 'PROCESSING'].includes(o.status));
    return orders;
  }, [orders, filter]);

  const counts = useMemo(() => ({
    ALL: orders.length,
    PENDING: orders.filter((o) => ['NEW', 'WAITING_CHECK'].includes(o.status)).length,
    READY: orders.filter((o) => o.status === 'READY_PRINT').length,
    DONE: orders.filter((o) => ['PRINTED', 'COMPLETED', 'PROCESSING'].includes(o.status)).length,
  }), [orders]);

  const productName = (sku: string) => getProductById(sku)?.name || sku;

  // 取件码查询
  const handleLookup = async () => {
    if (!lookupCode.trim()) return;
    setLookupError('');
    const codeRes = await fetch(`/api/orders/code/${lookupCode.trim()}`);
    if (codeRes.ok) {
      const data = await codeRes.json();
      enterEdit(data.data as Order);
      return;
    }
    const res = await getOrder(lookupCode.trim());
    if (res.ok) {
      enterEdit(res.data as Order);
      return;
    }
    setLookupError('未找到该订单');
  };

  // 进入编辑
  const enterEdit = (order: Order) => {
    setEditingOrder(order);
    try {
      const existing = JSON.parse(order.crop_data || '{}');
      if (existing.scale) setCurrentCrop(existing);
      else setCurrentCrop(null);
    } catch { setCurrentCrop(null); }
    setView('edit');
  };

  // 保存裁剪
  const handleSaveCrop = async () => {
    if (!editingOrder || !currentCrop) return;
    setSaving(true);
    const res = await saveCrop(editingOrder.order_id, currentCrop);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setEditingOrder(res.data as Order);
    }
    setSaving(false);
  };

  // 生成打印图（前端 Canvas 高清渲染 → 上传后端保存）
  const handleGeneratePrint = async () => {
    if (!editingOrder || !editorRef.current) return;
    setPrinting(true);
    setLookupError('');
    try {
      const dataUrl = editorRef.current.exportPrintImage(3);
      if (!dataUrl) {
        setLookupError('图片未加载完成，请稍候');
        setPrinting(false);
        return;
      }
      const res = await uploadPrint(editingOrder.order_id, dataUrl);
      if (res.ok) {
        setEditingOrder(res.data as Order);
        setPrinted(true);
        setTimeout(() => setPrinted(false), 2000);
      } else {
        setLookupError(res.error || '生成打印图失败');
      }
    } catch {
      setLookupError('生成打印图失败');
    }
    setPrinting(false);
  };

  // 状态流转
  const handleStatus = async (status: string) => {
    if (!editingOrder) return;
    const res = await updateOrderStatus(editingOrder.order_id, status);
    if (res.ok) {
      setEditingOrder(res.data as Order);
      loadOrders();
      loadAlerts();
    }
  };

  // 驳回（店员选预置原因，非手填）
  const handleReject = async () => {
    if (!editingOrder || !rejectReason) return;
    const res = await rejectOrder(editingOrder.order_id, rejectReason);
    if (res.ok) {
      setEditingOrder(res.data as Order);
      setShowReject(false);
      setRejectReason('');
      loadOrders();
    } else {
      setLookupError(res.error || '驳回失败');
    }
  };

  // 单图打印（弹系统打印机，与拼版页一致）
  const handlePrint = () => {
    if (!editingOrder?.print_url) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = editingOrder.print_url;
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        /* ignore */
      }
    };
    document.body.appendChild(iframe);
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        /* ignore */
      }
    }, 60000);
  };

  // ==================== 非订单标签页 ====================
  if (tab === 'inventory') return <InventoryView onNavigate={setTab} />;
  if (tab === 'imposition') return <PrintImposition onNavigate={setTab} />;

  // ==================== 编辑视图 ====================
  if (view === 'edit' && editingOrder) {
    return (
      <div className="staff-page">
        <header className="staff-header">
          <h1>
            {STATUS_LABEL[editingOrder.status] || editingOrder.status}
            {editingOrder.pickup_code && (
              <span className="header-code">#{editingOrder.pickup_code}</span>
            )}
          </h1>
        </header>
        {toast && <div className="new-order-toast">{toast}</div>}

        <div className="staff-section">
          <ImageEditor
            ref={editorRef}
            imageUrl={editingOrder.image_url}
            width={Math.min(360, window.innerWidth - 32)}
            initialCrop={currentCrop}
            onCropChange={setCurrentCrop}
          />

          <div className="staff-actions">
            <button className="btn-save" onClick={handleSaveCrop} disabled={saving}>
              {saving ? '保存中...' : saved ? '✅ 已保存' : '💾 保存裁剪'}
            </button>

            <button className="btn-print" onClick={handleGeneratePrint} disabled={printing}>
              {printing ? '生成中...' : printed ? '✅ 已生成' : '🖨️ 生成打印图'}
            </button>

            {editingOrder.print_url && (
              <button className="btn-print-out" onClick={() => window.open(editingOrder!.print_url, '_blank')}>
                📄 查看打印图
              </button>
            )}

            {editingOrder.print_url && (
              <button className="btn-print-out" onClick={handlePrint}>
                🖨️ 打印
              </button>
            )}

            <button className="btn-reject" onClick={() => { setShowReject((v) => !v); setRejectReason(''); }}>
              ⛔ 驳回
            </button>
            {showReject && (
              <div className="reject-panel">
                <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
                  <option value="">选择驳回原因…</option>
                  {REJECT_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button className="btn-reject-confirm" disabled={!rejectReason} onClick={handleReject}>
                  确认驳回
                </button>
                <button className="btn-reject-cancel" onClick={() => setShowReject(false)}>取消</button>
              </div>
            )}

            <div className="status-actions">
              {editingOrder.status === 'NEW' && (
                <button className="btn-status" onClick={() => handleStatus('WAITING_CHECK')}>
                  标记为待审核
                </button>
              )}
              {(editingOrder.status === 'NEW' || editingOrder.status === 'WAITING_CHECK') && (
                <button className="btn-status btn-ready" onClick={() => handleStatus('READY_PRINT')}>
                  标记为可打印
                </button>
              )}
              {editingOrder.status === 'READY_PRINT' && (
                <button className="btn-status btn-ready" onClick={() => handleStatus('PRINTED')}>
                  标记为已打印
                </button>
              )}
              {(editingOrder.status === 'PRINTED' || editingOrder.status === 'PROCESSING') && (
                <button className="btn-status" onClick={() => handleStatus('COMPLETED')}>
                  标记为已完成
                </button>
              )}
            </div>
          </div>

          <button className="btn-back" onClick={() => { setView('list'); loadOrders(); }}>
            ← 返回订单列表
          </button>
        </div>
      </div>
    );
  }

  // ==================== 订单列表视图 ====================
  return (
    <div className="staff-page">
      <header className="staff-header-main">
        <h1>店员后台</h1>
        <p>文创生产管理系统</p>
      </header>
      {toast && <div className="new-order-toast">{toast}</div>}

      <nav className="inv-tabbar inv-tabbar-top">
        <button onClick={() => setTab('orders')} className="active">📋 订单</button>
        <button onClick={() => setTab('inventory')}>
          📦 库存{alertCount > 0 && <span className="inv-badge">{alertCount}</span>}
        </button>
        <button onClick={() => setTab('imposition')}>🖨️ 拼版</button>
      </nav>

      <div className="staff-section">
        <div className="lookup-bar">
          <input
            type="text"
            placeholder="输入取件码..."
            value={lookupCode}
            onChange={(e) => setLookupCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
          />
          <button onClick={handleLookup}>查找</button>
        </div>
        {lookupError && <div className="lookup-error">{lookupError}</div>}

        <div className="filter-tabs">
          {(['ALL', 'PENDING', 'READY', 'DONE'] as const).map((key) => (
            <button
              key={key}
              className={`filter-tab ${filter === key ? 'active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {FILTER_LABEL[key]} {counts[key]}
            </button>
          ))}
        </div>

        <div className="order-list">
          <div className="list-header">
            <span>今日订单 · {filteredOrders.length}</span>
            <button className="btn-refresh" onClick={loadOrders}>🔄 刷新</button>
          </div>

          {listLoading ? (
            <div className="list-empty">加载中...</div>
          ) : filteredOrders.length === 0 ? (
            <div className="list-empty">暂无订单</div>
          ) : (
            filteredOrders.map((o) => (
              <div key={o.order_id} className="order-row" onClick={() => enterEdit(o)}>
                <div className="order-row-left">
                  <span className="order-code">
                    #{o.pickup_code || o.order_id.slice(0, 8)}
                  </span>
                  <span className="order-sku">{productName(o.master_sku)}</span>
                </div>
                <div className="order-row-right">
                  <span
                    className="order-status-dot"
                    style={{ background: STATUS_COLOR[o.status] || '#8b949e' }}
                  />
                  <span className="order-status-text">
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                  <span className="order-time">{o.created_at?.slice(11, 16)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const FILTER_LABEL: Record<string, string> = {
  ALL: '全部',
  PENDING: '待处理',
  READY: '可打印',
  DONE: '已完成',
};
