/**
 * 打印图上传路由
 * 接收店员端导出的高清打印图，保存到 uploads/ 并写入订单 print_url
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { db } from '../db';

const router = Router();

const UPLOAD_PATH = process.env.UPLOAD_PATH || '../../uploads';
const uploadDir = path.resolve(__dirname, '..', UPLOAD_PATH);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `print-${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

/** POST /api/orders/:orderId/print — 上传高清打印图 */
router.post('/orders/:orderId/print', (req: Request, res: Response) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'UPLOAD_ERROR', message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'NO_FILE', message: '请提供打印图' });
    }

    const orderId = req.params.orderId;
    const result = db.prepare(
      "UPDATE orders SET print_url = ?, updated_at = datetime('now', 'localtime') WHERE order_id = ?"
    ).run(`/uploads/${req.file.filename}`, orderId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '订单不存在' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
    res.status(201).json({ ok: true, data: order });
  });
});

export default router;
