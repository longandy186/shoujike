/**
 * 游客 H5 页面
 * 功能：产品选择 → 图片上传 → 预览 → 创建订单
 * 移动端优先适配
 */

import { useState, useRef } from 'react';
import { uploadImage, createOrder } from '../../api';
import { getEnabledProducts, type Product } from './products';
import './Guest.css';

export default function GuestPage() {
  const [step, setStep] = useState<'select' | 'upload' | 'preview' | 'success'>('select');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const [createdOrderId, setCreatedOrderId] = useState<string>('');
  const [pickupCode, setPickupCode] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const products = getEnabledProducts();

  // 选择产品 → 进入上传步骤
  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setError('');
    setStep('upload');
  };

  // 文件选择 → 预览
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 校验类型
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }

    // 校验大小 (20MB)
    if (file.size > 20 * 1024 * 1024) {
      setError('图片不能超过 20MB');
      return;
    }

    setError('');
    setUploadedFile(file);

    // 生成预览
    const reader = new FileReader();
    reader.onload = () => {
      setPreviewUrl(reader.result as string);
      setStep('preview');
    };
    reader.readAsDataURL(file);
  };

  // 提交订单
  const handleSubmit = async () => {
    if (!uploadedFile || !selectedProduct) return;

    setSubmitting(true);
    setError('');

    // 1. 上传图片
    const uploadRes = await uploadImage(uploadedFile);
    if (!uploadRes.ok) {
      setError(uploadRes.error || '上传失败');
      setSubmitting(false);
      return;
    }

    // 2. 创建订单
    const orderRes = await createOrder({
      imageUrl: uploadRes.data.url,
      masterSku: selectedProduct.id,
    });

    if (!orderRes.ok) {
      setError(orderRes.error || '订单创建失败');
      setSubmitting(false);
      return;
    }

    setCreatedOrderId((orderRes.data as { order_id: string }).order_id);
    setPickupCode((orderRes.data as { pickup_code: string }).pickup_code || '');
    setStep('success');
    setSubmitting(false);
  };

  // 重新选择照片
  const handleRetake = () => {
    setPreviewUrl('');
    setUploadedFile(null);
    setError('');
    setStep('upload');
  };

  // 再来一单
  const handleNewOrder = () => {
    setSelectedProduct(null);
    setPreviewUrl('');
    setUploadedFile(null);
    setError('');
    setCreatedOrderId('');
    setStep('select');
  };

  return (
    <div className="guest-page">
      {/* 顶部标题 */}
      <header className="guest-header">
        <h1>AI文创体验</h1>
        <p className="guest-subtitle">选择产品，上传照片，立即制作</p>
      </header>

      {/* 错误提示 */}
      {error && <div className="guest-error">{error}</div>}

      {/* 步骤1：产品选择 */}
      {step === 'select' && (
        <div className="guest-section">
          <h2 className="section-title">选择产品</h2>
          <div className="product-grid">
            {products.map((product) => (
              <button
                key={product.id}
                className="product-card"
                onClick={() => handleSelectProduct(product)}
              >
                <span className="product-icon">{product.icon}</span>
                <span className="product-name">{product.name}</span>
                <span className="product-desc">{product.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 步骤2：上传照片 */}
      {step === 'upload' && (
        <div className="guest-section">
          <h2 className="section-title">
            {selectedProduct?.icon} {selectedProduct?.name}
          </h2>
          <div
            className="upload-zone"
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="upload-icon">📷</span>
            <span className="upload-text">点击拍照或选择照片</span>
            <span className="upload-hint">支持 JPG、PNG，最大 20MB</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileChange}
            hidden
          />
          <button className="btn-back" onClick={() => setStep('select')}>
            返回选择产品
          </button>
        </div>
      )}

      {/* 步骤3：预览确认 */}
      {step === 'preview' && (
        <div className="guest-section">
          <h2 className="section-title">确认照片</h2>
          <div className="preview-container">
            <img src={previewUrl} alt="预览" className="preview-image" />
          </div>
          <div className="preview-info">
            <span>产品：{selectedProduct?.icon} {selectedProduct?.name}</span>
          </div>
          <div className="preview-actions">
            <button className="btn-secondary" onClick={handleRetake}>
              重拍
            </button>
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? '提交中...' : '确认下单'}
            </button>
          </div>
        </div>
      )}

      {/* 步骤4：提交成功 */}
      {step === 'success' && (
        <div className="guest-section">
          <div className="success-icon">✅</div>
          <h2 className="section-title">下单成功！</h2>
          <div className="pickup-code-box">
            <span className="pickup-label">取件码</span>
            <span className="pickup-code">{pickupCode}</span>
          </div>
          <p className="success-hint">请将此码出示给店员</p>
          <button className="btn-primary" onClick={handleNewOrder}>
            再来一单
          </button>
        </div>
      )}
    </div>
  );
}
