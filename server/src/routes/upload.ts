/**
 * 文件上传路由
 * 处理游客上传图片，保存到 uploads/ 目录
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

const router = Router();

// 上传目录
const UPLOAD_PATH = process.env.UPLOAD_PATH || '../../uploads';
const uploadDir = path.resolve(__dirname, '..', UPLOAD_PATH);

// 确保目录存在
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置 multer
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    // 保留原始扩展名，用 UUID 防重名
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${uuidv4()}${ext}`;
    cb(null, name);
  },
});

// 只允许图片格式
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('仅支持 JPG、PNG、WebP、GIF 格式'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
});

/** POST /api/upload — 上传单张图片 */
router.post('/upload', (req: Request, res: Response) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'FILE_TOO_LARGE', message: '文件大小不能超过 20MB' });
        }
        return res.status(400).json({ error: 'UPLOAD_ERROR', message: err.message });
      }
      return res.status(400).json({ error: 'UPLOAD_ERROR', message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'NO_FILE', message: '请选择图片' });
    }

    const file = req.file;
    res.json({
      ok: true,
      data: {
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        url: `/uploads/${file.filename}`,
      },
    });
  });
});

export default router;
