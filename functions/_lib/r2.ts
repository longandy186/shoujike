/**
 * 图片存储辅助 —— 用 D1 内联存储 Base64（替代 R2，免去 R2 订阅）。
 * putImage 返回图片在 images 表中的数字 id；访问路径为 /api/files/<id>。
 */
import type { D1Database } from '@cloudflare/workers-types';

export async function putImage(db: D1Database, data: ArrayBuffer, contentType: string): Promise<number> {
  const base64 = bytesToBase64(new Uint8Array(data));
  const res = await db
    .prepare('INSERT INTO images (data, content_type) VALUES (?, ?)')
    .bind(base64, contentType || 'application/octet-stream')
    .run();
  return (res.meta as { last_row_id: number }).last_row_id;
}

export async function getObject(
  db: D1Database,
  idStr: string
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db
    .prepare('SELECT data, content_type FROM images WHERE id = ?')
    .bind(id)
    .first<{ data: string; content_type: string }>();
  if (!row) return null;
  return { body: base64ToBytes(row.data).buffer, contentType: row.content_type };
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
