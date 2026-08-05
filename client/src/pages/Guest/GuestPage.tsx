/**
 * 游客端 9 步漏斗（V2 完整版）
 * 落地页 → 拍照+授权 → 路线(原图直印) → 产品三层展示 → 模板适配预览 →
 * 关注钩子(WhatsApp) → 购物车 → 结算 → 订单状态轮询
 *
 * 核心：TemplatePreview 把同一张照片按各产品 printArea 精准适配，合成实物效果图。
 * 三语(zh/en/sr) + RSD/EUR 双币；多商品购物车；关注解锁「钥匙扣免费」。
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { I18nProvider, useI18n } from '../../i18n';
import TemplatePreview from './TemplatePreview';
import { loadCatalog, getCatalog } from './catalog';
import type { VisitorProduct, CartItem } from './types';
import { uploadImage, createVisitorOrder, getOrderByCode } from '../../api';
import './Guest.css';

// 关注钩子配置（塞尔维亚本地商家，按需替换）
const WHATSAPP_NUMBER = '381600000000'; // 占位，部署前替换为真实号码
const WHATSAPP_MSG = 'Hi! I just customized a gift at your store.';
const TIKTOK_URL = 'https://www.tiktok.com/@yourshop';
const GOOGLE_URL = 'https://g.page/yourshop';

type Step = 'landing' | 'capture' | 'route' | 'product' | 'preview' | 'follow' | 'cart' | 'checkout' | 'status' | 'query';

function dataUrlToFile(dataUrl: string, name: string): File {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

export default function GuestPage() {
  return (
    <I18nProvider>
      <GuestInner />
    </I18nProvider>
  );
}

function GuestInner() {
  const { t, money, lang, setLang, langs } = useI18n();

  const [step, setStep] = useState<Step>('landing');
  const [catalog, setCatalog] = useState<VisitorProduct[]>(getCatalog());

  // 照片（全局一张，复用到所有产品）
  const [photoSrc, setPhotoSrc] = useState<string>('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string>('');
  const [consent, setConsent] = useState(false);

  const [selected, setSelected] = useState<VisitorProduct | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [followDone, setFollowDone] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [order, setOrder] = useState<{ order_id: string; pickup_code: string; totalRsd: number; totalEur: number } | null>(null);
  const [orderStatus, setOrderStatus] = useState('NEW');
  const [orderReason, setOrderReason] = useState('');

  // 查询
  const [queryCode, setQueryCode] = useState('');
  const [queryResult, setQueryResult] = useState<{ status: string; reason?: string; pickup_code?: string } | null>(null);
  const [queryError, setQueryError] = useState('');

  // 相机
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cameraOn, setCameraOn] = useState(false);

  useEffect(() => {
    loadCatalog().then(setCatalog).catch(() => setCatalog(getCatalog()));
  }, []);

  // 订单状态轮询
  useEffect(() => {
    if (step !== 'status' || !order) return;
    let alive = true;
    const tick = async () => {
      const res = await getOrderByCode(order.pickup_code);
      if (!alive || !res.ok || !res.data) return;
      const o = res.data as { status: string; feedback_reason?: string };
      setOrderStatus(o.status);
      setOrderReason(o.feedback_reason || '');
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [step, order]);

  // ---- 合计（含关注优惠：钥匙扣免费）----
  const totals = useMemo(() => {
    let rsd = 0;
    let eur = 0;
    for (const it of cart) {
      rsd += it.product.priceRsd;
      eur += it.product.priceEur;
    }
    let discRsd = 0;
    let discEur = 0;
    if (followDone) {
      const kc = cart.filter((c) => c.product.category === 'keychain').sort((a, b) => a.product.priceRsd - b.product.priceRsd)[0];
      if (kc) {
        discRsd = kc.product.priceRsd;
        discEur = kc.product.priceEur;
      }
    }
    return { rsd, eur, discRsd, discEur, finalRsd: rsd - discRsd, finalEur: eur - discEur };
  }, [cart, followDone]);

  // ---- 相机 ----
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setError('无法访问相机，请改用相册选择');
    }
  };
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  };
  const captureFrame = () => {
    const v = videoRef.current;
    if (!v) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 480;
    c.height = v.videoHeight || 640;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setPhotoSrc(url);
      setPhotoFile(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
    stopCamera();
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    const reader = new FileReader();
    reader.onload = () => setPhotoSrc(reader.result as string);
    reader.readAsDataURL(f);
  };

  const handleCaptureNext = async () => {
    if (!consent) {
      setError(t('capture.agree'));
      return;
    }
    if (!photoFile) {
      setError(t('common.error'));
      return;
    }
    setError('');
    setSubmitting(true);
    // 上传照片（一次，复用到所有产品）
    const up = await uploadImage(photoFile);
    setSubmitting(false);
    if (!up.ok) {
      setError(up.error || '上传失败');
      return;
    }
    setUploadedUrl((up.data as { url: string }).url);
    setStep('route');
  };

  const addToCart = () => {
    if (!selected || !uploadedUrl) return;
    const item: CartItem = {
      uid: `${selected.masterSku}-${Date.now()}`,
      product: selected,
      photoSrc,
      imageUrl: uploadedUrl,
    };
    setCart((c) => [...c, item]);
    setSelected(null);
    setStep('product');
  };

  const removeFromCart = (uid: string) => setCart((c) => c.filter((i) => i.uid !== uid));

  const submitOrder = async (name: string, phone: string) => {
    if (cart.length === 0 || !uploadedUrl) return;
    setSubmitting(true);
    setError('');
    const res = await createVisitorOrder({
      items: cart.map((i) => ({ masterSku: i.product.masterSku, imageUrl: i.imageUrl })),
      customerName: name,
      customerPhone: phone,
      language: lang,
      totalRsd: totals.finalRsd,
      totalEur: totals.finalEur,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error || '下单失败');
      return;
    }
    const o = res.data as { order_id: string; pickup_code: string; totalRsd?: number; totalEur?: number };
    setOrder({
      order_id: o.order_id,
      pickup_code: o.pickup_code,
      totalRsd: o.totalRsd ?? totals.finalRsd,
      totalEur: o.totalEur ?? totals.finalEur,
    });
    setOrderStatus('NEW');
    setStep('status');
  };

  const handleQuery = async () => {
    if (!queryCode.trim()) return;
    setQueryError('');
    setQueryResult(null);
    const res = await getOrderByCode(queryCode.trim());
    if (res.ok && res.data) {
      const o = res.data as { status: string; feedback_reason?: string; pickup_code?: string };
      setQueryResult({ status: o.status, reason: o.feedback_reason, pickup_code: o.pickup_code });
    } else {
      setQueryError(t('status.notFound'));
    }
  };

  // 语言切换
  const LangSwitch = (
    <div className="lang-switch">
      {langs.map((l) => (
        <button key={l.code} className={l.code === lang ? 'on' : ''} onClick={() => setLang(l.code)}>
          {l.label}
        </button>
      ))}
    </div>
  );

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      NEW: 'status.pending',
      WAITING_CHECK: 'status.pending',
      READY_PRINT: 'status.ready',
      PRINTED: 'status.printed',
      PROCESSING: 'status.processing',
      COMPLETED: 'status.completed',
      REJECTED: 'status.rejected',
    };
    return t(map[s] || 'status.pending');
  };

  return (
    <div className="guest-page">
      <header className="guest-header">
        <h1>{t('app.title')}</h1>
        {LangSwitch}
      </header>

      {error && <div className="guest-error">{error}</div>}

      {/* 1. 落地页 */}
      {step === 'landing' && (
        <div className="guest-section landing">
          <div className="landing-hero">{t('landing.hero')}</div>
          <div className="landing-sub">{t('landing.sub')}</div>
          <button className="btn-primary big" onClick={() => setStep('capture')}>
            {t('landing.cta')}
          </button>
          <div className="landing-note">{t('landing.note')}</div>
          <button className="btn-query" onClick={() => { setQueryResult(null); setQueryError(''); setStep('query'); }}>
            🔍 {t('status.queryTitle')}
          </button>
        </div>
      )}

      {/* 2. 拍照 + 授权 */}
      {step === 'capture' && (
        <div className="guest-section">
          <h2 className="section-title">{t('capture.title')}</h2>
          {cameraOn ? (
            <div className="capture-video-wrap">
              <video ref={videoRef} className="capture-video" playsInline muted />
              <button className="btn-primary" onClick={captureFrame}>📸 {t('capture.take')}</button>
              <button className="btn-back" onClick={stopCamera}>{t('common.close')}</button>
            </div>
          ) : (
            <div className="capture-actions">
              <button className="btn-secondary" onClick={startCamera}>📷 {t('capture.take')}</button>
              <button className="btn-secondary" onClick={() => fileRef.current?.click()}>🖼️ {t('capture.choose')}</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
            </div>
          )}
          {photoSrc && <img src={photoSrc} alt="photo" className="capture-preview" />}
          <p className="capture-hint">{t('capture.hint')}</p>
          <div className="consent-box">
            <div className="consent-title">{t('capture.consentTitle')}</div>
            <p className="consent-text">{t('capture.consentText')}</p>
            <label className="consent-check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              {t('capture.agree')}
            </label>
          </div>
          <div className="preview-actions">
            <button className="btn-back" onClick={() => setStep('landing')}>{t('common.back')}</button>
            <button className="btn-primary" onClick={handleCaptureNext} disabled={submitting || !photoFile}>
              {submitting ? t('common.loading') : t('common.next')}
            </button>
          </div>
        </div>
      )}

      {/* 3. 路线（原图直印） */}
      {step === 'route' && (
        <div className="guest-section">
          <h2 className="section-title">{t('route.title')}</h2>
          <button className="route-card" onClick={() => setStep('product')}>
            <span className="route-icon">🖼️</span>
            <span className="route-name">{t('route.original')}</span>
            <span className="route-desc">{t('route.originalDesc')}</span>
          </button>
          <button className="btn-back" onClick={() => setStep('capture')}>{t('common.back')}</button>
        </div>
      )}

      {/* 4+5. 产品三层展示 + 模板适配预览 */}
      {step === 'product' && (
        <div className="guest-section">
          <h2 className="section-title">
            {t('product.title')}
            {cart.length > 0 && <span className="cart-badge" onClick={() => setStep('cart')}>🛒 {cart.length}</span>}
          </h2>
          <div className="product-grid">
            {catalog.map((p) => {
              const soldOut = typeof p.stock === 'number' && p.stock <= 0;
              return (
                <button
                  key={p.masterSku}
                  className={`product-card ${soldOut ? 'sold-out' : ''}`}
                  disabled={soldOut}
                  onClick={() => { if (!soldOut) { setSelected(p); setStep('preview'); } }}
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.names[lang]} className="product-img" />
                  ) : (
                    <span className="product-icon">{p.icon}</span>
                  )}
                  <span className="product-name">{p.names[lang]}</span>
                  <span className="product-price">{money(p.priceRsd, p.priceEur)}</span>
                  {soldOut && <span className="product-soldout">售罄 / Rasprodato</span>}
                </button>
              );
            })}
          </div>
          <div className="preview-actions">
            <button className="btn-back" onClick={() => setStep('route')}>{t('common.back')}</button>
            {cart.length > 0 && (
              <button className="btn-primary" onClick={() => setStep('cart')}>
                🛒 {t('cart.title')} ({cart.length})
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'preview' && selected && (
        <div className="guest-section">
          <h2 className="section-title">{selected.icon} {selected.names[lang]}</h2>
          <div className="preview-compare">
            <div className="pv-col">
              <div className="pv-label">{t('preview.hint').split('·')[0]}</div>
              <img src={photoSrc} alt="photo" className="pv-photo" />
            </div>
            <div className="pv-col">
              <div className="pv-label">{t('preview.hint').split('·')[1] ?? ''}</div>
              <TemplatePreview photoSrc={photoSrc} product={selected} width={260} height={330} />
            </div>
          </div>
          <div className="preview-specs">
            <span>📐 {t('product.printArea')}: {selected.printArea.width}×{selected.printArea.height} mm</span>
            <span>🩸 {t('product.bleed')}: {selected.bleed} mm</span>
            <span>⚙️ {t('product.technique')}: {t('product.tech.' + selected.printTechnique)}</span>
            <span>💰 {money(selected.priceRsd, selected.priceEur)}</span>
          </div>
          <p className="preview-bleed-note">{t('preview.bleedNote')}</p>
          <div className="preview-actions">
            <button className="btn-secondary" onClick={() => { setSelected(null); setStep('product'); }}>{t('common.back')}</button>
            {typeof selected.stock === 'number' && selected.stock <= 0 ? (
              <button className="btn-primary" disabled>{t('product.soldOut')}</button>
            ) : (
              <button className="btn-primary" onClick={addToCart}>{t('preview.confirm')}</button>
            )}
          </div>
        </div>
      )}

      {/* 6. 关注钩子 */}
      {step === 'follow' && (
        <div className="guest-section">
          <h2 className="section-title">{t('follow.title')}</h2>
          <p className="follow-sub">{t('follow.sub')}</p>
          <a className="follow-card wa" href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MSG)}`} target="_blank" rel="noreferrer">
            <span>💬</span>
            <span>
              <b>{t('follow.whatsapp')}</b>
              <i>{t('follow.whatsappDesc')}</i>
            </span>
          </a>
          <a className="follow-card" href={TIKTOK_URL} target="_blank" rel="noreferrer">
            <span>🎵</span><b>{t('follow.tiktok')}</b>
          </a>
          <a className="follow-card" href={GOOGLE_URL} target="_blank" rel="noreferrer">
            <span>⭐</span><b>{t('follow.google')}</b>
          </a>
          <button className="btn-primary" onClick={() => { setFollowDone(true); setStep('cart'); }}>
            ✓ {t('follow.claim')}
          </button>
          <button className="btn-back" onClick={() => setStep('cart')}>{t('follow.skip')}</button>
        </div>
      )}

      {/* 7. 购物车 */}
      {step === 'cart' && (
        <div className="guest-section">
          <h2 className="section-title">{t('cart.title')}</h2>
          {cart.length === 0 ? (
            <div className="list-empty">{t('cart.empty')}</div>
          ) : (
            <div className="cart-list">
              {cart.map((it) => (
                <div key={it.uid} className="cart-item">
                  <img src={it.photoSrc} alt="" className="cart-thumb" />
                  <div className="cart-info">
                    <div className="cart-name">{it.product.icon} {it.product.names[lang]}</div>
                    <div className="cart-price">{money(it.product.priceRsd, it.product.priceEur)}</div>
                  </div>
                  <button className="cart-remove" onClick={() => removeFromCart(it.uid)}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="cart-summary">
            <div>{t('cart.total')}: <b>{money(totals.finalRsd, totals.finalEur)}</b></div>
            {totals.discRsd > 0 && <div className="cart-discount">🎉 {t('follow.done')} (-{money(totals.discRsd, totals.discEur)})</div>}
          </div>
          <div className="preview-actions">
            <button className="btn-secondary" onClick={() => setStep('product')}>{t('cart.continue')}</button>
            <button className="btn-secondary" onClick={() => setStep('follow')}>{t('follow.title')}</button>
            <button className="btn-primary" onClick={() => setStep('checkout')} disabled={cart.length === 0}>
              {t('cart.checkout')}
            </button>
          </div>
        </div>
      )}

      {/* 8. 结算 */}
      {step === 'checkout' && (
        <CheckoutStep
          t={t}
          money={money}
          lang={lang}
          totalRsd={totals.finalRsd}
          totalEur={totals.finalEur}
          submitting={submitting}
          onBack={() => setStep('cart')}
          onSubmit={submitOrder}
        />
      )}

      {/* 9. 订单状态 */}
      {step === 'status' && order && (
        <div className="guest-section">
          <div className="success-icon">✅</div>
          <h2 className="section-title">{t('status.title')}</h2>
          <div className="pickup-code-box">
            <span className="pickup-label">{t('status.code')}</span>
            <span className="pickup-code">{order.pickup_code}</span>
          </div>
          <div className="status-pill">{statusLabel(orderStatus)}</div>
          {orderStatus === 'REJECTED' ? (
            <p className="query-reject">{t('status.rejectHint', { reason: orderReason || '—' })}</p>
          ) : (
            <p className="success-hint">{t('status.show')}</p>
          )}
          <p className="status-poll">{t('status.poll')}</p>
          <button className="btn-primary" onClick={() => { setCart([]); setFollowDone(false); setPhotoSrc(''); setPhotoFile(null); setUploadedUrl(''); setSelected(null); setStep('landing'); }}>
            {t('status.again')}
          </button>
        </div>
      )}

      {/* 查询订单状态 */}
      {step === 'query' && (
        <div className="guest-section">
          <h2 className="section-title">{t('status.queryTitle')}</h2>
          <div className="query-bar">
            <input type="text" placeholder={t('status.queryPlaceholder')} value={queryCode} onChange={(e) => setQueryCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleQuery()} />
            <button onClick={handleQuery}>{t('status.query')}</button>
          </div>
          {queryError && <div className="guest-error">{queryError}</div>}
          {queryResult && (
            <div className="query-result">
              <div className="query-status">状态：{statusLabel(queryResult.status)}</div>
              {queryResult.status === 'REJECTED' && <p className="query-reject">{t('status.rejectHint', { reason: queryResult.reason || '—' })}</p>}
              {queryResult.status !== 'REJECTED' && <p className="query-hint">{t('status.show')}</p>}
            </div>
          )}
          <button className="btn-back" onClick={() => setStep('landing')}>{t('common.back')}</button>
        </div>
      )}
    </div>
  );
}

function CheckoutStep({
  t,
  money,
  totalRsd,
  totalEur,
  submitting,
  onBack,
  onSubmit,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  money: (r: number, e: number) => string;
  lang: string;
  totalRsd: number;
  totalEur: number;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (name: string, phone: string) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <div className="guest-section">
      <h2 className="section-title">{t('checkout.title')}</h2>
      <label className="field">
        <span>{t('checkout.name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('checkout.name')} />
      </label>
      <label className="field">
        <span>{t('checkout.phone')}</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('checkout.phone')} />
      </label>
      <div className="cart-summary">
        <div>{t('cart.total')}: <b>{money(totalRsd, totalEur)}</b></div>
      </div>
      <div className="preview-actions">
        <button className="btn-back" onClick={onBack}>{t('checkout.back')}</button>
        <button className="btn-primary" onClick={() => onSubmit(name, phone)} disabled={submitting || !name.trim()}>
          {submitting ? t('common.loading') : t('checkout.submit')}
        </button>
      </div>
    </div>
  );
}
