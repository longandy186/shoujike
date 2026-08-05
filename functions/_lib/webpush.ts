/**
 * Web Push 协议实现（RFC 8291 aes128gcm + RFC 8292 VAPID）
 * 纯 WebCrypto（Worker / Node 22 全局 crypto.subtle 均可用），无 Node 依赖。
 * 用于来单时向店员浏览器推送通知（最稳定的通知层）。
 */

const b64urlEncode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function hmacSha256(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg);
  return new Uint8Array(sig);
}

/** HKDF（RFC 5869），提取长度 len */
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  const infoAnd0 = new Uint8Array(info.length + 1);
  infoAnd0.set(info, 0);
  infoAnd0[info.length] = 0;
  const okm = await hmacSha256(prk, infoAnd0);
  return okm.slice(0, len);
}

/** 生成 VAPID 应用服务器密钥对（P-256），返回 base64url 编码的公钥(raw) / 私钥(pkcs8) */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { publicKey: b64urlEncode(pub), privateKey: b64urlEncode(priv) };
}

/** 用 VAPID 私钥对 JWT 签名（ES256） */
async function signVapidJwt(privateKeyRaw: Uint8Array, audience: string, subject: string): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', privateKeyRaw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: subject };
  const enc = (o: unknown) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  // WebCrypto ECDSA 签名即原始 r||s（64 字节），正是 JWT ES256 期望格式
  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * 加密并发送一条 Web Push 消息。
 * @param endpoint 订阅 endpoint
 * @param p256dh    订阅公钥（base64url，65 字节未压缩）
 * @param auth      订阅 auth secret（base64url，16 字节）
 * @param payload   明文消息
 */
export async function sendWebPush(
  env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string },
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: string
): Promise<Response> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new Error('VAPID keys not configured');
  }

  const vapidPrivate = b64urlDecode(env.VAPID_PRIVATE_KEY);
  const receiverPub = b64urlDecode(p256dh); // 65 bytes
  const authSecret = b64urlDecode(auth); // 16 bytes
  const plaintext = new TextEncoder().encode(payload);

  // 1) 生成临时 ECDH 密钥对
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey)); // 65 bytes

  // 2) ECDH 共享密钥
  const receiverKey = await crypto.subtle.importKey('raw', receiverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', namedCurve: 'P-256', public: receiverKey }, eph.privateKey, 256);
  const sharedSecret = new Uint8Array(sharedBits);

  // 3) PRK = HMAC-SHA256(authSecret, sharedSecret)
  const prk = await hmacSha256(authSecret, sharedSecret);

  // 4) 上下文（aes128gcm）
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ctx = new Uint8Array(1 + 2 + 16 + 2 + 65 + 2 + 65);
  let p = 0;
  ctx[p++] = 0x00; // tag
  ctx[p++] = 0x00; ctx[p++] = 0x10; // salt 长度 16
  ctx.set(salt, p); p += 16;
  ctx[p++] = 0x00; ctx[p++] = 0x41; // 接收方公钥长度 65
  ctx.set(receiverPub, p); p += 65;
  ctx[p++] = 0x00; ctx[p++] = 0x41; // 发送方公钥长度 65
  ctx.set(ephPub, p); p += 65;

  const cekInfo = new Uint8Array(21 + ctx.length);
  const cekLabel = new TextEncoder().encode('Content-Encoding: aes128gcm');
  cekInfo.set(cekLabel, 0); cekInfo[cekLabel.length] = 0x00; cekInfo.set(ctx, cekLabel.length + 1);
  const nonceInfo = new Uint8Array(20 + ctx.length);
  const nonceLabel = new TextEncoder().encode('Content-Encoding: nonce');
  nonceInfo.set(nonceLabel, 0); nonceInfo[nonceLabel.length] = 0x00; nonceInfo.set(ctx, nonceLabel.length + 1);

  const prkCek = await hmacSha256(prk, cekInfo);
  const cek = prkCek.slice(0, 16);
  const nonceFull = await hmacSha256(prkCek, nonceInfo);
  const nonce = nonceFull.slice(0, 12);

  // 5) 加密：明文 + 0x02 分隔符（无额外填充）
  const padded = new Uint8Array(plaintext.length + 1);
  padded.set(plaintext, 0);
  padded[plaintext.length] = 0x02;
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const aad = new Uint8Array(21);
  aad.set(salt, 0);
  aad[16] = 0x00; aad[17] = 0x00; aad[18] = 0x10; aad[19] = 0x00; aad[20] = 0x00; // rs=4096, record=0
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, aesKey, padded);
  const cipher = new Uint8Array(cipherBuf);

  // 6) 组装 body：salt(16) + rs(4) + idlen(1) + ephPub(65) + cipher
  const rs = 4096;
  const body = new Uint8Array(16 + 4 + 1 + 65 + cipher.length);
  let q = 0;
  body.set(salt, q); q += 16;
  body[q++] = (rs >>> 24) & 0xff; body[q++] = (rs >>> 16) & 0xff; body[q++] = (rs >>> 8) & 0xff; body[q++] = rs & 0xff;
  body[q++] = 65;
  body.set(ephPub, q); q += 65;
  body.set(cipher, q);

  // 7) VAPID 授权
  const audience = new URL(endpoint).origin;
  const jwt = await signVapidJwt(vapidPrivate, audience, 'mailto:staff@ai-cc-prod.app');

  return fetch(endpoint, {
    method: 'POST',
    headers: {
      TTL: '60',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      Authorization: `WebPush ${jwt}`,
      'Crypto-Key': `p256ecdsa=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
    signal: AbortSignal.timeout(2500),
  });
}
