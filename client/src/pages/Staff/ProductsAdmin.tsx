/**
 * 店员后台 · 商品管理（数据驱动）
 * 在这里新增 / 编辑 / 删除 SKU、改价格、入库、换商品图与模板图，
 * 游客端价格与库存实时联动，无需改代码。
 */
import { useState, useEffect, useCallback } from 'react';
import {
  getAdminProducts,
  createAdminProduct,
  updateAdminProduct,
  deleteAdminProduct,
  adminStockIn,
  adminUploadProductImage,
  type AdminProduct,
} from '../../api';

type Tab = 'orders' | 'inventory' | 'imposition' | 'products';
interface Props {
  onNavigate: (tab: Tab) => void;
}

const CATEGORIES = [
  { v: 'frame', label: '相框' },
  { v: 'keychain', label: '钥匙扣' },
  { v: 'phonecase', label: '手机壳' },
  { v: 'magnet', label: '冰箱贴' },
  { v: 'canvasbag', label: '帆布袋' },
  { v: 'luggage', label: '行李牌' },
  { v: 'rect', label: '其它' },
];
const TECHNIQUES = [
  { v: 'direct_insert', label: '插入式（打印后装填）' },
  { v: 'heat_sublimation', label: '热升华转印' },
  { v: 'direct_uv_print', label: 'UV 直印' },
];

interface FormState {
  sku: string;
  category: string;
  name_zh: string;
  name_en: string;
  name_sr: string;
  desc_zh: string;
  desc_en: string;
  desc_sr: string;
  image_url: string;
  mockup_asset_url: string;
  paW: string;
  paH: string;
  paX: string;
  paY: string;
  psW: string;
  psH: string;
  bleed: string;
  print_technique: string;
  price_rsd: string;
  price_eur: string;
  stock: string;
  bom: string;
  enabled: boolean;
  sort_order: string;
  safe_zone_mm: string;
  copies: string;
}

const emptyForm = (): FormState => ({
  sku: '',
  category: 'frame',
  name_zh: '',
  name_en: '',
  name_sr: '',
  desc_zh: '',
  desc_en: '',
  desc_sr: '',
  image_url: '',
  mockup_asset_url: '',
  paW: '',
  paH: '',
  paX: '0',
  paY: '0',
  psW: '',
  psH: '',
  bleed: '2',
  print_technique: 'direct_insert',
  price_rsd: '',
  price_eur: '',
  stock: '100',
  bom: '[]',
  enabled: true,
  sort_order: '0',
  safe_zone_mm: '0',
  copies: '1',
});

function toForm(p: AdminProduct): FormState {
  return {
    sku: p.masterSku || '',
    category: p.category || 'frame',
    name_zh: p.name_zh || '',
    name_en: p.name_en || '',
    name_sr: p.name_sr || '',
    desc_zh: p.desc_zh || '',
    desc_en: p.desc_en || '',
    desc_sr: p.desc_sr || '',
    image_url: p.image_url || '',
    mockup_asset_url: p.mockup_asset_url || '',
    paW: String(p.print_area?.width ?? ''),
    paH: String(p.print_area?.height ?? ''),
    paX: String(p.print_area?.x ?? 0),
    paY: String(p.print_area?.y ?? 0),
    psW: String(p.physical_size?.width ?? ''),
    psH: String(p.physical_size?.height ?? ''),
    bleed: String(p.bleed ?? 2),
    print_technique: p.print_technique || 'direct_insert',
    price_rsd: String(p.price_rsd ?? ''),
    price_eur: String(p.price_eur ?? ''),
    stock: String(p.stock ?? 0),
    bom: JSON.stringify(p.bom ?? []),
    enabled: p.enabled !== false,
    sort_order: String(p.sort_order ?? 0),
    safe_zone_mm: String(p.safeZoneMm ?? 0),
    copies: String(p.copies ?? 1),
  };
}

export default function ProductsAdmin({ onNavigate }: Props) {
  const [list, setList] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stockSku, setStockSku] = useState<string | null>(null);
  const [stockQty, setStockQty] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getAdminProducts();
    if (res.ok) setList((res.data as AdminProduct[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setShowForm(true);
    setMsg(null);
  };
  const openEdit = (p: AdminProduct) => {
    setEditing(p);
    setForm(toForm(p));
    setShowForm(true);
    setMsg(null);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setMsg(null);
    const res = await adminUploadProductImage(file);
    setUploading(false);
    if (res.ok && res.data) {
      setForm((f) => ({ ...f, image_url: res.data!.url }));
      setMsg({ type: 'ok', text: '✅ 图片已上传' });
    } else {
      setMsg({ type: 'err', text: res.error || '上传失败' });
    }
  };

  const handleSave = async () => {
    if (!form.sku.trim()) {
      setMsg({ type: 'err', text: 'SKU 必填' });
      return;
    }
    setSaving(true);
    setMsg(null);
    const payload: AdminProduct = {
      masterSku: form.sku.trim(),
      category: form.category,
      name_zh: form.name_zh,
      name_en: form.name_en,
      name_sr: form.name_sr,
      desc_zh: form.desc_zh,
      desc_en: form.desc_en,
      desc_sr: form.desc_sr,
      image_url: form.image_url,
      mockup_asset_url: form.mockup_asset_url,
      print_area: {
        x: Number(form.paX) || 0,
        y: Number(form.paY) || 0,
        width: Number(form.paW) || 0,
        height: Number(form.paH) || 0,
        unit: 'mm',
      },
      physical_size: {
        width: Number(form.psW) || 0,
        height: Number(form.psH) || 0,
        unit: 'mm',
      },
      bleed: Number(form.bleed) || 0,
      print_technique: form.print_technique,
      price_rsd: Number(form.price_rsd) || 0,
      price_eur: Number(form.price_eur) || 0,
      stock: Number(form.stock) || 0,
      bom: safeParseBom(form.bom),
      enabled: form.enabled,
      sort_order: Number(form.sort_order) || 0,
      safeZoneMm: Number(form.safe_zone_mm) || 0,
      copies: Number(form.copies) || 1,
    };
    const res = editing
      ? await updateAdminProduct(editing.masterSku, payload)
      : await createAdminProduct(payload);
    setSaving(false);
    if (res.ok) {
      setMsg({ type: 'ok', text: editing ? '✅ 已保存' : '✅ 已新增' });
      setShowForm(false);
      setEditing(null);
      load();
    } else {
      setMsg({ type: 'err', text: res.error || '保存失败' });
    }
  };

  const handleDelete = async (p: AdminProduct) => {
    if (!confirm(`确认删除商品 ${p.masterSku}？此操作不可撤销。`)) return;
    const res = await deleteAdminProduct(p.masterSku);
    if (res.ok) {
      setMsg({ type: 'ok', text: '🗑️ 已删除' });
      load();
    } else {
      setMsg({ type: 'err', text: res.error || '删除失败' });
    }
  };

  const handleStockIn = async (sku: string) => {
    const n = parseInt(stockQty, 10);
    if (!Number.isInteger(n) || n <= 0) {
      setMsg({ type: 'err', text: '请输入正整数' });
      return;
    }
    const res = await adminStockIn(sku, n);
    if (res.ok) {
      setMsg({ type: 'ok', text: `✅ 入库 ${n}` });
      setStockSku(null);
      setStockQty('');
      load();
    } else {
      setMsg({ type: 'err', text: res.error || '入库失败' });
    }
  };

  return (
    <div className="staff-page-inner">
      <header className="inv-header">
        <button className="inv-back" onClick={() => onNavigate('orders')}>← 返回订单</button>
        <h1>商品管理</h1>
        <button className="inv-refresh" onClick={load}>🔄</button>
      </header>

      {msg && <div className={msg.type === 'ok' ? 'inv-msg-ok' : 'inv-msg-err'}>{msg.text}</div>}

      {!showForm && (
        <>
          <div className="prod-toolbar">
            <button className="btn-stockin" onClick={openNew}>➕ 新增商品</button>
            <span className="prod-tip">改价格 / 入库 / 换图 后，游客端实时生效</span>
          </div>

          {loading && !list.length ? (
            <div className="list-empty">加载中...</div>
          ) : (
            <div className="prod-table">
              <div className="prod-row prod-head">
                <span>商品</span>
                <span>SKU</span>
                <span>价格 (RSD/EUR)</span>
                <span>库存</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {list.map((p) => (
                <div key={p.masterSku} className="prod-row">
                  <span className="prod-cell-name">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="prod-thumb" />
                    ) : (
                      <span className="prod-thumb-emoji">📦</span>
                    )}
                    <span>{p.name_zh || p.masterSku}</span>
                  </span>
                  <span className="prod-sku">{p.masterSku}</span>
                  <span>{Number(p.price_rsd || 0)} / {Number(p.price_eur || 0).toFixed(2)}</span>
                  <span className={Number(p.stock) <= 0 ? 'prod-zero' : ''}>{p.stock}</span>
                  <span>{p.enabled === false ? '🔒 隐藏' : '✅ 上架'}</span>
                  <span className="prod-actions">
                    <button onClick={() => openEdit(p)}>编辑</button>
                    <button onClick={() => { setStockSku(p.masterSku); setStockQty(''); }}>入库</button>
                    <button className="prod-del" onClick={() => handleDelete(p)}>删除</button>
                  </span>
                  {stockSku === p.masterSku && (
                    <div className="prod-stockin-row">
                      <input
                        type="number"
                        min="1"
                        placeholder="入库数量"
                        value={stockQty}
                        onChange={(e) => setStockQty(e.target.value)}
                      />
                      <button className="btn-stockin" onClick={() => handleStockIn(p.masterSku)}>确认入库</button>
                      <button onClick={() => setStockSku(null)}>取消</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showForm && (
        <div className="prod-form">
          <h2>{editing ? '编辑商品' : '新增商品'}</h2>
          <div className="prod-grid2">
            <label>SKU（唯一）
              <input value={form.sku} disabled={!!editing} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="如 KEYCHAIN_ACRYLIC_001" />
            </label>
            <label>分类
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
              </select>
            </label>
            <label>名称（中）
              <input value={form.name_zh} onChange={(e) => setForm({ ...form, name_zh: e.target.value })} />
            </label>
            <label>名称（英）
              <input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
            </label>
            <label>名称（塞）
              <input value={form.name_sr} onChange={(e) => setForm({ ...form, name_sr: e.target.value })} />
            </label>
            <label>工艺
              <select value={form.print_technique} onChange={(e) => setForm({ ...form, print_technique: e.target.value })}>
                {TECHNIQUES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
            <label>价格 RSD
              <input type="number" value={form.price_rsd} onChange={(e) => setForm({ ...form, price_rsd: e.target.value })} />
            </label>
            <label>价格 EUR
              <input type="number" step="0.01" value={form.price_eur} onChange={(e) => setForm({ ...form, price_eur: e.target.value })} />
            </label>
            <label>库存
              <input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
            </label>
            <label>出血 (mm)
              <input type="number" value={form.bleed} onChange={(e) => setForm({ ...form, bleed: e.target.value })} />
            </label>
            <label>安全区 (mm)
              <input type="number" value={form.safe_zone_mm} onChange={(e) => setForm({ ...form, safe_zone_mm: e.target.value })} placeholder="关键内容/人脸勿超，相框=5" />
            </label>
            <label>同图份数 (copies)
              <input type="number" value={form.copies} onChange={(e) => setForm({ ...form, copies: e.target.value })} placeholder="同图多拼，钥匙扣=2" />
            </label>
            <label>排序
              <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </label>
            <label>印刷区 宽×高 (mm)
              <div className="prod-inline">
                <input type="number" placeholder="宽" value={form.paW} onChange={(e) => setForm({ ...form, paW: e.target.value })} />
                <input type="number" placeholder="高" value={form.paH} onChange={(e) => setForm({ ...form, paH: e.target.value })} />
              </div>
            </label>
            <label>印刷区 偏移 X×Y (mm)
              <div className="prod-inline">
                <input type="number" placeholder="X" value={form.paX} onChange={(e) => setForm({ ...form, paX: e.target.value })} />
                <input type="number" placeholder="Y" value={form.paY} onChange={(e) => setForm({ ...form, paY: e.target.value })} />
              </div>
            </label>
            <label>物理尺寸 宽×高 (mm)
              <div className="prod-inline">
                <input type="number" placeholder="宽" value={form.psW} onChange={(e) => setForm({ ...form, psW: e.target.value })} />
                <input type="number" placeholder="高" value={form.psH} onChange={(e) => setForm({ ...form, psH: e.target.value })} />
              </div>
            </label>
            <label>商品主图 URL
              <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://... 或上传" />
            </label>
            <label className="prod-upload">
              上传主图
              <input type="file" accept="image/*" onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }} disabled={uploading} />
              {uploading && <span>上传中...</span>}
            </label>
            <label>模板图 URL（透明印刷窗，用于合成预览）
              <input value={form.mockup_asset_url} onChange={(e) => setForm({ ...form, mockup_asset_url: e.target.value })} placeholder="可选，留空用占位外形" />
            </label>
            <label>描述（中）
              <input value={form.desc_zh} onChange={(e) => setForm({ ...form, desc_zh: e.target.value })} />
            </label>
            <label>描述（英）
              <input value={form.desc_en} onChange={(e) => setForm({ ...form, desc_en: e.target.value })} />
            </label>
            <label>描述（塞）
              <input value={form.desc_sr} onChange={(e) => setForm({ ...form, desc_sr: e.target.value })} />
            </label>
            <label className="prod-bom">BOM 物料 JSON
              <textarea value={form.bom} onChange={(e) => setForm({ ...form, bom: e.target.value })} rows={2} placeholder='[{"materialId":"ACRYLIC_3MM","qty":1}]' />
            </label>
            <label className="prod-enabled">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              上架（游客可见）
            </label>
          </div>

          <div className="prod-form-actions">
            <button className="btn-save" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '💾 保存'}
            </button>
            <button className="btn-reject-cancel" onClick={() => { setShowForm(false); setEditing(null); }}>取消</button>
          </div>
        </div>
      )}

      <nav className="inv-tabbar">
        <button onClick={() => onNavigate('orders')}>📋 订单</button>
        <button onClick={() => onNavigate('inventory')}>📦 库存</button>
        <button onClick={() => onNavigate('imposition')}>🖨️ 拼版</button>
        <button className="active" onClick={() => onNavigate('products')}>🛒 商品</button>
      </nav>
    </div>
  );
}

function safeParseBom(s: string): { materialId: string; qty: number }[] {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v;
  } catch {
    /* ignore */
  }
  return [];
}
