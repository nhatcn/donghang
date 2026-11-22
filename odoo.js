import fs from 'node:fs';
import xmlrpc from 'xmlrpc';
import { db, kvGet, kvSet, createOrder, syncLines } from './db.js';

// Tự nạp .env nếu có
if (typeof process.loadEnvFile === 'function' && fs.existsSync('.env')) {
  try { process.loadEnvFile('.env'); } catch {}
}

export function getOdooConfig() {
  const url = (process.env.ODOO_URL || '').replace(/\/+$/, '').replace(/\/(odoo|web)$/, '');
  const odooDb = process.env.ODOO_DB || '';
  const user = process.env.ODOO_USER || '';
  const apiKey = process.env.ODOO_API_KEY || '';
  const on = !!(url && odooDb && user && apiKey);
  const states = (process.env.ODOO_STATES || 'draft,sent').split(',').map(s => s.trim());
  const extra = process.env.ODOO_FILTER ? JSON.parse(process.env.ODOO_FILTER) : [];
  const pollSec = Number(process.env.ODOO_POLL_SEC) || 300;
  const backfillDays = process.env.ODOO_BACKFILL_DAYS === undefined ? 7 : Number(process.env.ODOO_BACKFILL_DAYS);
  return { url, db: odooDb, user, apiKey, on, states, extra, pollSec, backfillDays };
}

export const isOdooConfigured = () => getOdooConfig().on;
export const getOdooPollSec = () => getOdooConfig().pollSec;
export const ODOO_ON = isOdooConfigured();
export const POLL_SEC = getOdooPollSec();

const clients = {};
function client(p) {
  const cfg = getOdooConfig();
  if (!cfg.on) throw new Error('Chưa cấu hình Odoo (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY)');
  if (!clients[p]) {
    const u = new URL(cfg.url), secure = u.protocol === 'https:';
    const o = { host: u.hostname, port: Number(u.port) || (secure ? 443 : 80), path: p };
    clients[p] = secure ? xmlrpc.createSecureClient(o) : xmlrpc.createClient(o);
  }
  return clients[p];
}

const rpc = (p, method, params) => Promise.race([
  new Promise((ok, no) => client(p).methodCall(method, params, (e, v) => e ? no(e) : ok(v))),
  new Promise((_, no) => setTimeout(() => no(new Error('Odoo phản hồi quá lâu')), 30000)),
]);

let uid = null;
async function ox(model, method, args, kw = {}) {
  const cfg = getOdooConfig();
  if (!cfg.on) throw new Error('Chưa cấu hình Odoo');
  if (!uid) {
    uid = await rpc('/xmlrpc/2/common', 'authenticate', [cfg.db, cfg.user, cfg.apiKey, {}]);
    if (!uid) throw new Error('Sai database, tài khoản hoặc API key');
  }
  return rpc('/xmlrpc/2/object', 'execute_kw', [cfg.db, uid, cfg.apiKey, model, method, args, kw]);
}

const odooTime = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const fromOdoo = s => Date.parse(String(s).replace(' ', 'T') + 'Z') || Date.now();

const detectSource = o => {
  const getVal = v => (Array.isArray(v) ? v[1] : (typeof v === 'string' ? v : '')) || '';
  const seller = [getVal(o.user_id), o.salesperson].filter(Boolean).join(' ').toLowerCase();
  const creator = [getVal(o.create_uid), seller].filter(Boolean).join(' ').toLowerCase();
  if (creator.includes('odoobot')) return 'tiktok';
  const t = [getVal(o.partner_id), o.origin, o.client_order_ref, getVal(o.team_id)].filter(Boolean).join(' ').toLowerCase();
  if (t.includes('shopee')) return 'shopee';
  if (/tik\s?tok/.test(t)) return 'tiktok';
  return 'odoo';
};

async function readLines(orderId) {
  const ls = await ox('sale.order.line', 'search_read',
    [[['order_id', '=', orderId], ['display_type', '=', false]]],
    { fields: ['name', 'product_id', 'product_uom_qty'], order: 'sequence, id' });
  const pids = [...new Set(ls.map(l => l.product_id?.[0]).filter(Boolean))];
  const prods = pids.length ? await ox('product.product', 'read', [pids], { fields: ['default_code', 'display_name', 'type'] }) : [];
  const P = Object.fromEntries(prods.map(p => [p.id, p]));
  return ls
    .filter(l => P[l.product_id?.[0]]?.type !== 'service' && l.product_uom_qty > 0)
    .map(l => {
      const p = P[l.product_id?.[0]] || {};
      return {
        sku: p.default_code || '',
        name: (p.display_name || l.name).replace(/^\[[^\]]*\]\s*/, ''),
        qty: l.product_uom_qty
      };
    });
}

async function pollOdoo() {
  const cfg = getOdooConfig();
  if (!cfg.on) return;
  const started = Date.now();
  const threeMinAgo = started - 3 * 60 * 1000;
  const threeMinAgoStr = odooTime(threeMinAgo);
  const since = kvGet('odoo_since') || odooTime(started - cfg.backfillDays * 86400000);

  // Quy tắc: Chỉ kéo các đơn đã tạo sau 3 phút so với hiện tại
  const quotes = await ox('sale.order', 'search_read',
    [[['state', 'in', cfg.states], ['write_date', '>=', since], ['create_date', '<=', threeMinAgoStr], ...cfg.extra]],
    {
      fields: ['name', 'partner_id', 'client_order_ref', 'origin', 'team_id',
               'create_date', 'write_date', 'amount_total', 'currency_id',
               'user_id', 'create_uid', 'note'],
      order: 'id asc',
      limit: 300
    });

  for (const o of quotes) {
    // Đảm bảo đơn đã tạo sau 3 phút so với hiện tại
    const createdMs = fromOdoo(o.create_date);
    if (Date.now() - createdMs < 3 * 60 * 1000) continue;

    const ex = db.prepare("SELECT id, odoo_write FROM orders WHERE ext_id=? AND source IN ('odoo','shopee','tiktok')").get(String(o.id));
    if (ex && ex.odoo_write === o.write_date) continue;

    const lines = await readLines(o.id);
    if (!lines.length && !ex) continue;

    let phone = '', email = '', address = '';
    if (o.partner_id?.[0]) {
      try {
        const [p] = await ox('res.partner', 'read', [[o.partner_id[0]]],
          { fields: ['phone', 'mobile', 'email', 'street', 'street2', 'city', 'state_id'] });
        if (p) {
          phone = p.mobile || p.phone || '';
          email = p.email || '';
          address = [p.street, p.street2, p.city, p.state_id?.[1]].filter(Boolean).join(', ');
        }
      } catch {}
    }

    const customer = o.partner_id?.[1] || '';
    const note = o.note || o.client_order_ref || '';
    const salesperson = o.user_id?.[1] || '';
    const amount_total = o.amount_total || 0;
    const currency = o.currency_id?.[1] || '';

    if (!ex) {
      const id = createOrder({
        source: detectSource(o),
        ext_id: o.id,
        label: o.name,
        customer, phone, email, address, note, salesperson,
        amount_total, currency,
        created_at: fromOdoo(o.create_date),
        lines
      });
      db.prepare('UPDATE orders SET odoo_write=? WHERE id=?').run(o.write_date, id);
    } else {
      syncLines(ex.id, lines);
      db.prepare(`UPDATE orders SET odoo_write=?, customer=?, phone=?, email=?, address=?,
        note=?, salesperson=?, amount_total=?, currency=?, source=? WHERE id=?`)
        .run(o.write_date, customer, phone, email, address, note, salesperson,
             amount_total, currency, detectSource(o), ex.id);
    }
  }

  const open = db.prepare("SELECT id, ext_id FROM orders WHERE status IN ('open','done') AND source IN ('odoo','shopee','tiktok') AND created_at>?").all(Date.now() - 30 * 86400000);
  if (open.length) {
    const st = await ox('sale.order', 'search_read', [[['id', 'in', open.map(x => Number(x.ext_id))]]], { fields: ['state'] });
    const S = Object.fromEntries(st.map(x => [String(x.id), x.state]));
    for (const w of open) {
      const state = S[w.ext_id];
      if (state === 'cancel' || state === undefined) {
        db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(w.id);
      }
      // Đơn xác nhận ở Odoo (sale/done) KHÔNG tự hoàn tất: kho phải tự bấm "Hoàn tất đơn".
    }
  }
  kvSet('odoo_since', odooTime(started - 15 * 60000));
}

let polling = null;
export function syncOdoo() {
  if (!polling) polling = (async () => {
    try {
      await pollOdoo();
      kvSet('odoo_ok_at', Date.now());
      kvSet('odoo_error', '');
    } catch (e) {
      uid = null;
      kvSet('odoo_error', String(e.faultString || e.message || e).slice(0, 200));
      console.error('Odoo:', e.faultString || e.message);
    } finally { polling = null; }
  })();
  return polling;
}