/**
 * 图片存储辅助 —— Cloudflare R2 对象存储。
 * putImage 返回图片在 R2 中的 key；访问路径为 /api/files/<key>。
 */
import type { R2Bucket } from '@cloudflare/workers-types';

export async function putImage(bucket: R2Bucket, data: ArrayBuffer, contentType: string): Promise<string> {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await bucket.put(key, data, {
    httpMetadata: { contentType: contentType || 'application/octet-stream' },
  });
  return key;
}

export async function getObject(
  bucket: R2Bucket,
  key: string
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  // 仅允许本服务生成的扁平 key，拒绝路径穿越
  if (!key || key.includes('/') || key.includes('..') || key.includes('\\')) return null;
  const obj = await bucket.get(key);
  if (!obj) return null;
  return {
    body: await obj.arrayBuffer(),
    contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
  };
}
