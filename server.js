// Web đóng hàng: tự lấy báo giá từ Odoo (XML-RPC), hiển thị cho kho đóng hàng.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tự nạp .env nếu có (dù chạy node server.js hay npm start)
if (typeof process.loadEnvFile === 'function' && fs.existsSync('.env')) {
  try { process.loadEnvFile('.env'); } catch {}
}

import express from 'express';
import apiRouter from './routes/api.js';
import authRouter from './routes/auth.js';
import { syncOdoo, isOdooConfigured, getOdooPollSec } from './odoo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PASSWORD = process.env.APP_PASSWORD || '';

const app = express();
app.use(express.json({ limit: '1mb' }));

// Basic Auth nếu có cài đặt APP_PASSWORD trong .env
app.use((req, res, next) => {
  if (!APP_PASSWORD) return next();
  const h = req.get('authorization') || '';
  const pass = Buffer.from(h.split(' ')[1] || '', 'base64').toString().split(':').slice(1).join(':');
  if (pass === APP_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Dong hang"').status(401).send('Cần mật khẩu');
});

// Auth API routes
app.use('/api/auth', authRouter);
app.use('/auth', authRouter);

// Main API routes
app.use('/api', apiRouter);

// Clean URLs & Phục vụ giao diện HTML (hỗ trợ cả /login và /login.html)
app.get(['/login', '/login.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Static files (tự động nhận diện file tĩnh: css, js, png, svg...)
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html']
}));

// Fallback: Mọi đường dẫn web không khớp sẽ trả về trang chính, tránh lỗi Cannot GET
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return res.status(404).json({ ok: false, error: 'Endpoint không tồn tại' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const odooOn = isOdooConfigured();
const pollSec = getOdooPollSec();

if (odooOn) {
  syncOdoo();
  setInterval(syncOdoo, pollSec * 1000);
  console.log('Đang lấy báo giá từ Odoo mỗi', pollSec, 'giây');
} else {
  console.log('Chưa cấu hình Odoo (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY)');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Web đóng hàng đang chạy tại port', PORT));
