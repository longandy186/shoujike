/**
 * 库存管理视图（Phase 1.5 库存/预警 UI）
 * - 物料库存卡片（当前库存 / 已使用 / 安全库存 / 状态）
 * - 各产品可生产数量
 * - 低库存预警列表
 * - 采购入库（手动入库）
 */

import { useState, useEffect, useCallback } from 'react';
import { getInventorySummary, getInventoryAlerts, stockIn } from '../../api';

interface MaterialWithStats {
  material_id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  safety_stock: number;
  used: number;
}

interface BomCapacity {
  materialId: string;
  name: string;
  need: number;
  have: number;
  enough: boolean;
}

interface ProductCapacity {
  masterSku: string;
  name: string;
  producible: number;
  bom: BomCapacity[];
}

interface ActiveAlert {
  material_id: string;
  material_name: string;
  remaining: number;
  safety_stock: number;
  created_at: string;
}

interface Summary {
  materials: MaterialWithStats[];
  products: ProductCapacity[];
  alerts: ActiveAlert[];
}

interface Props {
  onNavigate: (tab: 'orders' | 'inventory' | 'imposition') => void;
}

export default function InventoryView({ onNavigate }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  // 入库表单
  const [selected, setSelected] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, a] = await Promise.all([getInventorySummary(), getInventoryAlerts()]);
    if (s.ok) {
      const data = s.data as Summary;
      // 用 alerts 接口结果覆盖 summary.alerts（保证实时）
      data.alerts = (a.ok ? (a.data as ActiveAlert[]) : data.alerts);
      setSummary(data);
      if (data.materials.length > 0 && !selected) {
        setSelected(data.materials[0].material_id);
      }
    }
    setLoading(false);
  }, [selected]);

  useEffect(() => { load(); }, [load]);

  const handleStockIn = async () => {
    const n = parseInt(qty, 10);
    if (!selected || !Number.isInteger(n) || n <= 0) {
      setMsg({ type: 'err', text: '请输入有效的正整数入库数量' });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    const res = await stockIn(selected, n, note);
    setSubmitting(false);
    if (res.ok) {
      setMsg({ type: 'ok', text: `✅ 入库成功：${n} ${note ? '(' + note + ')' : ''}` });
      setQty('');
      setNote('');
      load();
    } else {
      setMsg({ type: 'err', text: res.error || '入库失败' });
    }
  };

  if (loading && !summary) {
    return <div className="staff-section"><div className="list-empty">加载中...</div></div>;
  }

  return (
    <div className="staff-page-inner">
      <header className="inv-header">
        <button className="inv-back" onClick={() => onNavigate('orders')}>← 返回订单</button>
        <h1>库存管理</h1>
        <button className="inv-refresh" onClick={load}>🔄</button>
      </header>

      {/* 预警横幅 */}
      {summary && summary.alerts.length > 0 && (
        <div className="inv-alert-banner">
          ⚠️ {summary.alerts.length} 种物料低于安全库存：
          {summary.alerts.map((a) => (
            <span key={a.material_id} className="inv-alert-chip">
              {a.material_name} 剩 {a.remaining}
            </span>
          ))}
        </div>
      )}

      {/* 可生产数量 */}
      <section className="inv-section">
        <h2 className="inv-title">可生产数量</h2>
        <div className="inv-prod-grid">
          {summary?.products.map((p) => (
            <div key={p.masterSku} className="inv-prod-card">
              <div className="inv-prod-name">{p.name}</div>
              <div className="inv-prod-num">{p.producible}</div>
              <div className="inv-prod-label">件可生产</div>
              <div className="inv-prod-bom">
                {p.bom.map((b) => (
                  <span
                    key={b.materialId}
                    className={`inv-bom-tag ${b.enough ? '' : 'lack'}`}
                    title={`${b.name} 需${b.need}/有${b.have}`}
                  >
                    {b.name} {b.have}/{b.need}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 物料库存 */}
      <section className="inv-section">
        <h2 className="inv-title">物料库存</h2>
        <div className="inv-mat-list">
          {summary?.materials.map((m) => {
            const low = m.current_stock < m.safety_stock;
            const pct = m.safety_stock > 0 ? Math.min(100, Math.round((m.current_stock / (m.safety_stock * 3)) * 100)) : 100;
            return (
              <div key={m.material_id} className={`inv-mat-row ${low ? 'low' : ''}`}>
                <div className="inv-mat-main">
                  <span className="inv-mat-name">{m.name}</span>
                  <span className="inv-mat-id">{m.material_id}</span>
                </div>
                <div className="inv-mat-stock">
                  <span className="inv-mat-cur">{m.current_stock}</span>
                  <span className="inv-mat-unit">{m.unit}</span>
                  <span className="inv-mat-safe">安全 {m.safety_stock}</span>
                </div>
                <div className="inv-mat-bar">
                  <div className={`inv-mat-bar-fill ${low ? 'low' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="inv-mat-used">已使用 {m.used}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 采购入库 */}
      <section className="inv-section">
        <h2 className="inv-title">采购入库</h2>
        <div className="inv-stockin">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {summary?.materials.map((m) => (
              <option key={m.material_id} value={m.material_id}>{m.name}（{m.material_id}）</option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            placeholder="数量"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <input
            type="text"
            placeholder="备注（可选）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn-stockin" onClick={handleStockIn} disabled={submitting}>
            {submitting ? '入库中...' : '📥 入库'}
          </button>
        </div>
        {msg && (
          <div className={msg.type === 'ok' ? 'inv-msg-ok' : 'inv-msg-err'}>{msg.text}</div>
        )}
      </section>

      <nav className="inv-tabbar">
        <button onClick={() => onNavigate('orders')}>📋 订单</button>
        <button className="active" onClick={() => onNavigate('inventory')}>📦 库存</button>
        <button onClick={() => onNavigate('imposition')}>🖨️ 拼版</button>
      </nav>
    </div>
  );
}
