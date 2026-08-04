-- 0002: 图片内联存储（替代 R2，免去 R2 订阅）
-- 游客照片 / 打印图以 Base64 文本存入 D1，前端经 /api/files/<id> 同源读取。
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
