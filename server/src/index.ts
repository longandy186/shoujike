import express from 'express';
import cors from 'cors';
import path from 'path';
import { initDatabase } from './db';
import uploadRoutes from './routes/upload';
import orderRoutes from './routes/orders';
import printRoutes from './routes/print';
import skuRoutes from './routes/sku';
import inventoryRoutes from './routes/inventory';

// ============================================================
// 环境变量加载（tsx 不原生支持 .env，使用手动读取）
// ============================================================
import fs from 'fs';

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// 加载 .env（开发环境）
if (process.env.NODE_ENV !== 'production') {
  loadEnv(path.join(__dirname, '../.env'));
}

// ============================================================
// Express 应用初始化
// ============================================================
const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const UPLOAD_PATH = process.env.UPLOAD_PATH || '../uploads';

// -------------------- 中间件 --------------------
app.use(cors({
  origin: CLIENT_URL,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 请求日志（开发环境）
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
  });
}

// 静态文件服务 — 上传的图片
app.use('/uploads', express.static(path.resolve(__dirname, '..', UPLOAD_PATH)));

// 生产模式：托管前端构建产物（client/dist），实现前后端同源部署
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  // SPA 回退：非 /api 请求都返回 index.html
  app.get(/^\/(?!api|uploads).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// -------------------- 路由 --------------------
// 健康检查（供前端连接测试）
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development',
  });
});

// API 通信测试（验证前后端连通性）
app.get('/api/ping', (_req, res) => {
  res.json({ message: 'pong', timestamp: Date.now() });
});

// 业务路由
app.use('/api', uploadRoutes);
app.use('/api', orderRoutes);
app.use('/api', printRoutes);
app.use('/api', skuRoutes);
app.use('/api', inventoryRoutes);

// -------------------- 404 处理 --------------------
app.use((_req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: '请求的资源不存在',
  });
});

// -------------------- 全局错误处理 --------------------
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Error]', err.message);
  console.error(err.stack);

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'production'
      ? '服务器内部错误'
      : err.message,
  });
});

// -------------------- 启动 --------------------

// 初始化数据库
initDatabase();

app.listen(PORT, () => {
  console.log('========================================');
  console.log(`  AI文创快速生产系统 — 后端服务`);
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`  环境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  前端: ${CLIENT_URL}`);
  console.log('========================================');
});

export default app;
