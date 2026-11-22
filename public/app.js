// Tự động làm sạch URL trên trình duyệt nếu còn đuôi .html
if (window.location.pathname === '/index.html') {
  window.history.replaceState(null, '', '/' + window.location.search);
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $ = s => document.querySelector(s);
const IC_FLAG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M5 3v18h2v-7h11l-2-4 2-4H7V3z"/></svg>';
const IC_CHK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5 10-10"/></svg>';
const SRC = {odoo: 'Odoo', shopee: 'Shopee', tiktok: 'TikTok', manual: 'Thủ công'};
let S = {orders: [], status: null, tab: 'open', filter: 'all', date: 'all', q: '', open: null, selected: new Set(), batchOpen: false, user: null, mixOpen: false};
let DEMO = false, LIVE = false, demoData = null;
let scrollY = 0;
let knownOrderIds = new Set(); // dùng để phát hiện đơn mới
let notifiedOnce = false;      // chỉ thông báo sau lần load đầu

let lastNotificationCheck = Date.now();
let knownNotificationIds = new Set();
let notificationsLoadedOnce = false;

/* ---- 8 loại sản phẩm trái cây cuộn sá ---- */
const FRUIT_8_KEYS = [
  { id: 'dieu', name: 'Chuối cuộn hạt điều sá', short: 'điều', match: /hạt điều|chd/i },
  { id: 'dau', name: 'Chuối cuộn đậu phộng sá', short: 'đậu', match: /đậu phộng|cdp/i },
  { id: 'sr', name: 'Chuối cuộn sầu riêng sá', short: 'SR', match: /sầu riêng|csr/i },
  { id: 'me_me', name: 'Chuối cuộn hạt mè sá', short: 'mè', match: /hạt mè|chm/i },
  { id: 'khom', name: 'Khóm cuộn sá', short: 'khóm', match: /khóm cuộn|khc/i },
  { id: 'me', name: 'Me cuộn sá', short: 'me', match: /me cuộn(?!.*hạt điều)|mep/i },
  { id: 'mc', name: 'Mãng cầu cuộn sá', short: 'MC', match: /mãng cầu cuộn|mcc/i },
  { id: 'xoai', name: 'Xoài cuộn sá', short: 'xoài', match: /xoài cuộn(?!.*(muối ớt|chanh dây|cam))|xoo/i }
];

/* ---- Tách khối lượng (gram) từ tên hoặc SKU ---- */
function extractItemWeightGrams(sku, name) {
  const text = (String(name || '') + ' ' + String(sku || '')).toUpperCase();
  const mKg = text.match(/(\d+(?:[.,]\d+)?)\s*KG\b/);
  if (mKg) return Math.round(parseFloat(mKg[1].replace(',', '.')) * 1000);
  const mG = text.match(/(\d+(?:[.,]\d+)?)\s*G\b/);
  if (mG) return Math.round(parseFloat(mG[1].replace(',', '.')));
  const mSku = String(sku || '').match(/0?(\d{2,3}|500|1000)$/);
  if (mSku) {
    const v = parseInt(mSku[1], 10);
    if (v >= 30 && v <= 1000) return v;
  }
  return 0;
}

/* ---- Kiểm tra đơn tạo trong khung giờ 18h hôm qua đến 7h30 sáng nay ---- */
function isOvernightOrder(ts) {
  if (!ts) return false;
  const now = new Date();
  const today730 = new Date(now);
  today730.setHours(7, 30, 0, 0);

  const yesterday18 = new Date(now);
  yesterday18.setDate(yesterday18.getDate() - 1);
  yesterday18.setHours(18, 0, 0, 0);

  return ts >= yesterday18.getTime() && ts <= today730.getTime();
}

/* ---- Định dạng ngày giờ ---- */
function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('vi-VN');
  return `${time} ${date}`;
}

/* ---- Chuẩn hóa tên sản phẩm thành tên Sá tương ứng ---- */
function normalizeSaName(name) {
  let s = String(name || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*\(sử dụng\)/gi, '')
       .replace(/\s*\/\s*sp mới/gi, '')
       .replace(/\s*\b\d+(?:[.,]\d+)?\s*k?g\b/gi, '')
       .replace(/\s*túi\b/gi, '')
       .replace(/\s*hộp\b/gi, '')
       .trim();
  if (/^combo\s*\d+\s*(.*)/i.test(s)) {
    s = s.replace(/^combo\s*\d+\s*/i, '').trim();
  }
  s = s.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (!s.toLowerCase().includes('sá')) {
    s += ' sá';
  }
  return s;
}

/* ---- Kiểm tra SKU hợp lệ để đánh mã lô (loại trừ mã kết thúc bằng 0200 / 0201) ---- */
function isLotEligibleSku(sku) {
  const s = String(sku || '').trim().toUpperCase();
  if (!s) return true;
  if (/(?:0200|0201)$/.test(s) || s.includes('*0200') || s.includes('*0201') || s.includes('-0200') || s.includes('-0201')) return false;
  return true;
}

/* ---- Lot history (localStorage, by SKU prefix) ---- */
const LOT_KEY = 'tc_lot_hist_v1';
function loadLotHist() {
  try { return JSON.parse(localStorage.getItem(LOT_KEY) || '{}'); } catch { return {}; }
}
function saveLotHist(h) {
  try { localStorage.setItem(LOT_KEY, JSON.stringify(h)); } catch {}
}
function skuPrefix(sku) {
  const s = String(sku || '').trim().toUpperCase();
  if (!s || /(?:0200|0201)$/.test(s) || s.includes('*0200') || s.includes('*0201') || s.includes('-0200') || s.includes('-0201')) return null;
  return s.slice(0, 3) || null;
}
function addLotHistory(sku, lot) {
  const p = skuPrefix(sku);
  const v = String(lot || '').trim();
  if (!p || !v) return;
  const h = loadLotHist();
  const arr = (h[p] || []).filter(x => x !== v);
  arr.unshift(v);
  h[p] = arr.slice(0, 12);
  saveLotHist(h);
}
function getLotSuggestions(sku, current) {
  const p = skuPrefix(sku);
  if (!p) return [];
  const h = loadLotHist();
  const fromHist = h[p] || [];
  const fromOrders = [];
  for (const o of S.orders) {
    for (const i of o.items) {
      if (i.lot && skuPrefix(i.sku) === p && !fromOrders.includes(i.lot)) fromOrders.push(i.lot);
    }
  }
  const all = [...fromHist];
  for (const x of fromOrders) if (!all.includes(x)) all.push(x);
  return all.filter(x => x !== current).slice(0, 6);
}

/* ---- Thông báo + âm thanh + đọc tên khách / nhắc nhở ---- */
function requestNotifyPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [0, 0.18, 0.36].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880 - i * 80;
      gain.gain.setValueAtTime(0.25, now + t);
      gain.gain.exponentialRampToValueAtTime(0.01, now + t + 0.15);
      osc.start(now + t);
      osc.stop(now + t + 0.16);
    });
  } catch (e) {}
}

function speakMessage(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN';
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;
    const voices = speechSynthesis.getVoices();
    const vi = voices.find(v => v.lang.startsWith('vi'));
    if (vi) u.voice = vi;
    speechSynthesis.speak(u);
  } catch (e) {}
}

/* ---- Kiểm tra đơn TikTok (người tạo / seller là OdooBot hoặc source tiktok) ---- */
function isTikTokOrder(o) {
  if (!o) return false;
  if (o.source === 'tiktok') return true;
  const seller = String(o.salesperson || '').toLowerCase();
  if (seller.includes('odoobot')) return true;
  return false;
}

function speakNewOrder(o) {
  if (isTikTokOrder(o)) {
    speakMessage('Có đơn TikTok mới');
    return;
  }
  const name = (o?.customer || o?.label || 'khách hàng').trim() || 'khách hàng';
  speakMessage(`Đã có đơn mới của khách hàng ${name}`);
}

function notifyNewOrders(newOrders) {
  // Người quản lý và Admin KHÔNG nhận chuông/TTS đơn mới
  if (S.user && (S.user.role === 'manager' || S.user.role === 'admin')) return;
  if (!newOrders.length) return;

  // Lọc tách đơn qua đêm (từ 18h hôm trước đến 7h30 sáng nay) và đơn thông thường
  const overnightOrders = newOrders.filter(o => isOvernightOrder(o.created_at));
  const regularOrders = newOrders.filter(o => !isOvernightOrder(o.created_at));

  // Quy tắc thông báo: Gộp các đơn từ 18h hôm qua đến 7h30 sáng nay thành 1 thông báo duy nhất
  if (overnightOrders.length > 0) {
    playAlertSound();
    const msg = `Có ${overnightOrders.length} đơn từ 18h hôm qua đến sáng nay`;
    speakMessage(msg);
    toast(msg);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification('Đơn đêm tồn đọng', {
          body: msg,
          icon: '/logo.png',
          tag: 'overnight-batch',
          requireInteraction: false
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch (e) {}
    }
  }

  // Các đơn sau 7h30 sáng nay đọc và thông báo bình thường
  if (regularOrders.length > 0) {
    if (overnightOrders.length === 0) playAlertSound();
    const startDelay = overnightOrders.length > 0 ? 3500 : 0;
    regularOrders.forEach((o, idx) => {
      setTimeout(() => speakNewOrder(o), startDelay + idx * 3500);
    });

    // Thông báo hệ thống
    if ('Notification' in window && Notification.permission === 'granted') {
      regularOrders.forEach(o => {
        const isTt = isTikTokOrder(o);
        const title = isTt ? ('Đơn TikTok mới · ' + (o.label || '')) : ('Đơn mới · ' + (o.label || ''));
        const body = isTt ? 'Có đơn TikTok mới' : `Đã có đơn mới của khách hàng ${o.customer || '—'}`;
        try {
          const n = new Notification(title, {
            body,
            icon: '/logo.png',
            tag: 'order-' + o.id,
            requireInteraction: false
          });
          n.onclick = () => { window.focus(); n.close(); };
        } catch (e) {}
      });
    }

    // Toast trên web
    if (overnightOrders.length === 0) {
      if (regularOrders.length === 1) {
        const o = regularOrders[0];
        toast(isTikTokOrder(o) ? ('Có đơn TikTok mới · ' + (o.label || '')) : ('Đã có đơn mới của khách hàng ' + (o.customer || o.label)));
      } else {
        toast(`Có ${regularOrders.length} đơn mới`);
      }
    }
  }
}

function detectNewOrders(orders) {
  const openIds = new Set(orders.filter(o => o.status === 'open').map(o => o.id));
  if (!notifiedOnce) {
    knownOrderIds = openIds;
    notifiedOnce = true;
    return;
  }
  const news = orders.filter(o => o.status === 'open' && !knownOrderIds.has(o.id));
  knownOrderIds = openIds;
  if (news.length) notifyNewOrders(news);
}

/* ---- Kiểm tra thông báo nhắc nhở từ quản lý (cho người đóng hàng) ---- */
async function checkNotifications() {
  if (!S.user) return;
  // Người quản lý không cần nhận thông báo nhắc nhở
  if (S.user.role === 'manager') return;

  try {
    const list = await api('/api/notifications?since=' + (lastNotificationCheck - 60000));
    if (!Array.isArray(list)) return;

    if (!notificationsLoadedOnce) {
      list.forEach(n => knownNotificationIds.add(n.id));
      notificationsLoadedOnce = true;
      return;
    }

    const unread = list.filter(n => !knownNotificationIds.has(n.id));
    for (const notif of unread) {
      knownNotificationIds.add(notif.id);
      playAlertSound();
      speakMessage(notif.message);

      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('Nhắc nhở đóng hàng', {
            body: notif.message,
            icon: '/logo.png',
            tag: 'notif-' + notif.id
          });
          n.onclick = () => { window.focus(); n.close(); };
        } catch (e) {}
      }

      toast('🔔 ' + notif.message);
    }
  } catch (e) {}
}

function makeDemo() {
  let id = 1, iid = 1;
  const ago = m => Date.now() - m * 60000;
  const O = (source, label, customer, phone, mins, priority, note, amount, items) => ({
    id: id++, source, ext_id: label, label, customer, phone: phone || '', email: '', address: '',
    note: note || '', salesperson: '', amount_total: amount || 0, currency: 'VND',
    priority, status: 'open', created_at: ago(mins),
    items: items.map(([name, sku, qty, done, lot]) => ({id: iid++, sku, name, qty, done: done ? 1 : 0, lot: lot || ''}))
  });
  const d = [
    O('odoo', 'S03627', 'CÔNG TY CỔ PHẦN SEVEN SYSTEM VIỆT NAM', '0901234567', 95, 1, 'Giao trước 15h, gói quà', 2450000,
      [['Tinh dầu sả chanh 100ml', 'TD01', 12], ['Xà phòng bồ kết', 'XP02', 24], ['Hộp quà nhỏ', 'HQ01', 6]]),
    O('shopee', 'S03618', 'SHOPEE', '', 60, 0, '', 185000,
      [['Tinh dầu sả chanh 100ml', 'TD01', 2, 1, '20/6'], ['Nến thơm lavender', 'NT03', 1]]),
    O('tiktok', 'S03632', 'Trịnh Thị Thanh Thảo', '0987654321', 40, 0, '', 320000,
      [['Xà phòng bồ kết', 'XP02', 5], ['Dầu gội thảo dược 300ml', 'DG04', 2]]),
    O('shopee', 'S03628', 'SHOPEE', '', 22, 0, '', 156000,
      [['Nến thơm lavender', 'NT03', 2], ['Tinh dầu bạc hà 50ml', 'TD05', 1]]),
    O('odoo', 'S03625', 'Siêu thị Qmart', '0911222333', 8, 0, '', 480000,
      [['Dầu gội thảo dược 300ml', 'DG04', 4], ['Tinh dầu sả chanh 100ml', 'TD01', 1]]),
    O('shopee', 'S03590', 'SHOPEE', '', 300, 0, '', 45000,
      [['Xà phòng bồ kết', 'XP02', 1, 1, '15/6']]),
  ];
  d[5].status = 'done';
  d[5].done_at = Date.now() - 120 * 60000;
  d[5].confirmed_by_name = 'Nhân viên Đóng Hàng';
  return d;
}

const DEMO_STORE_KEY = 'tc_demo_data_v2';
function getStoredDemo() {
  try {
    const s = localStorage.getItem(DEMO_STORE_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
function setStoredDemo(data) {
  try { localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(data)); } catch {}
}

async function api(u, m = 'GET', b) {
  if (!DEMO) {
    try {
      const headers = {'Content-Type': 'application/json'};
      try {
        const token = localStorage.getItem('tc_token');
        if (token) headers['Authorization'] = 'Bearer ' + token;
      } catch {}
      const r = await fetch(u, {method: m, headers, body: b ? JSON.stringify(b) : undefined});
      if (r.status === 401 && !u.includes('/api/auth/')) {
        window.location.href = '/login';
        return;
      }
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('bad');
      LIVE = true; return await r.json();
    } catch (e) {
      if (LIVE) throw e;
      DEMO = true;
      demoData = getStoredDemo() || makeDemo();
      setStoredDemo(demoData);
      $('#demo').style.display = 'flex';
    }
  }
  return demo(u, m, b);
}

function demo(u, m, b) {
  const D = demoData, parts = u.split('/');
  if (u === '/api/auth/me') {
    return { ok: true, user: S.user || { id: 1, username: 'demo', display_name: 'Người dùng Thử nghiệm', role: 'packer' } };
  }
  if (u === '/api/auth/logout') return { ok: true };
  if (u === '/api/status') return {enabled: true, ok_at: Date.now() - 60000, error: ''};
  if (u === '/api/sync') return {ok: true, error: ''};
  if (u.startsWith('/api/mix-lot')) {
    if (m === 'POST') {
      try { localStorage.setItem('tc_demo_mix_lot', JSON.stringify(b.lots)); } catch {}
      return { ok: true, lots: b.lots };
    }
    let lots = {};
    try { lots = JSON.parse(localStorage.getItem('tc_demo_mix_lot') || '{}'); } catch {}
    return { ok: true, lots };
  }
  if (u.startsWith('/api/notifications')) return [];
  if (u.includes('/remind')) {
    const id = +parts[3];
    const o = D.find(x => x.id === id);
    const mgr = S.user?.display_name || 'Quản lý';
    const cust = o?.customer || o?.label || 'đơn hàng';
    const dateStr = new Date(o?.created_at || Date.now()).toLocaleDateString('vi-VN');
    return { ok: true, message: `${mgr} đã nhắc nhở về đơn hàng của khách hàng ${cust} ngày ${dateStr}` };
  }
  if (u === '/api/items/batch-lot') {
    const updates = b?.updates || [];
    for (const upd of updates) {
      for (const o of D) {
        for (const i of o.items) {
          if (i.id === upd.id) i.lot = upd.lot;
        }
      }
    }
    setStoredDemo(D);
    return { ok: true, count: updates.length };
  }
  if (m === 'GET') return JSON.parse(JSON.stringify(D)).sort((a, c) => c.priority - a.priority || a.created_at - c.created_at);
  const id = +parts[3];
  if (parts[2] === 'orders') {
    const o = D.find(x => x.id === id);
    if (b.priority !== undefined) o.priority = b.priority ? 1 : 0;
    if (b.status === 'done') {
      o.items.forEach(i => i.done = 1);
      o.status = 'done';
      o.done_at = Date.now();
      o.confirmed_by = S.user ? S.user.id : 1;
      o.confirmed_by_name = S.user ? S.user.display_name : 'Người đóng hàng';
    }
    setStoredDemo(D);
  } else {
    for (const o of D) for (const i of o.items) if (i.id === id) {
      if (b.done !== undefined) i.done = b.done ? 1 : 0;
      if (b.lot !== undefined) i.lot = b.lot;
    }
    setStoredDemo(D);
  }
  return {ok: true};
}

const fq = n => Number.isInteger(+n) ? +n : (+n).toFixed(2);
function ago(t) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return m + ' phút trước';
  if (m < 1440) return Math.floor(m / 60) + ' giờ trước';
  return new Date(t).toLocaleDateString('vi-VN');
}
function fmtMoney(n, cur) {
  if (!n) return '';
  return new Intl.NumberFormat('vi-VN').format(n) + (cur ? ' ' + cur : '');
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2800);
}

function startOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(0,0,0,0); return x.getTime();
}
function matchDate(ts) {
  if (S.date === 'all') return true;
  const day = startOfDay();
  if (S.date === 'today') return ts >= day;
  if (S.date === 'yesterday') return ts >= day - 86400000 && ts < day;
  if (S.date === '7d') return ts >= day - 6 * 86400000;
  return true;
}
function matchQuery(o) {
  const q = S.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [o.label, o.customer, o.phone, o.note, o.address, o.salesperson, o.confirmed_by_name, ...(o.items||[]).map(i => i.name + ' ' + i.sku)].join(' ').toLowerCase();
  return hay.includes(q);
}

function preserveScroll(fn) {
  const g = $('#grid');
  scrollY = g ? g.scrollTop : 0;
  fn();
  requestAnimationFrame(() => {
    const g2 = $('#grid');
    if (g2) g2.scrollTop = scrollY;
  });
}

async function load(soft) {
  const prevOpen = S.open;
  const orders = await api('/api/orders');
  if (!Array.isArray(orders)) return;
  S.orders = orders;
  S.status = await api('/api/status').catch(() => null);
  if (prevOpen && !S.orders.find(x => x.id === prevOpen)) S.open = null;

  // Phát hiện đơn mới và thông báo (cho người đóng hàng)
  detectNewOrders(orders);

  if (soft) preserveScroll(render); else render();
}

function render() {
  // Tính toán số lượng cần chuẩn bị theo quy tắc:
  // - Nếu có đơn được chọn: tính cho các đơn đã chọn (đang open)
  // - Nếu không chọn đơn: tính cho tất cả đơn đang open
  const hasSelection = S.selected.size > 0;
  const prepOrders = hasSelection
    ? S.orders.filter(o => S.selected.has(o.id) && o.status === 'open')
    : S.orders.filter(o => o.status === 'open');

  // Khởi tạo bản đồ các loại sản phẩm làm từ Sá (gồm 8 loại chủ lực và các loại khác)
  const saMap = new Map();
  FRUIT_8_KEYS.forEach(f => {
    saMap.set(f.id, { id: f.id, name: f.name, short: f.short, grams: 0, pieces: 0, orders: new Set() });
  });

  // Bản đồ sản phẩm vật tư / đóng sẵn không qua mã lô (chỉ gồm SKU đuôi 0200 / 0201)
  const otherMap = new Map();

  for (const o of prepOrders) {
    for (const i of o.items) {
      if (i.done) continue;
      const sku = String(i.sku || '').trim().toUpperCase();
      const is0200_0201 = /(?:0200|0201)$/i.test(sku) || sku.includes('*0200') || sku.includes('*0201') || sku.includes('-0200') || sku.includes('-0201');

      if (is0200_0201) {
        // Quy tắc: Những mã đuôi 0200 / 0201 gộp theo tên sản phẩm đó lại (thùng, bao bì, vật tư...)
        const key = i.name;
        const r = otherMap.get(key) || { name: key, qty: 0, orders: new Set() };
        r.qty += +i.qty;
        r.orders.add(o.id);
        otherMap.set(key, r);
        continue;
      }

      // TẤT CẢ SẢN PHẨM CÒN LẠI ĐỀU ĐƯỢC TẠO THÀNH TỪ SÁ:
      // 1. Mã TCC8* (Trái cây cuộn 8 vị): chia đều khối lượng cho 8 loại sá
      const isTCC8 = /^TCC8/i.test(sku) || /8\s*VỊ/i.test(i.name);
      if (isTCC8) {
        const unitGrams = extractItemWeightGrams(sku, i.name) || 200;
        const totalGrams = unitGrams * +i.qty;
        const perFlavorGrams = totalGrams / 8;
        FRUIT_8_KEYS.forEach(f => {
          const itemSa = saMap.get(f.id);
          itemSa.grams += perFlavorGrams;
          itemSa.orders.add(o.id);
        });
        continue;
      }

      // 2. Mã thanh bar 3 vị (T3V*): chia đều me cuộn, khóm cuộn, xoài cuộn muối ớt
      const isT3V = /^T3V/i.test(sku) || /THANH BAR.*3\s*VỊ/i.test(i.name) || /THANH BAR NHIỆT ĐỚI/i.test(i.name);
      if (isT3V) {
        const unitGrams = extractItemWeightGrams(sku, i.name) || 150;
        const totalGrams = unitGrams * +i.qty;
        const perFlavor = totalGrams / 3;
        ['khom', 'me'].forEach(k => {
          const itemSa = saMap.get(k);
          if (itemSa) {
            itemSa.grams += perFlavor;
            itemSa.orders.add(o.id);
          }
        });
        const xoaiMoKey = 'xoai_cuon_muoi_ot_sa';
        if (!saMap.has(xoaiMoKey)) {
          saMap.set(xoaiMoKey, { id: xoaiMoKey, name: 'Xoài cuộn muối ớt sá', short: '', grams: 0, pieces: 0, orders: new Set() });
        }
        const xm = saMap.get(xoaiMoKey);
        xm.grams += perFlavor;
        xm.orders.add(o.id);
        continue;
      }

      // 3. Khớp trực tiếp vào 1 trong 8 loại cuộn chủ lực
      const matchedFruit = FRUIT_8_KEYS.find(f => f.match.test(i.name) || f.match.test(sku));
      if (matchedFruit) {
        const unitGrams = extractItemWeightGrams(sku, i.name);
        const totalGrams = unitGrams > 0 ? (unitGrams * +i.qty) : (+i.qty * 100);
        const itemSa = saMap.get(matchedFruit.id);
        itemSa.grams += totalGrams;
        itemSa.orders.add(o.id);
        continue;
      }

      // 4. Toàn bộ các sản phẩm bánh kẹo, cuộn, bánh phồng... còn lại đều gom thành Sá
      const saName = normalizeSaName(i.name);
      const comboM = i.name.match(/combo\s*(\d+)/i);
      const mult = comboM ? parseInt(comboM[1], 10) : 1;
      const unitGrams = extractItemWeightGrams(sku, i.name);
      const totalQty = (+i.qty) * mult;

      let saEntry = saMap.get(saName);
      if (!saEntry) {
        saEntry = { id: saName, name: saName, short: '', grams: 0, pieces: 0, orders: new Set() };
        saMap.set(saName, saEntry);
      }
      if (unitGrams > 0) {
        saEntry.grams += unitGrams * totalQty;
      } else {
        saEntry.pieces += totalQty;
      }
      saEntry.orders.add(o.id);
    }
  }

  const saList = [...saMap.values()].filter(x => x.grams > 0 || x.pieces > 0).sort((a, b) => b.grams - a.grams || b.pieces - a.pieces);
  const otherList = [...otherMap.values()].sort((a, b) => b.qty - a.qty);

  const fmtWeight = g => {
    if (g >= 1000) return (g / 1000).toFixed(2).replace(/\.00$/, '') + ' kg';
    return Math.round(g) + 'g';
  };

  const fmtSaAmount = r => {
    const parts = [];
    if (r.grams > 0) parts.push(fmtWeight(r.grams));
    if (r.pieces > 0) parts.push(r.pieces + ' phần');
    return parts.join(' + ') || '0';
  };

  let sumHtml = '';
  if (hasSelection) {
    sumHtml += `<div class="s-section sa"><span>Tính cho ${prepOrders.length} đơn đã chọn</span><button class="batch-link" data-prep-all="1">Xem tất cả</button></div>`;
  }
  if (saList.length > 0) {
    sumHtml += `<div class="s-section sa">Cần chuẩn bị từ Sá</div>`;
    sumHtml += saList.map(r => `
      <div class="srow sa-row">
        <div class="t">
          <b>${esc(r.name)}</b>
          <small>${r.orders.size} đơn${r.short ? ` · viết tắt: <b>${esc(r.short)}</b>` : ''}</small>
        </div>
        <div class="n" style="font-size:16px">${fmtSaAmount(r)}</div>
      </div>
    `).join('');
  }
  if (otherList.length > 0) {
    sumHtml += `<div class="s-section">Vật tư & Thùng carton (đuôi 0200/0201)</div>`;
    sumHtml += otherList.map(r => `
      <div class="srow">
        <div class="t">
          ${esc(r.name)}
          <small>${r.orders.size} đơn</small>
        </div>
        <div class="n">${fq(r.qty)}</div>
      </div>
    `).join('');
  }
  if (!saList.length && !otherList.length) {
    sumHtml = '<div class="empty" style="padding:40px 10px;font-size:14px">Không còn gì cần chuẩn bị</div>';
  }
  $('#sum').innerHTML = sumHtml;

  const totalTypes = saList.length + otherList.length;
  $('#sfoot').textContent = totalTypes ? `${totalTypes} loại cần chuẩn bị` : '';

  const open = S.orders.filter(o => o.status === 'open');
  $('#bn1').textContent = open.length; $('#bn2').textContent = totalTypes;

  const curTabOrders = S.orders.filter(o => o.status === S.tab);
  const cnt = {all: curTabOrders.length, pri: curTabOrders.filter(o => o.priority).length};
  for (const k of ['shopee', 'tiktok', 'odoo']) cnt[k] = curTabOrders.filter(o => o.source === k).length;
  $('#chips').innerHTML = [['all', 'Tất cả'], ['pri', 'Ưu tiên'], ['shopee', 'Shopee'], ['tiktok', 'TikTok'], ['odoo', 'Khác']].map(([k, l]) =>
    `<button class="chip ${S.filter === k ? 'on' : ''}" data-filter="${k}">${l} · ${cnt[k]}</button>`).join('');
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  document.querySelectorAll('#dates button').forEach(b => b.classList.toggle('on', b.dataset.date === S.date));

  const st = S.status;
  if (!st || !st.enabled) {
    $('#sync').innerHTML = '';
  } else if (st.error) {
    $('#sync').innerHTML = `<span class="dot err"></span><span class="err">Lỗi Odoo: ${esc(st.error)}</span>`;
  } else {
    $('#sync').innerHTML = st.ok_at
      ? `<span class="dot"></span>Đồng bộ ${ago(st.ok_at)}`
      : `<span class="dot"></span>Đang kết nối...`;
  }

  let list = S.orders.filter(o => {
    if (o.status !== S.tab) return false;
    const orderTime = o.status === 'done' ? (o.done_at || o.created_at) : o.created_at;
    if (!matchDate(orderTime)) return false;
    if (!matchQuery(o)) return false;
    if (S.filter === 'pri') return Boolean(o.priority);
    if (S.filter !== 'all') return o.source === S.filter;
    return true;
  });

  if (S.tab === 'done') {
    list.sort((a, b) => (b.done_at || b.created_at) - (a.done_at || a.created_at));
  } else {
    list.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || a.created_at - b.created_at);
  }

  const emptyMsg = S.tab === 'done'
    ? (S.filter !== 'all' || S.q || S.date !== 'all' ? 'Không có đơn đã xong nào khớp bộ lọc' : 'Chưa có đơn nào hoàn tất')
    : (S.filter === 'all' && !S.q && S.date === 'all' ? 'Không còn đơn nào cần đóng' : 'Không có đơn nào khớp bộ lọc');

  const isManager = S.user && (S.user.role === 'manager' || S.user.role === 'admin');
  const isAdmin = S.user && S.user.role === 'admin';

  $('#grid').innerHTML = list.length ? list.map(o => {
    const d = o.items.filter(i => i.done).length, t = o.items.length;
    const todo = o.items.filter(i => !i.done).slice(0, 3).map(i => `${esc(i.name)} <b>×${fq(i.qty)}</b>`).join('<br>');
    const phoneHtml = o.phone ? `<a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>` : '';
    const money = o.amount_total ? fmtMoney(o.amount_total, o.currency) : '';
    const isSel = S.selected.has(o.id);
    const isDone = o.status === 'done';
    const isOvernight = isOvernightOrder(o.created_at);

    return `<div class="card ${o.priority ? 'pri' : ''} ${isDone ? 'fin' : ''} ${isSel ? 'selected' : ''} ${isOvernight && !isDone ? 'overnight' : ''}" data-id="${o.id}">
      <div class="h">
        <button class="sel-btn ${isSel ? 'on' : ''}" data-sel="${o.id}" aria-label="Chọn đơn">
          ${isSel ? IC_CHK : ''}
        </button>
        <div class="h-info">
          <div class="code" ${isOvernight && !isDone ? 'style="color:#dc2626;font-weight:800"' : ''}>${esc(o.label)}</div>
          <div class="cust">${esc(o.customer)}</div>
        </div>
        ${isManager && !isDone ? `<button class="remind-btn" data-remind="${o.id}" title="Nhắc nhở đơn này">🔔 Nhắc nhở</button>` : ''}
        ${isAdmin ? `<button class="del-card-btn" data-del-order="${o.id}" title="Xóa đơn hàng" style="color:var(--mute);padding:6px;border-radius:4px;display:flex;align-items:center" aria-label="Xóa đơn"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ''}
        <button class="star ${o.priority ? 'on' : ''}" data-star="${o.id}" aria-label="Ưu tiên">${IC_FLAG}</button>
      </div>
      <div class="meta">
        <span class="tag ${o.source}">${SRC[o.source] || o.source}</span>
        ${isOvernight && !isDone ? '<span class="tag tag-red">ĐƠN ĐÊM 18H-7H30</span>' : ''}
        ${o.priority && !isDone ? '<span class="tag pri">ƯU TIÊN</span>' : ''}
        ${isDone ? '<span class="tag ok">HOÀN TẤT</span>' : ''}
        <span class="ago">${isDone ? (o.done_at ? 'Xong ' + ago(o.done_at) : ago(o.created_at)) : ago(o.created_at)}</span>
      </div>
      ${phoneHtml || money ? `<div class="extra">${phoneHtml}${phoneHtml && money ? ' · ' : ''}${money ? '<b>' + money + '</b>' : ''}</div>` : ''}
      <div class="names">${todo || 'Đã xong hết'}</div>
      ${isDone ? `
        <div class="done-details">
          <span>🕒 Hoàn tất: <b>${fmtDateTime(o.done_at || o.created_at)}</b> (${ago(o.done_at || o.created_at)})</span>
          ${o.confirmed_by_name ? `<span>👤 Người đóng: <b>${esc(o.confirmed_by_name)}</b></span>` : ''}
        </div>
      ` : `
        <div class="bar"><i style="width:${t ? d / t * 100 : 0}%"></i></div>
        <div class="prog"><span>Đã đóng ${d}/${t} món</span><span>Mở đơn ›</span></div>
      `}
    </div>`;
  }).join('') : `<div class="empty">${emptyMsg}</div>`;

  renderBatchBar(list);
  renderModal();
}

function renderModal() {
  const o = S.orders.find(x => x.id === S.open);
  $('#modal').classList.toggle('on', !!o);
  if (!o) return;
  const d = o.items.filter(i => i.done).length, t = o.items.length;
  const money = o.amount_total ? fmtMoney(o.amount_total, o.currency) : '';
  const isManager = S.user && (S.user.role === 'manager' || S.user.role === 'admin');
  const isAdmin = S.user && S.user.role === 'admin';
  const isDone = o.status === 'done';

  $('#sheet').innerHTML = `
    <header>
      <button class="btn" data-close="1">‹ Quay lại</button>
      <h3>${esc(o.label)} <span class="tag ${o.source}" style="vertical-align:middle">${SRC[o.source] || o.source}</span>
        <div class="cust" style="font-size:13px;font-weight:400;margin-top:2px">${esc(o.customer)}</div>
      </h3>
      ${isManager && !isDone ? `<button class="remind-btn" data-remind="${o.id}">🔔 Nhắc nhở đơn này</button>` : ''}
      <button class="btn s ${o.priority ? 'on' : ''}" data-star="${o.id}">${IC_FLAG}<span>${o.priority ? 'Đã ưu tiên' : 'Đánh ưu tiên'}</span></button>
    </header>
    ${isDone ? `
      <div class="done-banner">
        <span>✅ Đã hoàn tất lúc <b>${fmtDateTime(o.done_at || o.created_at)}</b> (${ago(o.done_at || o.created_at)})</span>
        ${o.confirmed_by_name ? `<span>· Người đóng hàng: <b>${esc(o.confirmed_by_name)}</b></span>` : ''}
      </div>
    ` : ''}
    ${o.note ? `<div class="note"><b>Ghi chú:</b> ${esc(o.note)}</div>` : ''}
    <div class="info-row">
      ${o.phone ? `<span>📞 <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></span>` : ''}
      ${money ? `<span>💰 <b>${money}</b></span>` : ''}
      ${o.salesperson ? `<span>👤 ${esc(o.salesperson)}</span>` : ''}
      ${o.address ? `<span>📍 ${esc(o.address)}</span>` : ''}
    </div>
    <div class="cols lbl"><span>Sản phẩm / số lượng</span><span>Mã lô</span></div>
    <div id="items">${o.items.map(i => {
      const sug = getLotSuggestions(i.sku, i.lot);
      return `
      <div class="it ${i.done ? 'done' : ''}">
        <div class="tap" data-chk="${i.id}" data-v="${i.done ? 0 : 1}">
          <button class="chk" tabindex="-1">${i.done ? IC_CHK : ''}</button>
          <div class="nm">${esc(i.name)}<small>${esc(i.sku)}</small></div>
          <div class="qty">×${fq(i.qty)}</div>
        </div>
        <div class="lotw">
          <input class="lot" data-lot="${i.id}" data-sku="${esc(i.sku)}" value="${esc(i.lot)}" placeholder="Mã lô (vd 20/6)" autocomplete="off" autocapitalize="off">
          ${sug.length ? `<div class="rec">${sug.map(r => `<button data-setlot="${i.id}" data-val="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
        </div>
      </div>`;
    }).join('')}
    </div>
    <div class="foot">
      <b>${d}/${t} món</b>
      <div class="bar"><i style="width:${t ? d / t * 100 : 0}%"></i></div>
      ${isDone
        ? `<div style="font-size:13px;color:var(--ok);font-weight:700">Đơn hàng đã hoàn tất</div>`
        : (d === t && t > 0
          ? `<button class="btn p" data-all="${o.id}">Hoàn tất đơn</button>`
          : `<button class="btn" data-all="${o.id}" disabled style="opacity:.45;cursor:not-allowed" title="Cần tick đủ tất cả ${t} món mới được hoàn tất">Tick đủ ${t} món để hoàn tất (${d}/${t})</button>`)
      }
      ${isAdmin ? `
        <button class="btn btn-del-order" style="margin-top:12px;width:100%;padding:10px 14px;display:flex;align-items:center;justify-content:center;gap:6px" data-del-order="${o.id}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          <span>Xóa vĩnh viễn đơn hàng này</span>
        </button>
      ` : ''}
    </div>`;
}

function openOrder(id) { S.open = id; history.pushState({m: 1}, ''); renderModal(); }
function closeOrder() { if (history.state && history.state.m) history.back(); else { S.open = null; render(); } }
window.addEventListener('popstate', () => {
  if (S.batchOpen) closeBatchModal();
  if (S.open) { S.open = null; render(); }
});

/* ---- Batch lot operations ---- */
let currentBatchGroups = [];

function renderBatchBar(filteredList) {
  const bar = $('#batch-bar');
  if (!bar) return;
  if (S.selected.size === 0) {
    bar.innerHTML = '';
    bar.classList.remove('on');
    return;
  }
  bar.classList.add('on');
  bar.innerHTML = `
    <div class="batch-bar-inner">
      <div class="batch-info">
        <span class="batch-badge">${S.selected.size}</span>
        <span class="batch-text">đơn đã chọn</span>
        <button class="batch-link" data-batch-all="1">Chọn tất cả (${filteredList.length})</button>
        <button class="batch-link" data-batch-clear="1">Bỏ chọn</button>
      </div>
      <button class="btn p batch-btn" data-batch-open="1">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        <span>Đánh mã lô</span>
      </button>
    </div>
  `;
}

function openBatchModal() {
  const selOrders = S.orders.filter(o => S.selected.has(o.id));
  if (!selOrders.length) return toast('Vui lòng chọn ít nhất 1 đơn');

  const groupMap = new Map();
  let totalEligibleItems = 0;
  for (const o of selOrders) {
    for (const it of o.items) {
      if (!it.done) continue;
      if (!isLotEligibleSku(it.sku)) continue;

      totalEligibleItems++;
      const key = it.sku ? ('SKU:' + it.sku.trim().toUpperCase()) : ('NAME:' + it.name.trim().toLowerCase());
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          sku: it.sku || '',
          name: it.name,
          items: [],
          totalQty: 0,
          orders: new Set(),
          lots: new Set()
        });
      }
      const g = groupMap.get(key);
      g.items.push({ orderId: o.id, orderLabel: o.label, itemId: it.id, qty: it.qty, lot: it.lot || '' });
      g.totalQty += Number(it.qty) || 0;
      g.orders.add(o.label);
      if (it.lot) g.lots.add(it.lot);
    }
  }

  if (totalEligibleItems === 0) {
    return toast('Không có sản phẩm nào đã tick để đánh mã lô (đã bỏ qua mã 0200)');
  }

  currentBatchGroups = Array.from(groupMap.values());
  renderBatchModal(currentBatchGroups, selOrders.length, totalEligibleItems);
}

function renderBatchModal(groups, orderCount, totalItems) {
  const m = $('#batch-modal');
  if (!m) return;
  m.classList.add('on');
  S.batchOpen = true;

  $('#batch-sheet').innerHTML = `
    <header>
      <button class="btn" data-batch-close="1">‹ Quay lại</button>
      <h3>Đánh mã lô hàng loạt
        <div class="cust" style="font-size:12.5px;font-weight:400;margin-top:2px">
          Áp dụng cho ${totalItems} món đã tick từ ${orderCount} đơn đã chọn
        </div>
      </h3>
    </header>
    <div class="note" style="margin-top:10px">
      <b>Lưu ý:</b> Chỉ cập nhật cho các sản phẩm <b>đã tick hoàn thành</b> trong các đơn được chọn. Sản phẩm chưa tick (chờ sản xuất) và mã kết thúc bằng 0200, 0201 được tự động bỏ qua.
    </div>
    <div class="cols lbl"><span>Sản phẩm trùng nhau</span><span>Mã lô chung</span></div>
    <div id="batch-items" class="batch-items-list">
      ${groups.map(g => {
        const sug = getLotSuggestions(g.sku, '');
        const currentLotList = Array.from(g.lots).filter(Boolean);
        const defaultVal = currentLotList.length === 1 ? currentLotList[0] : '';
        const is8Vi = /^TCC8/i.test(g.sku) || /8\s*VỊ/i.test(g.name);
        return `
        <div class="it batch-it">
          <div class="nm">
            ${esc(g.name)}
            <small>${esc(g.sku || 'Không có SKU')} · <b>×${fq(g.totalQty)}</b> trong ${g.orders.size} đơn (${Array.from(g.orders).join(', ')})</small>
            ${currentLotList.length ? `<small style="color:var(--text2);margin-top:2px">Mã lô hiện có: <i>${esc(currentLotList.join(', '))}</i></small>` : ''}
          </div>
          <div class="lotw">
            <input class="lot batch-lot-input" data-group-key="${esc(g.key)}" value="${esc(defaultVal)}" placeholder="Nhập mã lô (vd 20/6)" autocomplete="off">
            <div class="rec">
              ${is8Vi ? `<button data-batch-fillmix="${esc(g.key)}" style="background:var(--pri2);color:var(--pri);font-weight:700">Dùng lô MIX hôm nay</button>` : ''}
              ${sug.map(r => `<button data-batch-setlot="${esc(g.key)}" data-val="${esc(r)}">${esc(r)}</button>`).join('')}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="foot">
      <button class="btn" data-batch-close="1">Hủy</button>
      <button class="btn p" data-batch-apply="1" style="margin-left:auto">Áp dụng mã lô (${totalItems} món)</button>
    </div>
  `;
}

function closeBatchModal() {
  S.batchOpen = false;
  const m = $('#batch-modal');
  if (m) m.classList.remove('on');
}

/* ---- MIX 8 VỊ MODAL ---- */
async function openMixModal() {
  const m = $('#mix-modal');
  if (!m) return;
  m.classList.add('on');
  S.mixOpen = true;

  let lots = {};
  try {
    const res = await api('/api/mix-lot');
    if (res && res.lots) lots = res.lots;
  } catch {}

  $('#mix-sheet').innerHTML = `
    <header>
      <button class="btn" data-mix-close="1">‹ Quay lại</button>
      <h3>Mã Lô MIX 8 Vị Hôm Nay
        <div class="cust" style="font-size:12.5px;font-weight:400;margin-top:2px">
          Ngày ${new Date().toLocaleDateString('vi-VN')} · Nhập mã lô cho 8 loại trái cây cuộn
        </div>
      </h3>
    </header>
    <div class="note" style="margin:12px 16px 0">
      <b>Lưu ý:</b> Lưu mã lô cho 8 loại trái cây cuộn mỗi ngày (điều, đậu, SR, mè, khóm, me, MC, xoài). Dùng để kiểm soát và tự động điền mã lô cho các sản phẩm Mix 8 vị.
    </div>
    <div class="mix-grid">
      ${FRUIT_8_KEYS.map(f => `
        <div class="mix-box">
          <label>${esc(f.name)} (${esc(f.short)})</label>
          <input type="text" class="mix-input" data-mix-key="${esc(f.id)}" data-short="${esc(f.short)}" value="${esc(lots[f.id] || '')}" placeholder="vd: 20/6" autocomplete="off">
        </div>
      `).join('')}
    </div>
    <div class="mix-summary">
      <b>Chuỗi mã lô MIX:</b> <span id="mix-preview-str" style="font-weight:600;color:var(--pri)"></span>
    </div>
    <div class="foot">
      <button class="btn" data-mix-close="1">Hủy</button>
      <button class="btn p" data-mix-save="1" style="margin-left:auto">Lưu mã lô MIX hôm nay</button>
    </div>
  `;
  updateMixPreview();
}

function updateMixPreview() {
  const inputs = document.querySelectorAll('.mix-input');
  const parts = [];
  inputs.forEach(inp => {
    const val = inp.value.trim();
    const short = inp.dataset.short;
    if (val && short) parts.push(`${short}: ${val}`);
  });
  const prev = $('#mix-preview-str');
  if (prev) prev.textContent = parts.length ? parts.join(', ') : '(Chưa có mã lô)';
}

function closeMixModal() {
  S.mixOpen = false;
  const m = $('#mix-modal');
  if (m) m.classList.remove('on');
}

async function saveMixLots() {
  const inputs = document.querySelectorAll('.mix-input');
  const lots = {};
  inputs.forEach(inp => {
    const val = inp.value.trim();
    if (val) lots[inp.dataset.mixKey] = val;
  });
  await api('/api/mix-lot', 'POST', { lots });
  toast('Đã lưu mã lô MIX 8 vị hôm nay');
  closeMixModal();
}

/* ---- MODAL PHÂN QUYỀN & QUẢN LÝ NGƯỜI DÙNG (DÀNH CHO ADMIN) ---- */
function closeUsersModal() {
  const m = $('#users-modal');
  if (m) m.classList.remove('on');
}

async function openUsersModal() {
  const m = $('#users-modal');
  const sheet = $('#users-sheet');
  sheet.innerHTML = `
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid var(--line);padding-bottom:12px">
      <h3 style="margin:0;font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px">
        <span>👥</span>
        <span>Quản lý & Phân quyền tài khoản</span>
      </h3>
      <button class="btn" data-users-close="1" style="font-size:13.5px;padding:4px 8px">✕ Đóng</button>
    </header>
    <div id="users-list-body" style="min-height:120px;display:flex;align-items:center;justify-content:center;color:var(--mute)">
      Đang tải danh sách tài khoản...
    </div>
  `;
  m.classList.add('on');

  try {
    const res = await api('/api/users');
    if (!res || !res.ok) throw new Error(res?.error || 'Không tải được danh sách người dùng');
    renderUsersList(res.users || []);
  } catch (err) {
    const b = $('#users-list-body');
    if (b) b.innerHTML = `<div style="color:var(--warn);text-align:center">${esc(err.message)}</div>`;
  }
}

function renderUsersList(users) {
  const container = $('#users-list-body');
  if (!container) return;
  if (!users.length) {
    container.innerHTML = '<div style="color:var(--mute);text-align:center">Chưa có người dùng nào</div>';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div style="font-size:12.5px;color:var(--mute);margin-bottom:14px;line-height:1.4">
      Tài khoản <b>admin</b> có quyền chuyển đổi vai trò giữa <b>Quản lý</b> và <b>Đóng hàng</b> cho tất cả nhân viên.
    </div>
    <div class="user-items-container">
      ${users.map(u => {
        const isAdminUser = u.username === 'admin' || u.role === 'admin';
        return `
          <div class="user-item-row">
            <div class="user-item-meta">
              <b>${esc(u.display_name)} <span style="font-weight:normal;color:var(--mute)">(@${esc(u.username)})</span></b>
              <small>Tạo: ${new Date(u.created_at).toLocaleDateString('vi-VN')} · Hiện tại: <b style="color:${u.role === 'admin' ? '#dc2626' : (u.role === 'manager' ? '#8b5cf6' : 'var(--pri)')}">${u.role === 'admin' ? 'Quản trị viên' : (u.role === 'manager' ? 'Quản lý' : 'Đóng hàng')}</b></small>
            </div>
            <div>
              ${isAdminUser ? `
                <span style="font-size:12px;font-weight:700;color:#dc2626;background:var(--head);padding:4px 8px;border-radius:4px">Admin</span>
              ` : `
                <div class="role-btn-group">
                  <button class="role-btn ${u.role === 'manager' ? 'active manager' : ''}" data-change-role="manager" data-uid="${u.id}" data-uname="${esc(u.display_name)}">Quản lý</button>
                  <button class="role-btn ${u.role === 'packer' ? 'active' : ''}" data-change-role="packer" data-uid="${u.id}" data-uname="${esc(u.display_name)}">Đóng hàng</button>
                </div>
              `}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function act(fn, opts = {}) {
  try {
    await fn();
    if (opts.localOnly) {
      preserveScroll(render);
    } else {
      await load(true);
    }
  } catch (e) {
    toast('Mất kết nối, thử lại nhé');
    load(true).catch(() => {});
  }
}

function setLot(id, v, sku) {
  for (const o of S.orders) for (const i of o.items) if (i.id == id) {
    i.lot = v;
    if (sku || i.sku) addLotHistory(sku || i.sku, v);
  }
  return api('/api/items/' + id, 'PATCH', {lot: v}).then(() => {
    if (v) toast('Đã lưu mã lô ' + v);
  }).catch(() => toast('Chưa lưu được mã lô'));
}

async function refresh() {
  const t = $('#rft'); t.textContent = 'Đang cập nhật...';
  try {
    const r = await api('/api/sync', 'POST');
    await load(true);
    toast(r.ok ? 'Đã cập nhật' : 'Lỗi Odoo: ' + r.error);
  } catch (e) { toast('Mất kết nối, thử lại nhé'); }
  t.textContent = 'Cập nhật';
}

document.addEventListener('click', e => {
  const t = e.target, q = k => t.closest(`[data-${k}]`);
  let el;
  if ((el = q('view'))) {
    document.body.classList.toggle('v-sum', el.dataset.view === 'sum');
    document.querySelectorAll('#bnav button').forEach(b => b.classList.toggle('on', b === el));
    return;
  }
  if ((el = q('tab'))) { S.tab = el.dataset.tab; return preserveScroll(render); }
  if ((el = q('filter'))) { S.filter = el.dataset.filter; return preserveScroll(render); }
  if ((el = q('date'))) { S.date = el.dataset.date; return preserveScroll(render); }
  if (q('refresh')) return refresh();
  if (q('reset')) {
    localStorage.removeItem(DEMO_STORE_KEY);
    demoData = makeDemo();
    setStoredDemo(demoData);
    return load();
  }
  if ((el = q('sel'))) {
    e.stopPropagation();
    const id = +el.dataset.sel;
    if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
    return preserveScroll(render);
  }
  if (q('batch-all')) {
    let list = S.orders.filter(o => o.status === S.tab && matchDate(o.created_at) && matchQuery(o));
    if (S.tab === 'open') list = list.filter(o => S.filter === 'all' || (S.filter === 'pri' ? o.priority : o.source === S.filter));
    list.forEach(o => S.selected.add(o.id));
    return preserveScroll(render);
  }
  if (q('batch-clear')) {
    S.selected.clear();
    return preserveScroll(render);
  }
  if (q('batch-open')) return openBatchModal();
  if (q('batch-close') || t.id === 'batch-modal') return closeBatchModal();
  if (t.closest('#btn-mix')) return openMixModal();
  if (q('mix-close') || t.id === 'mix-modal') return closeMixModal();
  if (q('mix-save')) return saveMixLots();

  // Admin: Mở modal phân quyền & quản lý người dùng
  if (t.closest('#btn-users')) return openUsersModal();
  if (q('users-close') || t.id === 'users-modal') return closeUsersModal();

  // Admin: Thay đổi vai trò người dùng
  if ((el = q('change-role'))) {
    const uid = el.dataset.uid;
    const newRole = el.dataset.changeRole;
    const uname = el.dataset.uname;
    api('/api/users/' + uid + '/role', 'PATCH', { role: newRole }).then(async res => {
      if (res && res.ok) {
        toast(`Đã chuyển vai trò của ${uname} sang ${newRole === 'manager' ? 'Quản lý' : 'Đóng hàng'}`);
        const refreshed = await api('/api/users');
        if (refreshed?.ok) renderUsersList(refreshed.users);
      } else {
        toast(res?.error || 'Không thể đổi vai trò');
      }
    }).catch(err => toast(err.message || 'Lỗi kết nối khi đổi vai trò'));
    return;
  }

  // Admin: Xóa đơn hàng
  if ((el = q('del-order'))) {
    e.stopPropagation();
    const id = +el.dataset.delOrder;
    const o = S.orders.find(x => x.id === id);
    if (!o) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn đơn hàng ${o.label} (khách: ${o.customer || '—'})? Thao tác này không thể hoàn tác.`)) return;
    api('/api/orders/' + id, 'DELETE').then(res => {
      if (res && res.ok) {
        S.orders = S.orders.filter(x => x.id !== id);
        S.selected.delete(id);
        if (S.open === id) {
          S.open = null;
          $('#modal').classList.remove('on');
        }
        toast(`Đã xóa vĩnh viễn đơn hàng ${o.label}`);
        render();
      } else {
        toast(res?.error || 'Không thể xóa đơn hàng');
      }
    }).catch(err => toast(err.message || 'Lỗi kết nối khi xóa đơn'));
    return;
  }
  if (q('prep-all')) {
    S.selected.clear();
    return preserveScroll(render);
  }
  if ((el = q('batch-fillmix'))) {
    const key = el.dataset.batchFillmix;
    const inp = document.querySelector(`.batch-lot-input[data-group-key="${key}"]`);
    if (inp) {
      api('/api/mix-lot').then(res => {
        const lots = res?.lots || {};
        const parts = [];
        FRUIT_8_KEYS.forEach(f => {
          if (lots[f.id]) parts.push(`${f.short}: ${lots[f.id]}`);
        });
        const str = parts.join(', ');
        if (str) {
          inp.value = str;
          toast('Đã điền mã lô MIX hôm nay');
        } else {
          toast('Chưa có mã lô MIX hôm nay, hãy bấm nút "Lô MIX" để nhập');
        }
      });
    }
    return;
  }
  if ((el = q('batch-setlot'))) {
    const key = el.dataset.batchSetlot;
    const inp = document.querySelector(`.batch-lot-input[data-group-key="${key}"]`);
    if (inp) {
      inp.value = el.dataset.val;
      inp.focus();
    }
    return;
  }
  if (q('batch-apply')) {
    const inputs = document.querySelectorAll('.batch-lot-input');
    const groupLotMap = new Map();
    inputs.forEach(inp => {
      const val = inp.value.trim();
      if (val) groupLotMap.set(inp.dataset.groupKey, val);
    });

    if (groupLotMap.size === 0) {
      toast('Chưa nhập mã lô nào để áp dụng');
      return;
    }

    const updates = [];
    let updatedCount = 0;
    for (const g of currentBatchGroups) {
      const newLot = groupLotMap.get(g.key);
      if (!newLot) continue;
      if (g.sku) addLotHistory(g.sku, newLot);
      for (const it of g.items) {
        updates.push({ id: it.itemId, lot: newLot });
        for (const o of S.orders) {
          const found = o.items.find(i => i.id === it.itemId);
          if (found) {
            found.lot = newLot;
            updatedCount++;
          }
        }
      }
    }

    return act(async () => {
      await api('/api/items/batch-lot', 'POST', { updates });
      toast(`Đã cập nhật mã lô cho ${updatedCount} món`);
      closeBatchModal();
      S.selected.clear();
    }, { localOnly: true });
  }

  // Quản lý bấm nhắc nhở đơn
  if ((el = q('remind'))) {
    e.stopPropagation();
    const id = +el.dataset.remind;
    const o = S.orders.find(x => x.id === id);
    if (!o) return;
    return act(async () => {
      const res = await api('/api/orders/' + id + '/remind', 'POST');
      toast(res.message ? `Đã nhắc nhở: ${res.message}` : 'Đã gửi nhắc nhở');
    }, { localOnly: true });
  }

  if ((el = q('star'))) {
    e.stopPropagation();
    const o = S.orders.find(x => x.id == el.dataset.star);
    if (!o) return;
    const next = o.priority ? 0 : 1;
    o.priority = next;
    return act(async () => {
      await api('/api/orders/' + o.id, 'PATCH', {priority: next});
      toast(next ? 'Đã đánh ưu tiên' : 'Đã bỏ ưu tiên');
    }, {localOnly: true});
  }
  if ((el = q('chk'))) {
    const id = +el.dataset.chk, v = +el.dataset.v;
    for (const o of S.orders) {
      const it = o.items.find(i => i.id === id);
      if (it) {
        it.done = v;
        break;
      }
    }
    renderModal();
    return act(() => api('/api/items/' + id, 'PATCH', {done: v}), {localOnly: true});
  }
  if ((el = q('setlot'))) {
    const inp = document.querySelector(`[data-lot="${el.dataset.setlot}"]`);
    if (inp) {
      inp.value = el.dataset.val;
      const sku = inp.dataset.sku || '';
      return setLot(el.dataset.setlot, el.dataset.val, sku).then(() => renderModal());
    }
  }
  if ((el = q('all'))) {
    const o = S.orders.find(x => x.id == el.dataset.all);
    if (!o) return;
    const allDone = o.items.length > 0 && o.items.every(i => i.done);
    if (!allDone) {
      toast('Phải tick hoàn thành tất cả các món mới được hoàn tất đơn');
      return;
    }
    const prev = {status: o.status, done_at: o.done_at, confirmed_by: o.confirmed_by, confirmed_by_name: o.confirmed_by_name};
    o.status = 'done';
    o.done_at = Date.now();
    if (S.user) {
      o.confirmed_by = S.user.id;
      o.confirmed_by_name = S.user.display_name;
    }
    S.open = null;
    if (history.state && history.state.m) history.back();
    return act(async () => {
      try {
        await api('/api/orders/' + o.id, 'PATCH', {status: 'done'});
      } catch (err) {
        o.status = prev.status; o.done_at = prev.done_at;
        o.confirmed_by = prev.confirmed_by; o.confirmed_by_name = prev.confirmed_by_name;
        throw err;
      }
      toast('Đã hoàn tất đơn ' + o.label + (o.confirmed_by_name ? ` (${o.confirmed_by_name})` : ''));
    });
  }
  if (q('close') || t.id === 'modal') return closeOrder();
  if ((el = t.closest('.card'))) openOrder(+el.dataset.id);
});

document.addEventListener('change', e => {
  if (e.target.dataset.lot) {
    const sku = e.target.dataset.sku || '';
    setLot(e.target.dataset.lot, e.target.value.trim(), sku).then(() => renderModal());
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.lot) e.target.blur();
});

document.addEventListener('input', e => {
  if (e.target.classList && e.target.classList.contains('mix-input')) {
    updateMixPreview();
  }
});

let qTimer;
$('#q').addEventListener('input', e => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    S.q = e.target.value;
    preserveScroll(render);
  }, 180);
});

// Logout
$('#btn-logout')?.addEventListener('click', async () => {
  try { await api('/api/auth/logout', 'POST'); } catch {}
  try { localStorage.removeItem('tc_token'); } catch {}
  window.location.href = '/login';
});

// Xin quyền thông báo khi người dùng tương tác lần đầu
document.addEventListener('click', () => requestNotifyPermission(), { once: true });
// Một số trình duyệt load voice bất đồng bộ
if ('speechSynthesis' in window) {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

// Khởi động và kiểm tra đăng nhập
async function init() {
  try {
    const me = await api('/api/auth/me');
    if (me && me.ok && me.user) {
      S.user = me.user;
      $('#user-name').textContent = S.user.display_name;
      const b = $('#user-badge');
      if (S.user.role === 'admin') {
        b.textContent = 'Admin';
        b.className = 'user-badge admin';
      } else if (S.user.role === 'manager') {
        b.textContent = 'Quản lý';
        b.className = 'user-badge manager';
      } else {
        b.textContent = 'Đóng hàng';
        b.className = 'user-badge';
      }
      $('#user-pill').style.display = 'inline-flex';
      const btnUsers = $('#btn-users');
      if (btnUsers) btnUsers.style.display = S.user.role === 'admin' ? 'inline-flex' : 'none';
    } else if (!DEMO) {
      window.location.href = '/login';
      return;
    }
  } catch (err) {
    if (!DEMO) {
      window.location.href = '/login';
      return;
    }
  }

  await load();

  // Định kỳ nạp dữ liệu và kiểm tra nhắc nhở
  setInterval(() => {
    if (document.activeElement?.tagName !== 'INPUT' && !DEMO && !S.open) {
      load(true).catch(() => {});
    }
    if (!DEMO && S.user) {
      checkNotifications().catch(() => {});
    }
  }, 8000);
}

init();
