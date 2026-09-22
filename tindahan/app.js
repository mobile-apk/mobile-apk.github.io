/* Tindahan POS — offline-first store app.
   All data lives on the phone (IndexedDB). No server, no account. */
'use strict';

/* =====================================================================
   Helpers
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => '#' + String(n).padStart(4, '0');
const money = n => {
  const r = round2(n || 0), a = Math.abs(r);
  return (r < 0 ? '-' : '') + '₱' + a.toLocaleString('en-PH', {
    minimumFractionDigits: Number.isInteger(a) ? 0 : 2, maximumFractionDigits: 2
  });
};
const DAY = 864e5;
const day0 = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtDT = t => new Date(t).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtD = t => new Date(t).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
const METHODS = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', utang: 'Utang' };
const EXPENSE_CATS = ['Stock purchase', 'Rent', 'Electricity', 'Water', 'Transportation', 'Salary', 'Load wallet top-up', 'Supplies', 'Other'];

const IC = {
  sell: '<path d="M6 7h14l-1.6 9H7.6z"/><path d="M6 7 5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  items: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  utang: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><path d="M17 5a3 3 0 010 6M19 14c1.8.8 3 2.6 3 5"/>',
  cash: '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><circle cx="17" cy="14.5" r="1.2"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  scan: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
};
const ic = (n, s = 24) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;

/* =====================================================================
   Storage (IndexedDB, with localStorage fallback)
   ===================================================================== */
let store;
function idbStore() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no idb'));
    const r = indexedDB.open('tindahan-pos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      resolve({
        get: k => new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }),
        set: (k, v) => new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); })
      });
    };
  });
}
const lsStore = {
  get: async k => { const v = localStorage.getItem('tp_' + k); return v == null ? undefined : JSON.parse(v); },
  set: async (k, v) => localStorage.setItem('tp_' + k, JSON.stringify(v))
};

const COLS = ['products', 'sales', 'customers', 'credits', 'cash', 'expenses'];
const DEFAULT_SETTINGS = { storeName: 'My Store', phone: '', footer: 'Salamat po! Balik kayo.', lowStock: 5, seq: 0, lastBackup: 0, qr: {}, logo: '', address: '', adminPin: '', printMode: 'system', paper: 58, autoPrint: false, printerName: '', printerId: '', drawer: false, drawerPin: 0 };
let D = { products: [], sales: [], customers: [], credits: [], cash: [], expenses: [], settings: { ...DEFAULT_SETTINGS } };

async function load() {
  for (const k of [...COLS, 'settings']) {
    const v = await store.get(k);
    if (v !== undefined) D[k] = k === 'settings' ? { ...DEFAULT_SETTINGS, ...v } : v;
  }
}
const save = (...keys) => Promise.all(keys.map(k => store.set(k, D[k]))).catch(() => toast('Could not save. Phone storage may be full.'));
const saveAll = () => save(...COLS, 'settings');

/* lookups */
const byId = id => D.products.find(p => p.id === id);
const cust = id => D.customers.find(c => c.id === id);
function balances() {
  const m = new Map();
  D.credits.forEach(c => m.set(c.customerId, (m.get(c.customerId) || 0) + (c.type === 'charge' ? c.amount : -c.amount)));
  return m;
}
const isLow = p => p.track && p.stock <= D.settings.lowStock;
const needsBackup = () => D.sales.length > 0 && Date.now() - (D.settings.lastBackup || 0) > 7 * DAY;

/* =====================================================================
   UI state
   ===================================================================== */
const S = { tab: 'sell', q: '', cat: 'All', cart: [], disc: 0, discType: 'amt', iq: '', lowOnly: false, uq: '', cashTab: 'drawer', period: 'today' };
const main = $('#main');

/* toast, beep */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400);
}
let actx;
function beep(f = 880, d = 0.07) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = f; g.gain.value = 0.05; o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + d);
  } catch { /* audio not available */ }
  navigator.vibrate?.(12);
}

/* =====================================================================
   Sheets (stacked bottom sheets that also respond to the Android back button)
   ===================================================================== */
const stack = [];
let sheetMode = false, skipPop = false;
const setBody = (w, h) => { $('.body', w).innerHTML = h; };
const setFooter = (w, h) => { $('footer', w).innerHTML = h; };
const setTitle = (w, t) => { $('h2', w).textContent = t; };

function openSheet(o = {}) {
  const w = document.createElement('div');
  w.className = 'sheet-wrap' + (o.cls ? ' ' + o.cls : '');
  w.innerHTML = `<div class="scrim" data-act="close"></div>
    <section class="sheet" role="dialog" aria-modal="true">
      <header><h2></h2><button class="iconbtn" data-act="close" aria-label="Close">${ic('x')}</button></header>
      <div class="body"></div><footer></footer>
    </section>`;
  w._acts = {}; w._in = {}; w._onClose = o.onClose;
  setTitle(w, o.title || '');
  if (o.html) setBody(w, o.html);
  if (o.footer) setFooter(w, o.footer);
  $('#sheets').appendChild(w);
  stack.push(w);
  if (!sheetMode) { history.pushState({ sheet: 1 }, ''); sheetMode = true; }
  return w;
}
function closeSheet() {
  const w = stack.pop(); if (!w) return;
  w.remove(); w._onClose && w._onClose();
  if (!stack.length && sheetMode) { sheetMode = false; skipPop = true; history.back(); }
}
addEventListener('popstate', () => {
  if (skipPop) { skipPop = false; return; }
  const w = stack.pop();
  if (w) {
    w.remove(); w._onClose && w._onClose();
    if (stack.length) history.pushState({ sheet: 1 }, ''); else sheetMode = false;
  }
});
function confirmBox(o, cb) {
  const w = openSheet({
    title: o.title, html: `<p>${esc(o.msg || '')}</p>`,
    footer: `<button class="btn ghost grow" data-act="close">Cancel</button><button class="btn ${o.danger ? 'danger' : 'primary'} grow" data-act="yes">${esc(o.ok || 'OK')}</button>`
  });
  w._acts.yes = () => { closeSheet(); cb(); };
}

/* generic "amount + note" sheet used by cash in/out, expenses, utang payments */
function openAmount(o) {
  const w = openSheet({ title: o.title });
  setBody(w, `
    <label class="lbl" for="a_amt">${esc(o.amountLabel || 'Amount (₱)')}</label>
    <input id="a_amt" class="in xl" inputmode="decimal" placeholder="0" value="${o.amount ?? ''}">
    ${o.select ? `<label class="lbl" for="a_sel">${esc(o.select.label)}</label>
      <select id="a_sel" class="in">${o.select.options.map(([v, l]) => `<option value="${esc(v)}"${v === o.select.value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}
    <label class="lbl" for="a_note">Note (optional)</label>
    <input id="a_note" class="in" value="${esc(o.note || '')}" autocomplete="off">
    ${o.check ? `<label class="check"><input type="checkbox" id="a_chk"${o.check.value ? ' checked' : ''}> ${esc(o.check.label)}</label>` : ''}`);
  setFooter(w, `${o.del ? '<button class="btn danger" data-act="del">Delete</button>' : ''}<button class="btn primary grow" data-act="ok">${esc(o.ok || 'Save')}</button>`);
  w._acts.ok = () => {
    const amt = num($('#a_amt', w).value);
    if (!(amt > 0)) return toast('Enter an amount');
    closeSheet();
    o.cb({ amount: round2(amt), note: $('#a_note', w).value.trim(), sel: o.select ? $('#a_sel', w).value : null, chk: o.check ? $('#a_chk', w).checked : null });
  };
  w._acts.del = () => o.del(); /* confirm sheet opens on top; caller closes this one */
  return w;
}

/* =====================================================================
   Global events
   ===================================================================== */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const w = el.closest('.sheet-wrap');
  const fn = (w && w._acts[el.dataset.act]) || A[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-in]'); if (!el) return;
  const w = el.closest('.sheet-wrap');
  const fn = (w && w._in[el.dataset.in]) || IN[el.dataset.in];
  fn && fn(el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) closeSheet();
  if (e.key === 'Enter' && e.target.id === 'q') { /* USB / Bluetooth scanners type the code then press Enter */
    const code = e.target.value.trim();
    const p = code && D.products.find(x => x.barcode && x.barcode === code);
    if (p) { addToCart(p); S.q = ''; e.target.value = ''; drawSellList(); }
  }
});

/* =====================================================================
   Shell: nav, render
   ===================================================================== */
const TABS = [['sell', 'Sell'], ['items', 'Items'], ['utang', 'Utang'], ['cash', 'Cash'], ['reports', 'Reports']];
$('#nav').innerHTML = TABS.map(([k, l]) => `<button data-act="tab" data-v="${k}">${ic(k)}<span>${l}</span></button>`).join('');

function render() {
  $('#title').textContent = D.settings.storeName || 'Tindahan POS';
  $('#gear').innerHTML = ic('gear') + (needsBackup() ? '<span class="dot"></span>' : '');
  $$('#nav button').forEach(b => b.setAttribute('aria-current', b.dataset.v === S.tab ? 'page' : 'false'));
  ({ sell: renderSell, items: renderItems, utang: renderUtang, cash: renderCash, reports: renderReports })[S.tab]();
  drawCartBar();
}
function setNet() {
  const n = $('#net'), on = navigator.onLine;
  n.textContent = on ? 'Online' : 'Offline mode'; n.classList.toggle('off', !on);
}
addEventListener('online', setNet); addEventListener('offline', setNet);

/* =====================================================================
   SELL
   ===================================================================== */
const matchQ = (p, q) => { q = q.trim().toLowerCase(); return !q || p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q); };
const totals = () => {
  const sub = round2(S.cart.reduce((a, l) => a + l.price * l.qty, 0));
  const d = round2(S.discType === 'pct' ? sub * Math.min(Math.max(S.disc, 0), 100) / 100 : Math.min(Math.max(S.disc, 0), sub));
  return { sub, d, total: round2(sub - d), count: S.cart.reduce((a, l) => a + l.qty, 0) };
};

function renderSell() {
  const cats = [...new Set(D.products.map(p => p.category).filter(Boolean))].sort();
  if (S.cat !== 'All' && !cats.includes(S.cat)) S.cat = 'All';
  main.innerHTML = `
    <div class="bar">
      <label class="search">${ic('search', 20)}<input id="q" class="in" type="search" placeholder="Search item or barcode" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search" data-in="sellq" aria-label="Search items"></label>
      <button class="sq" data-act="scanSell" aria-label="Scan barcode">${ic('scan')}</button>
      <button class="sq" data-act="customItem" aria-label="Custom amount">${ic('plus')}</button>
    </div>
    ${cats.length ? `<div class="chips">${['All', ...cats].map(c => `<button class="chip" aria-pressed="${S.cat === c}" data-act="cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    <div id="plist"></div>`;
  drawSellList();
}
function tile(p) {
  const q = (S.cart.find(l => l.key === p.id) || {}).qty || 0;
  return `<button class="tile${q ? ' in' : ''}" data-act="add" data-id="${p.id}">
    <span class="nm">${esc(p.name)}</span><span class="pr">${money(p.price)}</span>
    <span class="st${isLow(p) ? ' low' : ''}">${p.track ? (p.stock <= 0 ? 'Out of stock' : p.stock + ' left') : ''}</span>
    ${q ? `<span class="q">${q}</span>` : ''}</button>`;
}
function drawSellList() {
  const host = $('#plist'); if (!host) return;
  if (!D.products.length) {
    host.innerHTML = `<div class="empty"><h2>No items yet</h2><p>Add what you sell so you can ring it up in one tap.</p>
      <button class="btn primary" data-act="newProduct">Add first item</button>
      <button class="btn ghost" data-act="sample">Load sample items</button>
      <p class="note">You can also use the + button above to sell a custom amount without adding an item.</p></div>`;
    return;
  }
  const list = D.products.filter(p => (S.cat === 'All' || p.category === S.cat) && matchQ(p, S.q)).sort((a, b) => a.name.localeCompare(b.name));
  host.innerHTML = list.length
    ? `<div class="grid">${list.map(tile).join('')}</div>`
    : `<div class="empty"><p>No item matches “${esc(S.q)}”.</p><button class="btn ghost" data-act="customItem">Sell as custom amount</button></div>`;
}
function addToCart(p) {
  const l = S.cart.find(x => x.key === p.id);
  if (l) l.qty++; else S.cart.push({ key: p.id, pid: p.id, name: p.name, price: p.price, cost: p.cost || 0, qty: 1 });
  const qty = (S.cart.find(x => x.key === p.id)).qty;
  if (p.track && qty > p.stock) toast(p.stock > 0 ? `Only ${p.stock} left in stock` : `${p.name} is out of stock`);
  beep(); drawSellList(); drawCartBar();
}
function drawCartBar() {
  const bar = $('#cartbar');
  if (S.tab !== 'sell' || !S.cart.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  const t = totals(); bar.hidden = false;
  bar.innerHTML = `<button class="tag" data-act="openCart"><span>${t.count} item${t.count > 1 ? 's' : ''}</span><span class="go">View cart</span><span class="amt">${money(t.total)}</span></button>`;
}

/* ---- cart → payment → receipt, all inside one sheet ---- */
function openCart() {
  if (!S.cart.length) return;
  const ctx = { step: 'cart', method: 'cash', tender: '', ref: '', cust: '' };
  const w = openSheet({ title: 'Cart', onClose: () => { drawCartBar(); drawSellList(); } });
  const draw = () => (ctx.step === 'cart' ? drawCart : drawPay)(w, ctx, draw);

  w._acts.inc = el => { S.cart.find(l => l.key === el.dataset.k).qty++; draw(); };
  w._acts.dec = el => {
    const l = S.cart.find(x => x.key === el.dataset.k);
    if (--l.qty <= 0) S.cart = S.cart.filter(x => x !== l);
    draw();
  };
  w._acts.dtype = el => { S.discType = el.dataset.v; draw(); };
  w._acts.clearCart = () => { S.cart = []; S.disc = 0; closeSheet(); };
  w._acts.toPay = () => { ctx.step = 'pay'; ctx.tender = ''; draw(); };
  w._acts.back = () => { ctx.step = 'cart'; draw(); };
  w._acts.method = el => { ctx.method = el.dataset.v; draw(); };
  w._acts.quick = el => { ctx.tender = el.dataset.v; draw(); };
  w._acts.newCust = () => openCustomerForm(null, c => { ctx.cust = c.id; draw(); });
  w._acts.confirm = () => finishSale(w, ctx);
  w._acts.qrFull = () => openQrFull(ctx.method, totals().total);
  w._acts.addQr = () => pickQr(ctx.method, draw);

  w._in.disc = el => {
    S.disc = num(el.value); const t = totals();
    $('#s_sub', w).textContent = money(t.sub); $('#s_d', w).textContent = '-' + money(t.d);
    $('#s_t', w).textContent = money(t.total); $('#chg', w).textContent = 'Charge ' + money(t.total);
  };
  w._in.tender = el => { ctx.tender = el.value; updPay(w, ctx); };
  w._in.ref = el => { ctx.ref = el.value; };
  w._in.cust = el => { ctx.cust = el.value; updPay(w, ctx); };
  draw();
}
function drawCart(w) {
  if (!S.cart.length) { closeSheet(); return; }
  setTitle(w, 'Cart');
  const t = totals();
  setBody(w, `
    <ul class="lines">${S.cart.map(l => `<li>
      <div class="ln"><b>${esc(l.name)}</b><small>${money(l.price)} each</small></div>
      <div class="step"><button data-act="dec" data-k="${l.key}" aria-label="One less">${ic('minus', 18)}</button><output>${l.qty}</output><button data-act="inc" data-k="${l.key}" aria-label="One more">${ic('plus', 18)}</button></div>
      <div class="lt">${money(l.price * l.qty)}</div></li>`).join('')}</ul>
    <div class="disc"><label for="disc">Discount</label>
      <input id="disc" class="in" inputmode="decimal" placeholder="0" value="${S.disc || ''}" data-in="disc">
      <div class="seg sm"><button data-act="dtype" data-v="amt" aria-pressed="${S.discType === 'amt'}">₱</button><button data-act="dtype" data-v="pct" aria-pressed="${S.discType === 'pct'}">%</button></div></div>
    <dl class="sum"><div><dt>Subtotal</dt><dd id="s_sub">${money(t.sub)}</dd></div>
      <div><dt>Discount</dt><dd id="s_d">-${money(t.d)}</dd></div>
      <div class="big"><dt>Total</dt><dd id="s_t">${money(t.total)}</dd></div></dl>`);
  setFooter(w, `<button class="btn ghost" data-act="clearCart">Clear</button><button class="btn sun grow" id="chg" data-act="toPay">Charge ${money(t.total)}</button>`);
}
function cashSuggestions(total) {
  const c50 = Math.ceil(total / 50) * 50, c100 = Math.ceil(total / 100) * 100;
  const s = new Set([round2(total), c50, c100, ...[200, 500, 1000].filter(v => v >= total)]);
  return [...s].filter(v => v >= total).sort((a, b) => a - b).slice(0, 5);
}
function drawPay(w, ctx) {
  const t = totals(); setTitle(w, 'Payment ' + money(t.total));
  let inner = '';
  if (ctx.method === 'cash') {
    inner = `<label class="lbl" for="tender">Cash received</label>
      <input id="tender" class="in xl" inputmode="decimal" placeholder="${t.total}" value="${esc(ctx.tender)}" data-in="tender" autocomplete="off">
      <div class="chips wrap" style="margin-top:10px">${cashSuggestions(t.total).map(v => `<button class="chip" data-act="quick" data-v="${v}">${v === t.total ? 'Exact' : money(v)}</button>`).join('')}</div>
      <div class="change" id="chgbox"></div>`;
  } else if (ctx.method === 'utang') {
    const b = balances();
    inner = `<label class="lbl" for="cust">Who is taking it on utang?</label>
      <select id="cust" class="in" data-in="cust"><option value="">Choose customer…</option>
        ${D.customers.slice().sort((a, c) => a.name.localeCompare(c.name)).map(c => `<option value="${c.id}"${c.id === ctx.cust ? ' selected' : ''}>${esc(c.name)} (owes ${money(b.get(c.id) || 0)})</option>`).join('')}</select>
      <button class="btn ghost block" style="margin-top:10px" data-act="newCust">${ic('plus', 18)} New customer</button>`;
  } else {
    const q = (D.settings.qr || {})[ctx.method];
    const qrBlock = ctx.method === 'gcash' || ctx.method === 'maya'
      ? (q ? `<div class="qrcard"><small>Ask the customer to scan and pay</small><b>${money(t.total)}</b>
          <button class="qrimg" data-act="qrFull" aria-label="Enlarge QR code"><img src="${q}" alt="${METHODS[ctx.method]} QR code"></button>
          <small>Tap the code to enlarge. The customer types the amount in their app.</small></div>`
        : `<div class="qrcard"><p style="margin:0 0 10px">No ${METHODS[ctx.method]} QR saved yet.</p><button class="btn ghost" data-act="addQr">Add my ${METHODS[ctx.method]} QR</button></div>`)
      : '';
    inner = qrBlock + `<label class="lbl" for="ref">Reference number (optional)</label>
      <input id="ref" class="in" value="${esc(ctx.ref)}" data-in="ref" autocomplete="off">
      <p class="note">Check that the payment arrived in your ${METHODS[ctx.method]} app before confirming.</p>`;
  }
  setBody(w, `<div class="seg pay">${Object.entries(METHODS).map(([k, l]) => `<button data-act="method" data-v="${k}" aria-pressed="${ctx.method === k}">${l}</button>`).join('')}</div>${inner}`);
  setFooter(w, `<button class="btn ghost" data-act="back">Back</button><button class="btn sun grow" id="conf" data-act="confirm">Confirm ${money(t.total)}</button>`);
  updPay(w, ctx);
}
function updPay(w, ctx) {
  const t = totals(); let ok = true;
  if (ctx.method === 'cash') {
    const tend = ctx.tender === '' ? t.total : num(ctx.tender), diff = round2(tend - t.total), box = $('#chgbox', w);
    ok = diff >= 0;
    if (box) {
      box.className = 'change ' + (ok ? 'ok' : 'bad');
      box.innerHTML = ok ? `<small>Change</small><b>${money(diff)}</b>` : `<small>Short by</small><b>${money(-diff)}</b>`;
    }
  }
  if (ctx.method === 'utang') ok = !!ctx.cust;
  const btn = $('#conf', w); if (btn) btn.disabled = !ok;
}
function finishSale(w, ctx) {
  const t = totals(); if (!S.cart.length) return;
  const tend = ctx.method === 'cash' ? (ctx.tender === '' ? t.total : num(ctx.tender)) : t.total;
  const s = {
    id: uid(), no: ++D.settings.seq, ts: Date.now(),
    items: S.cart.map(l => ({ pid: l.pid, name: l.name, price: l.price, cost: l.cost, qty: l.qty })),
    subtotal: t.sub, discount: t.d, total: t.total, method: ctx.method,
    tendered: round2(tend), change: ctx.method === 'cash' ? round2(tend - t.total) : 0,
    customerId: ctx.method === 'utang' ? ctx.cust : '', ref: ctx.method === 'gcash' || ctx.method === 'maya' || ctx.method === 'card' ? ctx.ref.trim() : ''
  };
  D.sales.push(s);
  s.items.forEach(i => { const p = byId(i.pid); if (p && p.track) p.stock -= i.qty; });
  if (s.method === 'utang') D.credits.push({ id: uid(), ts: s.ts, customerId: s.customerId, type: 'charge', amount: s.total, saleId: s.id, note: 'Sale ' + pad(s.no) });
  save('sales', 'products', 'credits', 'settings');
  S.cart = []; S.disc = 0; ctx.step = 'receipt';
  drawReceipt(w, s, true);
  beep(660, 0.12);
  if (D.settings.autoPrint) { /* the print dialog blocks the page, so let the receipt paint first */
    if ((D.settings.printMode || 'system') === 'system') setTimeout(() => printSale(s, true), 250); else printSale(s, true);
  } else if (s.method === 'cash' && drawerReady()) openDrawer();
}


/* ---- payment QR codes (your own GCash / Maya QR, saved on the phone) ---- */
function loadImage(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); res(im); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); };
    im.src = u;
  });
}
async function qrToDataURL(file) {
  const im = await loadImage(file), max = 900, s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
function pickQr(kind, done) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    if (!inp.files[0]) return;
    try {
      const url = await qrToDataURL(inp.files[0]);
      D.settings.qr = { ...(D.settings.qr || {}), [kind]: url };
      save('settings'); toast(METHODS[kind] + ' QR saved'); done && done();
    } catch { toast('Could not read that image'); }
  };
  inp.click();
}
function openQrFull(kind, total) {
  const q = (D.settings.qr || {})[kind]; if (!q) return;
  const w = openSheet({ title: METHODS[kind] + ' QR', cls: 'qrfull' });
  setBody(w, `<div class="qrcard"><small>Scan to pay</small><b>${money(total)}</b><div class="qrimg"><img src="${q}" alt="${METHODS[kind]} QR code"></div></div>`);
}


/* ---- store logo (shown on screen receipts and the system print/PDF option; thermal printers stay text-only) ---- */
async function logoToDataURL(file) {
  const im = await loadImage(file), max = 300, s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
function pickLogo(done) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    if (!inp.files[0]) return;
    try { D.settings.logo = await logoToDataURL(inp.files[0]); save('settings'); toast('Logo saved'); done && done(); }
    catch { toast('Could not read that image'); }
  };
  inp.click();
}

/* ---- admin PIN, so a cashier cannot void a sale or erase data without the owner ---- */
async function pinHash(pin) {
  const buf = new TextEncoder().encode('tindahan-pos:' + pin);
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const pinSupported = () => !!(window.crypto && crypto.subtle);
/* Gate a sensitive action behind the admin PIN. Runs cb() straight away if no PIN has been set. */
function requirePin(title, cb) {
  if (!D.settings.adminPin) return cb();
  const w = openSheet({ title });
  setBody(w, `<p class="note" style="margin-top:0">Ask the store owner for the admin PIN.</p>
    <input id="pn" class="in xl" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••" style="text-align:center;letter-spacing:8px">
    <p id="pnErr" class="note neg" style="min-height:1.2em"></p>`);
  setFooter(w, `<button class="btn ghost grow" data-act="close">Cancel</button><button class="btn primary grow" data-act="go">Confirm</button>`);
  const field = $('#pn', w); setTimeout(() => field.focus(), 50);
  const submit = async () => {
    const v = field.value.trim();
    if (!v) return;
    if ((await pinHash(v)) === D.settings.adminPin) { closeSheet(); cb(); }
    else { $('#pnErr', w).textContent = 'Incorrect PIN. Try again.'; field.value = ''; field.focus(); }
  };
  w._acts.go = submit;
  field.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}
/* Set, change or remove the PIN. Changing or removing always re-asks the current PIN first. */
function openPinSetup(mode) {
  const w = openSheet({ title: mode === 'remove' ? 'Remove admin PIN' : mode === 'change' ? 'Change admin PIN' : 'Set admin PIN' });
  setBody(w, `
    ${D.settings.adminPin ? `<label class="lbl" for="p_cur">Current PIN</label><input id="p_cur" class="in" type="password" inputmode="numeric" autocomplete="off" maxlength="8">` : ''}
    ${mode !== 'remove' ? `<label class="lbl" for="p_new">New PIN (4 to 8 digits)</label><input id="p_new" class="in" type="password" inputmode="numeric" autocomplete="off" maxlength="8">
    <label class="lbl" for="p_new2">Confirm new PIN</label><input id="p_new2" class="in" type="password" inputmode="numeric" autocomplete="off" maxlength="8">` : ''}
    <p class="note">${mode === 'remove' ? 'Anyone will be able to void sales and erase data once this is removed.' : 'You will need this PIN yourself to void a sale, erase data, or change this PIN again. Choose something the cashier does not know.'}</p>
    <p id="pnErr2" class="note neg" style="min-height:1.2em"></p>`);
  setFooter(w, `<button class="btn ghost grow" data-act="close">Cancel</button><button class="btn ${mode === 'remove' ? 'danger' : 'primary'} grow" data-act="go">${mode === 'remove' ? 'Remove PIN' : 'Save PIN'}</button>`);
  w._acts.go = async () => {
    const err = m => { $('#pnErr2', w).textContent = m; };
    if (D.settings.adminPin) {
      const cur = $('#p_cur', w).value.trim();
      if (!cur || (await pinHash(cur)) !== D.settings.adminPin) return err('Current PIN is incorrect.');
    }
    if (mode === 'remove') { D.settings.adminPin = ''; save('settings'); closeSheet(); toast('PIN removed'); render(); return; }
    const p1 = $('#p_new', w).value.trim(), p2 = $('#p_new2', w).value.trim();
    if (!/^\d{4,8}$/.test(p1)) return err('Use 4 to 8 digits.');
    if (p1 !== p2) return err('PINs do not match.');
    D.settings.adminPin = await pinHash(p1); save('settings'); closeSheet(); toast('PIN saved'); render();
  };
}

/* custom amount (e-load, bills, anything not in Items) */
function customItem() {
  const w = openSheet({ title: 'Custom amount' });
  setBody(w, `
    <div class="chips" style="margin-top:6px"><button class="chip" data-act="preset" data-v="Load">Load</button><button class="chip" data-act="preset" data-v="Bills payment">Bills payment</button><button class="chip" data-act="preset" data-v="Other">Other</button></div>
    <label class="lbl" for="c_name">What is it?</label><input id="c_name" class="in" value="Custom item" autocomplete="off">
    <div class="two"><div><label class="lbl" for="c_price">Customer pays (₱)</label><input id="c_price" class="in" inputmode="decimal" placeholder="0"></div>
    <div><label class="lbl" for="c_cost">You pay (₱)</label><input id="c_cost" class="in" inputmode="decimal" placeholder="0"></div></div>
    <p class="note">“You pay” is what it cost you, like the load you spent. It is used to work out your profit. Leave it blank if it is all profit.</p>`);
  setFooter(w, `<button class="btn sun grow" data-act="ok">Add to cart</button>`);
  w._acts.preset = el => { $('#c_name', w).value = el.dataset.v; };
  w._acts.ok = () => {
    const price = num($('#c_price', w).value);
    if (!(price > 0)) return toast('Enter the amount');
    const key = 'c' + uid();
    S.cart.push({ key, pid: null, name: $('#c_name', w).value.trim() || 'Custom item', price: round2(price), cost: round2(num($('#c_cost', w).value)), qty: 1 });
    closeSheet(); beep(); drawSellList(); drawCartBar();
  };
}


/* =====================================================================
   PRINTING
   system : Android print dialog (any printer the phone can print to)
   bt     : Bluetooth Low Energy thermal printer, ESC/POS, via Web Bluetooth
   rawbt  : hands the receipt to the free RawBT app (classic Bluetooth printers)
   ===================================================================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ascii = t => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/₱/g, 'P').replace(/×/g, 'x')
  .replace(/[\u00a0\u2009\u202f]/g, ' ').replace(/[^\x20-\x7E]/g, '?');
function wrapText(t, W) {
  const out = []; let cur = '';
  for (const word of t.split(/\s+/)) {
    if (!word) continue;
    let w = word;
    while (w.length > W) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, W)); w = w.slice(W); }
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= W) cur += ' ' + w; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}
/* Turns a sale into fixed-width lines: [{t: 'text', b: bold?}] */
function rcptLines(s, W = 32) {
  const L = [], add = (t, b = false) => L.push({ t, b });
  const ctr = (t, b) => wrapText(ascii(t), W).forEach(x => add(' '.repeat(Math.floor((W - x.length) / 2)) + x, b));
  const two = (left, right, b) => {
    left = ascii(left); right = ascii(right);
    if (left.length + right.length + 1 <= W) return add(left + ' '.repeat(W - left.length - right.length) + right, b);
    const parts = wrapText(left, W), last = parts.pop() || '';
    parts.forEach(x => add(x, b));
    if (last.length + right.length + 1 <= W) add(last + ' '.repeat(W - last.length - right.length) + right, b);
    else { add(last, b); add(' '.repeat(Math.max(0, W - right.length)) + right, b); }
  };
  const rule = () => add('-'.repeat(W));
  ctr(D.settings.storeName || 'Store', true);
  if (D.settings.address) ctr(D.settings.address);
  if (D.settings.phone) ctr(D.settings.phone);
  ctr(pad(s.no) + '  ' + fmtDT(s.ts));
  rule();
  s.items.forEach(i => two(`${i.qty} x ${i.name}`, money(i.price * i.qty)));
  rule();
  if (s.discount) { two('Subtotal', money(s.subtotal)); two('Discount', '-' + money(s.discount)); }
  two('TOTAL', money(s.total), true);
  two('Paid by', METHODS[s.method]);
  if (s.method === 'cash') { two('Cash', money(s.tendered)); two('Change', money(s.change)); }
  if (s.method === 'utang') two('Utang', cust(s.customerId)?.name || '');
  if (s.ref) two('Ref', s.ref);
  if (s.voided) ctr('*** VOIDED ***', true);
  if (D.settings.footer) { add(''); ctr(D.settings.footer); }
  return L;
}
function escpos(lines, kick = false) {
  const out = [0x1B, 0x40]; let bold = false;
  if (kick) out.push(...drawerKick()); /* open the cash drawer first, then print */
  lines.forEach(l => {
    if (l.b !== bold) { out.push(0x1B, 0x45, l.b ? 1 : 0); bold = l.b; }
    for (const ch of ascii(l.t)) out.push(ch.charCodeAt(0));
    out.push(0x0A);
  });
  if (bold) out.push(0x1B, 0x45, 0);
  out.push(0x1B, 0x64, 4); /* feed 4 lines so the text clears the tear bar */
  return Uint8Array.from(out);
}
const drawerKick = () => [0x1B, 0x70, D.settings.drawerPin === 1 ? 1 : 0, 0x19, 0xFA]; /* ESC p pin, 50 ms on, 500 ms off */
const rawbtHref = bytes => {
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return 'intent:base64,' + btoa(bin) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
};

const BT = { dev: null, chr: null };
const BT_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb', '0000ae30-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];
async function btConnect(forcePick) {
  if (!navigator.bluetooth) throw Object.assign(new Error('nobt'), { code: 'nobt' });
  if (forcePick) { BT.dev = null; BT.chr = null; }
  if (!BT.dev && !forcePick && navigator.bluetooth.getDevices) {
    try { const l = await navigator.bluetooth.getDevices(); BT.dev = l.find(d => d.id === D.settings.printerId) || null; } catch { /* not supported */ }
  }
  if (!BT.dev) {
    BT.dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
    D.settings.printerName = BT.dev.name || 'Bluetooth printer'; D.settings.printerId = BT.dev.id; save('settings');
  }
  BT.dev.addEventListener('gattserverdisconnected', () => { BT.chr = null; }, { once: true });
  if (!BT.chr || !BT.dev.gatt.connected) {
    BT.chr = null;
    const srv = await BT.dev.gatt.connect();
    for (const sv of await srv.getPrimaryServices()) {
      const c = (await sv.getCharacteristics()).find(x => x.properties.write || x.properties.writeWithoutResponse);
      if (c) { BT.chr = c; break; }
    }
    if (!BT.chr) throw Object.assign(new Error('nowrite'), { code: 'nowrite' });
  }
  return BT.chr;
}
async function btSend(bytes) {
  const c = await btConnect(false);
  for (let i = 0; i < bytes.length; i += 20) {
    const chunk = bytes.slice(i, i + 20);
    if (c.properties.writeWithoutResponse) await c.writeValueWithoutResponse(chunk); else await c.writeValue(chunk);
    await sleep(12);
  }
}
function systemPrint(lines) {
  const area = $('#printarea');
  area.innerHTML = (D.settings.logo ? `<img src="${D.settings.logo}" alt="">` : '') + `<pre></pre>`;
  $('pre', area).textContent = lines.map(l => l.t).join('\n');
  window.print();
}
async function sendToPrinter(bytes, msg) {
  const mode = D.settings.printMode || 'system';
  try {
    if (mode === 'rawbt') { location.href = rawbtHref(bytes); return; }
    if (msg) toast(msg);
    await btSend(bytes);
  } catch (e) {
    if (e && e.name === 'NotFoundError') return; /* chooser closed without picking a printer */
    toast(e && e.code === 'nobt' ? 'Bluetooth printing is not available here. Try the RawBT option.'
      : e && e.code === 'nowrite' ? 'Connected, but this printer is not compatible. Try the RawBT option.'
      : 'Could not reach the printer. Check it is on and near the phone, then try again.');
  }
}
/* auto = called right after Confirm; that is the only time the cash drawer is kicked along with the receipt */
async function printSale(s, auto) {
  const mode = D.settings.printMode || 'system', lines = rcptLines(s, D.settings.paper === 80 ? 48 : 32);
  if (mode === 'system') { systemPrint(lines); return; }
  const kick = !!(auto && D.settings.drawer && s.method === 'cash');
  await sendToPrinter(escpos(lines, kick), 'Printing…');
}
const drawerReady = () => !!D.settings.drawer && (D.settings.printMode || 'system') !== 'system';
function openDrawer() {
  if ((D.settings.printMode || 'system') === 'system') return toast('Cash drawers need the Bluetooth printer or RawBT option in Settings.');
  return sendToPrinter(Uint8Array.from([0x1B, 0x40, ...drawerKick()]), 'Opening drawer…');
}
const sampleSale = () => ({ no: 1, ts: Date.now(), items: [{ qty: 2, name: 'Sample item', price: 10 }, { qty: 1, name: 'Another item with a long name', price: 25 }], subtotal: 45, discount: 0, total: 45, method: 'cash', tendered: 50, change: 5 });

/* ---- receipts ---- */
function receiptText(s) {
  const L = [D.settings.storeName || 'Store'];
  if (D.settings.address) L.push(D.settings.address);
  if (D.settings.phone) L.push(D.settings.phone);
  L.push(pad(s.no) + '  ' + fmtDT(s.ts), '--------------------------------');
  s.items.forEach(i => L.push(`${i.qty} x ${i.name}  ${money(i.price * i.qty)}`));
  L.push('--------------------------------');
  if (s.discount) L.push('Subtotal ' + money(s.subtotal), 'Discount -' + money(s.discount));
  L.push('TOTAL ' + money(s.total), 'Paid by ' + METHODS[s.method]);
  if (s.method === 'cash') L.push('Cash ' + money(s.tendered), 'Change ' + money(s.change));
  if (s.method === 'utang') L.push('On utang: ' + (cust(s.customerId)?.name || ''));
  if (s.voided) L.push('*** VOIDED ***');
  if (D.settings.footer) L.push('', D.settings.footer);
  return L.join('\n');
}
function drawReceipt(w, s, fresh) {
  setTitle(w, fresh ? 'Sale complete' : 'Receipt ' + pad(s.no));
  setBody(w, `${fresh ? `<div class="check-ok">${ic('check', 30)}</div>` : ''}
    <div class="resibo">
      ${D.settings.logo ? `<img class="rlogo" src="${D.settings.logo}" alt="">` : ''}
      <h3>${esc(D.settings.storeName || 'Store')}</h3>${D.settings.address ? `<p>${esc(D.settings.address)}</p>` : ''}${D.settings.phone ? `<p>${esc(D.settings.phone)}</p>` : ''}
      <p>${pad(s.no)}</p><p>${fmtDT(s.ts)}</p><hr>
      ${s.items.map(i => `<div class="ln"><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}<hr>
      ${s.discount ? `<div class="ln"><span>Subtotal</span><span>${money(s.subtotal)}</span></div><div class="ln"><span>Discount</span><span>-${money(s.discount)}</span></div>` : ''}
      <div class="ln t"><span>TOTAL</span><span>${money(s.total)}</span></div>
      <div class="ln"><span>Paid by</span><span>${METHODS[s.method]}</span></div>
      ${s.method === 'cash' ? `<div class="ln"><span>Cash</span><span>${money(s.tendered)}</span></div><div class="ln"><span>Change</span><span>${money(s.change)}</span></div>` : ''}
      ${s.method === 'utang' ? `<div class="ln"><span>Utang</span><span>${esc(cust(s.customerId)?.name || '')}</span></div>` : ''}
      ${s.ref ? `<div class="ln"><span>Ref</span><span>${esc(s.ref)}</span></div>` : ''}
      ${D.settings.footer ? `<hr><p>${esc(D.settings.footer)}</p>` : ''}
      ${s.voided ? '<div class="void">VOIDED</div>' : ''}
    </div>
    ${!fresh && !s.voided ? '<button class="btn danger block" style="margin-top:12px" data-act="void">Void this sale</button>' : ''}`);
  setFooter(w, `<button class="btn ghost grow" data-act="share">Share</button>
    <button class="btn ghost grow" data-act="print">Print</button>
    <button class="btn primary grow" data-act="close">${fresh ? 'New sale' : 'Done'}</button>`);
  w._acts.print = () => printSale(s, false);
  w._acts.share = async () => {
    const text = receiptText(s);
    try { if (navigator.share) return await navigator.share({ title: 'Receipt ' + pad(s.no), text }); } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('Receipt copied'); } catch { toast('Sharing is not available here'); }
  };
  w._acts.void = () => requirePin('Admin PIN required to void', () => confirmBox({ title: 'Void ' + pad(s.no) + '?', msg: 'Items go back to stock and any utang is removed. This cannot be undone.', ok: 'Void sale', danger: true }, () => {
    s.voided = true; s.voidTs = Date.now();
    s.items.forEach(i => { const p = byId(i.pid); if (p && p.track) p.stock += i.qty; });
    D.credits = D.credits.filter(c => c.saleId !== s.id);
    save('sales', 'products', 'credits'); toast('Sale voided'); closeSheet();
  }));
}
function openSale(id) {
  const s = D.sales.find(x => x.id === id); if (!s) return;
  const w = openSheet({ onClose: render }); drawReceipt(w, s, false);
}

/* =====================================================================
   ITEMS
   ===================================================================== */
function renderItems() {
  const low = D.products.filter(isLow).length;
  const worth = D.products.reduce((a, p) => a + (p.track && p.stock > 0 ? p.stock * (p.cost || 0) : 0), 0);
  main.innerHTML = `
    <div class="bar">
      <label class="search">${ic('search', 20)}<input id="iq" class="in" type="search" placeholder="Search items" value="${esc(S.iq)}" autocomplete="off" data-in="itemq" aria-label="Search items"></label>
      <button class="sq fill" data-act="newProduct" aria-label="Add item">${ic('plus')}</button>
    </div>
    <div class="chips"><button class="chip" aria-pressed="${!S.lowOnly}" data-act="lowOnly" data-v="0">All ${D.products.length}</button>
      <button class="chip" aria-pressed="${S.lowOnly}" data-act="lowOnly" data-v="1">Low stock ${low}</button></div>
    <p class="note" style="margin-top:0">Stock on hand is worth ${money(worth)} at cost.</p>
    <div id="ilist"></div>`;
  drawItemList();
}
function drawItemList() {
  const host = $('#ilist'); if (!host) return;
  const list = D.products.filter(p => (!S.lowOnly || isLow(p)) && matchQ(p, S.iq)).sort((a, b) => a.name.localeCompare(b.name));
  if (!D.products.length) {
    host.innerHTML = `<div class="empty"><h2>Your item list is empty</h2><p>Add items with their price and stock. Then selling takes one tap.</p>
      <button class="btn primary" data-act="newProduct">Add first item</button><button class="btn ghost" data-act="sample">Load sample items</button></div>`; return;
  }
  host.innerHTML = list.length ? `<div class="list">${list.map(p => `
    <button class="row" data-act="editProduct" data-id="${p.id}">
      <div class="l"><b>${esc(p.name)}</b><small>${esc([p.category, p.barcode].filter(Boolean).join(' • ') || 'No category')}</small></div>
      <div class="r"><b>${money(p.price)}</b><small class="${isLow(p) ? 'neg' : ''}">${p.track ? (p.stock <= 0 ? 'Out of stock' : p.stock + ' in stock') : 'Not tracked'}</small></div>
    </button>`).join('')}</div>` : `<div class="empty"><p>Nothing found.</p></div>`;
}
function openProduct(id) {
  const p = id ? byId(id) : { name: '', price: '', cost: '', stock: '', track: true, barcode: '', category: '' };
  if (!p) return;
  const w = openSheet({ title: id ? 'Edit item' : 'New item' });
  const cats = [...new Set(D.products.map(x => x.category).filter(Boolean))];
  setBody(w, `
    <label class="lbl" for="f_name">Item name</label><input id="f_name" class="in" value="${esc(p.name)}" autocomplete="off">
    <div class="two"><div><label class="lbl" for="f_price">Selling price (₱)</label><input id="f_price" class="in" inputmode="decimal" value="${p.price}"></div>
    <div><label class="lbl" for="f_cost">Cost (₱)</label><input id="f_cost" class="in" inputmode="decimal" value="${p.cost || ''}" placeholder="optional"></div></div>
    <label class="lbl" for="f_cat">Category</label><input id="f_cat" class="in" list="cats" value="${esc(p.category || '')}" placeholder="e.g. Drinks" autocomplete="off">
    <datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <label class="lbl" for="f_bar">Barcode</label>
    <div class="inrow"><input id="f_bar" class="in" inputmode="numeric" value="${esc(p.barcode || '')}" placeholder="scan or type" autocomplete="off"><button class="btn ghost" data-act="scanBar">${ic('scan', 20)} Scan</button></div>
    <label class="check"><input type="checkbox" id="f_track" data-in="track"${p.track ? ' checked' : ''}> Track stock for this item</label>
    <div id="stockbox"${p.track ? '' : ' hidden'}><label class="lbl" for="f_stock">Stock on hand</label>
      <input id="f_stock" class="in" inputmode="decimal" value="${p.track ? p.stock : ''}" placeholder="0">
      <div class="chips wrap" style="margin-top:10px">${[1, 5, 10, 24].map(n => `<button class="chip" data-act="addStock" data-v="${n}">+${n}</button>`).join('')}</div></div>`);
  setFooter(w, `${id ? '<button class="btn danger" data-act="del">Delete</button>' : ''}<button class="btn primary grow" data-act="save">Save item</button>`);
  w._in.track = el => { $('#stockbox', w).hidden = !el.checked; };
  w._acts.addStock = el => { const f = $('#f_stock', w); f.value = num(f.value) + num(el.dataset.v); };
  w._acts.scanBar = () => openScanner(code => { $('#f_bar', w).value = code; toast('Barcode captured'); });
  w._acts.save = () => {
    const name = $('#f_name', w).value.trim(), price = num($('#f_price', w).value), bar = $('#f_bar', w).value.trim();
    if (!name) return toast('Enter the item name');
    if ($('#f_price', w).value.trim() === '' || price < 0) return toast('Enter the selling price');
    const dup = bar && D.products.find(x => x.barcode === bar && x.id !== id);
    if (dup) return toast('Barcode already used by ' + dup.name);
    const track = $('#f_track', w).checked;
    const rec = { id: id || uid(), name, price: round2(price), cost: round2(num($('#f_cost', w).value)), category: $('#f_cat', w).value.trim(), barcode: bar, track, stock: track ? num($('#f_stock', w).value) : 0 };
    if (id) Object.assign(p, rec); else D.products.push(rec);
    save('products'); closeSheet(); render(); toast('Saved');
  };
  w._acts.del = () => confirmBox({ title: 'Delete ' + p.name + '?', msg: 'Past sales keep this item on their receipts.', ok: 'Delete item', danger: true }, () => {
    D.products = D.products.filter(x => x.id !== id); save('products'); closeSheet(); render();
  });
}
function loadSample() {
  const rows = [
    ['Instant noodles', 17, 14, 24, 'Food'], ['Softdrink mismo', 15, 12, 24, 'Drinks'], ['Bottled water 500ml', 15, 10, 24, 'Drinks'],
    ['3-in-1 coffee', 8, 6.5, 40, 'Drinks'], ['Egg (per piece)', 9, 7.5, 30, 'Food'], ['Rice (per kilo)', 55, 48, 20, 'Food'],
    ['Cooking oil (small)', 20, 17, 12, 'Food'], ['Sugar (1/4 kg)', 22, 19, 10, 'Food'], ['Candy (per piece)', 1, 0.7, 100, 'Snacks'], ['Shampoo sachet', 8, 6.5, 30, 'Personal care']
  ];
  rows.forEach(([name, price, cost, stock, category]) => D.products.push({ id: uid(), name, price, cost, stock, category, barcode: '', track: true }));
  save('products'); render(); toast('Sample items added. Edit or delete them anytime.');
}

/* =====================================================================
   UTANG (customer credit)
   ===================================================================== */
function renderUtang() {
  const b = balances();
  const owing = D.customers.filter(c => (b.get(c.id) || 0) > 0.004);
  const total = owing.reduce((a, c) => a + b.get(c.id), 0);
  main.innerHTML = `
    <div class="headline"><small>Total utang to collect</small><b>${money(total)}</b>
      <div class="sub"><span>${owing.length} customer${owing.length === 1 ? ' owes' : 's owe'} you</span></div></div>
    <div class="bar">
      <label class="search">${ic('search', 20)}<input id="uq" class="in" type="search" placeholder="Search customers" value="${esc(S.uq)}" autocomplete="off" data-in="custq" aria-label="Search customers"></label>
      <button class="sq fill" data-act="newCustomer" aria-label="Add customer">${ic('plus')}</button>
    </div><div id="ulist"></div>`;
  drawCustList();
}
function drawCustList() {
  const host = $('#ulist'); if (!host) return;
  if (!D.customers.length) {
    host.innerHTML = `<div class="empty"><h2>No customers yet</h2><p>Add a customer to record utang, take payments and send reminders.</p><button class="btn primary" data-act="newCustomer">Add customer</button></div>`; return;
  }
  const b = balances(), q = S.uq.trim().toLowerCase();
  const list = D.customers.filter(c => !q || c.name.toLowerCase().includes(q)).sort((x, y) => (b.get(y.id) || 0) - (b.get(x.id) || 0) || x.name.localeCompare(y.name));
  host.innerHTML = list.length ? `<div class="list">${list.map(c => { const v = b.get(c.id) || 0; return `
    <button class="row" data-act="openCustomer" data-id="${c.id}"><div class="l"><b>${esc(c.name)}</b><small>${esc(c.phone || 'No phone number')}</small></div>
    <div class="r"><b class="${v > 0.004 ? 'neg' : ''}">${money(v)}</b><small>${v > 0.004 ? 'owes' : 'settled'}</small></div></button>`; }).join('')}</div>` : `<div class="empty"><p>No customer found.</p></div>`;
}
function openCustomerForm(c, cb) {
  const w = openSheet({ title: c ? 'Edit customer' : 'New customer' });
  setBody(w, `<label class="lbl" for="k_name">Name</label><input id="k_name" class="in" value="${esc(c?.name || '')}" autocomplete="off">
    <label class="lbl" for="k_phone">Mobile number (for reminders)</label><input id="k_phone" class="in" inputmode="tel" value="${esc(c?.phone || '')}" placeholder="09xx xxx xxxx">`);
  setFooter(w, `${c ? '<button class="btn danger" data-act="del">Delete</button>' : ''}<button class="btn primary grow" data-act="save">Save</button>`);
  w._acts.save = () => {
    const name = $('#k_name', w).value.trim(); if (!name) return toast('Enter the customer name');
    const rec = c || { id: uid() }; rec.name = name; rec.phone = $('#k_phone', w).value.trim();
    if (!c) D.customers.push(rec);
    save('customers'); closeSheet(); cb ? cb(rec) : render();
  };
  w._acts.del = () => {
    if (Math.abs(balances().get(c.id) || 0) > 0.004) return toast('Settle the balance before deleting');
    confirmBox({ title: 'Delete ' + c.name + '?', msg: 'Their history will be removed.', ok: 'Delete', danger: true }, () => {
      D.customers = D.customers.filter(x => x.id !== c.id); D.credits = D.credits.filter(x => x.customerId !== c.id);
      save('customers', 'credits'); closeSheet(); closeSheet();
    });
  };
}
function openCustomer(id) {
  const c = cust(id); if (!c) return;
  const w = openSheet({ title: c.name, onClose: render });
  const draw = () => {
    const bal = round2(balances().get(id) || 0);
    const hist = D.credits.filter(x => x.customerId === id).sort((a, b) => b.ts - a.ts);
    setBody(w, `<div class="headline" style="margin-top:8px"><small>${c.phone ? esc(c.phone) : 'No phone number'}</small><b>${money(bal)}</b><div class="sub"><span>${bal > 0.004 ? 'current balance' : 'no balance'}</span></div></div>
      <div class="btnrow"><button class="btn ghost" data-act="charge">Add utang</button><button class="btn ghost" data-act="sms">Send reminder</button><button class="btn ghost" data-act="edit">Edit</button></div>
      <h3 class="sec" style="margin-top:6px">History</h3>
      ${hist.length ? `<div class="list">${hist.map(h => `<div class="row"><div class="l"><b>${h.type === 'charge' ? 'Utang' : 'Payment'}</b><small>${fmtDT(h.ts)}${h.note ? ' — ' + esc(h.note) : ''}</small></div>
        <div class="r"><b class="${h.type === 'charge' ? 'neg' : 'pos'}">${h.type === 'charge' ? '+' : '-'}${money(h.amount)}</b></div></div>`).join('')}</div>` : '<p class="note">Nothing recorded yet.</p>'}`);
    setFooter(w, `<button class="btn sun grow" data-act="pay"${bal > 0.004 ? '' : ' disabled'}>Receive payment</button>`);
  };
  w._acts.pay = () => openAmount({
    title: 'Payment from ' + c.name, amount: round2(balances().get(id) || 0), ok: 'Record payment',
    select: { label: 'Received as', value: 'cash', options: [['cash', 'Cash'], ['gcash', 'GCash / Maya'], ['bank', 'Bank transfer']] },
    cb: r => { D.credits.push({ id: uid(), ts: Date.now(), customerId: id, type: 'payment', amount: r.amount, method: r.sel, note: r.note }); save('credits'); toast('Payment recorded'); draw(); }
  });
  w._acts.charge = () => openAmount({
    title: 'Add utang for ' + c.name, ok: 'Add utang', cb: r => { D.credits.push({ id: uid(), ts: Date.now(), customerId: id, type: 'charge', amount: r.amount, note: r.note }); save('credits'); draw(); }
  });
  w._acts.sms = () => {
    const bal = round2(balances().get(id) || 0);
    if (!c.phone) return toast('Add a mobile number first');
    const msg = `Hi ${c.name}, this is ${D.settings.storeName}. Your utang balance is ${money(bal)}. Salamat po!`;
    location.href = 'sms:' + c.phone.replace(/\s/g, '') + '?body=' + encodeURIComponent(msg);
  };
  w._acts.edit = () => openCustomerForm(c, () => { setTitle(w, c.name); draw(); });
  draw();
}

/* =====================================================================
   CASH (drawer + expenses)
   ===================================================================== */
function drawerEntries() {
  const E = [];
  D.cash.forEach(c => E.push({ ts: c.ts, amt: c.type === 'in' ? c.amount : -c.amount, label: c.note || (c.type === 'in' ? 'Cash in' : 'Cash out'), kind: c.type === 'in' ? 'Cash in' : 'Cash out', act: 'editCash', id: c.id }));
  D.sales.forEach(s => { if (!s.voided && s.method === 'cash') E.push({ ts: s.ts, amt: s.total, label: 'Sale ' + pad(s.no), kind: 'Sale', act: 'openSale', id: s.id }); });
  D.credits.forEach(c => { if (c.type === 'payment' && c.method === 'cash') E.push({ ts: c.ts, amt: c.amount, label: (cust(c.customerId)?.name || 'Customer') + ' paid utang', kind: 'Utang paid', act: 'openCustomer', id: c.customerId }); });
  D.expenses.forEach(x => { if (x.fromCash) E.push({ ts: x.ts, amt: -x.amount, label: x.note || x.category, kind: 'Expense', act: 'editExpense', id: x.id }); });
  return E.sort((a, b) => b.ts - a.ts);
}
function renderCash() {
  main.innerHTML = `<div class="seg"><button data-act="cashTab" data-v="drawer" aria-pressed="${S.cashTab === 'drawer'}">Cash drawer</button><button data-act="cashTab" data-v="expenses" aria-pressed="${S.cashTab === 'expenses'}">Expenses</button></div><div id="cbody"></div>`;
  const host = $('#cbody'), t0 = day0();
  if (S.cashTab === 'drawer') {
    const E = drawerEntries(), bal = E.reduce((a, e) => a + e.amt, 0);
    const today = E.filter(e => e.ts >= t0), inn = today.filter(e => e.amt > 0).reduce((a, e) => a + e.amt, 0), out = today.filter(e => e.amt < 0).reduce((a, e) => a - e.amt, 0);
    host.innerHTML = `<div class="headline"><small>Cash in drawer now</small><b>${money(bal)}</b><div class="sub"><span>Today in ${money(inn)}</span><span>Today out ${money(out)}</span></div></div>
      <div class="btnrow"><button class="btn primary" data-act="cashIn">Cash in</button><button class="btn ghost" data-act="cashOut">Cash out</button>${drawerReady() ? '<button class="btn ghost" data-act="openDrawer">Open drawer</button>' : ''}</div>
      <p class="note">The balance counts cash sales, cash utang payments, cash in/out and expenses paid from the drawer. Card and e-wallet sales are not included.</p>
      ${E.length ? `<div class="list">${E.slice(0, 80).map(e => `<button class="row" data-act="${e.act}" data-id="${e.id}"><div class="l"><b>${esc(e.label)}</b><small>${e.label.startsWith(e.kind) ? '' : e.kind + ', '}${fmtDT(e.ts)}</small></div><div class="r"><b class="${e.amt < 0 ? 'neg' : 'pos'}">${e.amt < 0 ? '-' : '+'}${money(Math.abs(e.amt))}</b></div></button>`).join('')}</div>` : '<div class="empty"><p>Cash sales and drawer entries will show up here.</p></div>'}`;
  } else {
    const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
    const mTot = D.expenses.filter(x => x.ts >= m0.getTime()).reduce((a, x) => a + x.amount, 0), tTot = D.expenses.filter(x => x.ts >= t0).reduce((a, x) => a + x.amount, 0);
    const list = D.expenses.slice().sort((a, b) => b.ts - a.ts);
    host.innerHTML = `<div class="headline"><small>Spent this month</small><b>${money(mTot)}</b><div class="sub"><span>Today ${money(tTot)}</span></div></div>
      <div class="btnrow"><button class="btn primary" data-act="newExpense">Add expense</button></div>
      ${list.length ? `<div class="list">${list.slice(0, 80).map(x => `<button class="row" data-act="editExpense" data-id="${x.id}"><div class="l"><b>${esc(x.note || x.category)}</b><small>${esc(x.category)}, ${fmtDT(x.ts)}</small></div><div class="r"><b class="neg">${money(x.amount)}</b></div></button>`).join('')}</div>` : '<div class="empty"><h2>No expenses yet</h2><p>Record rent, restocking and other costs so your profit is accurate.</p></div>'}`;
  }
}
function cashEntry(type, id) {
  const e = id ? D.cash.find(x => x.id === id) : null; if (id && !e) return;
  openAmount({
    title: e ? 'Edit ' + (e.type === 'in' ? 'cash in' : 'cash out') : (type === 'in' ? 'Cash in' : 'Cash out'), amount: e?.amount, note: e?.note, ok: 'Save',
    cb: r => { if (e) { e.amount = r.amount; e.note = r.note; } else D.cash.push({ id: uid(), ts: Date.now(), type, amount: r.amount, note: r.note }); save('cash'); render(); },
    del: e && (() => confirmBox({ title: 'Delete entry?', msg: money(e.amount) + ' will be removed from the drawer.', ok: 'Delete', danger: true }, () => { D.cash = D.cash.filter(x => x.id !== id); save('cash'); closeSheet(); render(); }))
  });
}
function expenseEntry(id) {
  const e = id ? D.expenses.find(x => x.id === id) : null; if (id && !e) return;
  openAmount({
    title: e ? 'Edit expense' : 'Add expense', amount: e?.amount, note: e?.note, ok: 'Save expense',
    select: { label: 'Category', value: e?.category || EXPENSE_CATS[0], options: EXPENSE_CATS.map(c => [c, c]) },
    check: { label: 'Paid from the cash drawer', value: e ? e.fromCash : true },
    cb: r => { if (e) Object.assign(e, { amount: r.amount, note: r.note, category: r.sel, fromCash: r.chk }); else D.expenses.push({ id: uid(), ts: Date.now(), amount: r.amount, note: r.note, category: r.sel, fromCash: r.chk }); save('expenses'); render(); },
    del: e && (() => confirmBox({ title: 'Delete expense?', msg: money(e.amount) + ' will be removed.', ok: 'Delete', danger: true }, () => { D.expenses = D.expenses.filter(x => x.id !== id); save('expenses'); closeSheet(); render(); }))
  });
}

/* =====================================================================
   REPORTS
   ===================================================================== */
const PERIODS = [['today', 'Today'], ['yest', 'Yesterday'], ['week', '7 days'], ['month', 'This month'], ['all', 'All time']];
function rangeOf(p) {
  const t0 = day0(), d = new Date();
  if (p === 'today') return [t0, t0 + DAY];
  if (p === 'yest') return [t0 - DAY, t0];
  if (p === 'week') return [t0 - 6 * DAY, t0 + DAY];
  if (p === 'month') return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), t0 + DAY];
  return [0, Infinity];
}
function renderReports() {
  const [from, to] = rangeOf(S.period), inR = t => t >= from && t < to;
  const sales = D.sales.filter(s => !s.voided && inR(s.ts));
  const revenue = sales.reduce((a, s) => a + s.total, 0);
  const cogs = sales.reduce((a, s) => a + s.items.reduce((b, i) => b + i.cost * i.qty, 0), 0);
  const exp = D.expenses.filter(x => inR(x.ts)).reduce((a, x) => a + x.amount, 0);
  const gross = revenue - cogs, net = gross - exp;
  const onUtang = sales.filter(s => s.method === 'utang').reduce((a, s) => a + s.total, 0);
  const collected = D.credits.filter(c => c.type === 'payment' && inR(c.ts)).reduce((a, c) => a + c.amount, 0);

  const byM = {}; sales.forEach(s => { byM[s.method] = (byM[s.method] || 0) + s.total; });
  const prod = {}; sales.forEach(s => s.items.forEach(i => { const p = prod[i.name] || (prod[i.name] = { qty: 0, rev: 0 }); p.qty += i.qty; p.rev += i.qty * i.price; }));
  const top = Object.entries(prod).sort((a, b) => b[1].rev - a[1].rev).slice(0, 5);

  const t0 = day0(), days = [];
  for (let i = 6; i >= 0; i--) { const a = t0 - i * DAY; days.push({ a, v: D.sales.filter(s => !s.voided && s.ts >= a && s.ts < a + DAY).reduce((x, s) => x + s.total, 0) }); }
  const mx = Math.max(1, ...days.map(d => d.v));
  const low = D.products.filter(isLow).sort((a, b) => a.stock - b.stock).slice(0, 8);
  const recent = D.sales.filter(s => inR(s.ts)).sort((a, b) => b.ts - a.ts).slice(0, 40);

  main.innerHTML = `
    <div class="chips">${PERIODS.map(([k, l]) => `<button class="chip" aria-pressed="${S.period === k}" data-act="period" data-v="${k}">${l}</button>`).join('')}</div>
    <dl class="stmt">
      <div><dt>Sales</dt><i></i><dd>${money(revenue)}</dd></div>
      <div class="sub"><dt>${sales.length} transaction${sales.length === 1 ? '' : 's'}</dt></div>
      <div><dt>Cost of items sold</dt><i></i><dd>-${money(cogs)}</dd></div>
      <div><dt>Gross profit</dt><i></i><dd>${money(gross)}</dd></div>
      <div><dt>Expenses</dt><i></i><dd>-${money(exp)}</dd></div>
      <div class="tot"><dt>Net profit</dt><i></i><dd class="${net < 0 ? 'neg' : ''}">${money(net)}</dd></div>
    </dl>
    ${onUtang || collected ? `<p class="note">${money(onUtang)} of these sales are on utang. Utang collected in this period: ${money(collected)}.</p>` : ''}
    <h3 class="sec">Last 7 days</h3>
    <div class="chart" role="img" aria-label="Sales for the last 7 days">${days.map((d, i) => `<div class="c${i === 6 ? ' today' : ''}"><em>${d.v ? (d.v >= 1000 ? Math.round(d.v / 100) / 10 + 'k' : Math.round(d.v)) : ''}</em><i style="height:${Math.max(3, d.v / mx * 78)}px"></i><span>${new Date(d.a).toLocaleDateString('en-PH', { weekday: 'short' }).slice(0, 3)}</span></div>`).join('')}</div>
    ${Object.keys(byM).length ? `<h3 class="sec">By payment type</h3><div class="list">${Object.entries(byM).map(([k, v]) => `<div class="row"><div class="l"><b>${METHODS[k]}</b></div><div class="r"><b>${money(v)}</b></div></div>`).join('')}</div>` : ''}
    ${top.length ? `<h3 class="sec">Best sellers</h3><div class="list">${top.map(([n, v]) => `<div class="row"><div class="l"><b>${esc(n)}</b><small>${v.qty} sold</small></div><div class="r"><b>${money(v.rev)}</b></div></div>`).join('')}</div>` : ''}
    ${low.length ? `<h3 class="sec">Running low</h3><div class="list">${low.map(p => `<button class="row" data-act="editProduct" data-id="${p.id}"><div class="l"><b>${esc(p.name)}</b></div><div class="r"><b class="neg">${p.stock <= 0 ? 'Out' : p.stock + ' left'}</b></div></button>`).join('')}</div>` : ''}
    <h3 class="sec">Transactions</h3>
    ${recent.length ? `<div class="list">${recent.map(s => `<button class="row" data-act="openSale" data-id="${s.id}"><div class="l"><b class="${s.voided ? 'strike' : ''}">${pad(s.no)} ${METHODS[s.method]}</b><small>${fmtDT(s.ts)}${s.voided ? ', voided' : ''}</small></div><div class="r"><b class="${s.voided ? 'strike' : ''}">${money(s.total)}</b></div></button>`).join('')}</div>` : '<div class="empty"><p>No sales in this period.</p></div>'}
    ${D.sales.length ? `<div class="btnrow" style="margin-top:14px"><button class="btn ghost" data-act="exportCsv">Export sales (CSV)</button></div>` : ''}`;
}

/* =====================================================================
   SETTINGS, backup, restore
   ===================================================================== */
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
addEventListener('appinstalled', () => { installEvt = null; toast('Installed'); });

function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const backupJSON = () => JSON.stringify({ app: 'tindahan-pos', version: 1, exported: Date.now(), data: { products: D.products, sales: D.sales, customers: D.customers, credits: D.credits, cash: D.cash, expenses: D.expenses, settings: D.settings } });
const backupName = () => 'tindahan-backup-' + new Date().toISOString().slice(0, 10) + '.json';
function markBackup() { D.settings.lastBackup = Date.now(); save('settings'); render(); }

function openSettings() {
  const w = openSheet({ title: 'Settings' });
  const bk = () => D.settings.lastBackup ? 'Last backup: ' + fmtD(D.settings.lastBackup) : 'You have not backed up yet.';
  const canShareFile = () => { try { return !!navigator.canShare?.({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }); } catch { return false; } };
  setBody(w, `
    <label class="lbl" for="s_name">Store name</label><input id="s_name" class="in" value="${esc(D.settings.storeName)}" autocomplete="off">
    <label class="lbl" for="s_addr">Address or tagline (optional)</label><input id="s_addr" class="in" value="${esc(D.settings.address)}" autocomplete="off" placeholder="e.g. Purok 3, San Jose">
    <label class="lbl" for="s_phone">Phone number on receipts</label><input id="s_phone" class="in" inputmode="tel" value="${esc(D.settings.phone)}">
    <label class="lbl" for="s_foot">Message at the bottom of receipts</label><input id="s_foot" class="in" value="${esc(D.settings.footer)}">
    <label class="lbl" for="s_low">Warn me when stock is at or below</label><input id="s_low" class="in" inputmode="numeric" value="${D.settings.lowStock}">
    <h3 class="sec">Receipt logo</h3>
    <p class="note">Shows at the top of the receipt on screen, when shared, and when printed through the phone/computer print dialog. Thermal (Bluetooth) printers print text only, so the logo will not appear on that paper.</p>
    <div id="logorow"></div>
    <h3 class="sec">Payment QR codes</h3>
    <p class="note">Save your own GCash and Maya QR here. At checkout it shows on screen so customers can scan it. Take a screenshot of your QR in the app and crop it to just the code.</p>
    <div id="qrrows"></div>
    <h3 class="sec">Receipt printing</h3>
    <div id="prsec"></div>
    <h3 class="sec">Admin PIN</h3>
    <p class="note">Once set, the cashier must ask you for this PIN to void a sale or erase data, so a sale cannot be voided without your knowledge.</p>
    <div id="pinrow"></div>
    <h3 class="sec">Your data</h3>
    <p class="note">Everything is stored on this phone only. If you uninstall the app or clear its data, it is gone, so back up often and keep the file somewhere safe like Google Drive or Messenger.</p>
    <p class="note" id="s_bk"><b>${bk()}</b></p>
    <div class="btnrow"><button class="btn primary" data-act="backup">Save backup</button>${canShareFile() ? '<button class="btn ghost" data-act="shareBackup">Send backup</button>' : ''}</div>
    <div class="btnrow"><button class="btn ghost" data-act="restore">Restore from backup</button></div>
    ${installEvt ? '<div class="btnrow"><button class="btn ghost" data-act="install">Install on this phone</button></div>' : ''}
    <div class="btnrow"><button class="btn danger" data-act="reset">Erase all data</button></div>
    <p class="note">Tindahan POS v1. Works without internet.</p>`);
  const drawQr = () => {
    $('#qrrows', w).innerHTML = ['gcash', 'maya'].map(k => { const q = (D.settings.qr || {})[k]; return `
      <div class="qrset">${q ? `<img src="${q}" alt="">` : '<span class="ph"></span>'}
        <div class="l"><b>${METHODS[k]}</b><small>${q ? 'QR saved' : 'Not added yet'}</small></div>
        <button class="btn ghost" data-act="qrUp" data-k="${k}">${q ? 'Replace' : 'Upload'}</button>
        ${q ? `<button class="btn danger" data-act="qrDel" data-k="${k}" aria-label="Remove ${METHODS[k]} QR">${ic('x', 18)}</button>` : ''}
      </div>`; }).join('');
  };
  drawQr();
  const drawLogo = () => {
    $('#logorow', w).innerHTML = `<div class="qrset">${D.settings.logo ? `<img src="${D.settings.logo}" alt="">` : '<span class="ph"></span>'}
      <div class="l"><b>${D.settings.logo ? 'Logo saved' : 'No logo yet'}</b><small>PNG or JPG, square works best</small></div>
      <button class="btn ghost" data-act="logoUp">${D.settings.logo ? 'Replace' : 'Upload'}</button>
      ${D.settings.logo ? `<button class="btn danger" data-act="logoDel" aria-label="Remove logo">${ic('x', 18)}</button>` : ''}</div>`;
  };
  drawLogo();
  w._acts.logoUp = () => pickLogo(drawLogo);
  w._acts.logoDel = () => { D.settings.logo = ''; save('settings'); drawLogo(); };
  const drawPin = () => {
    $('#pinrow', w).innerHTML = !pinSupported()
      ? '<p class="note">PIN protection needs a secure connection (https) and is not available here.</p>'
      : D.settings.adminPin
        ? `<div class="qrset"><div class="l"><b>PIN is set</b><small>Required for void and erase</small></div><button class="btn ghost" data-act="pinChange">Change</button><button class="btn danger" data-act="pinRemove">Remove</button></div>`
        : `<button class="btn ghost block" data-act="pinSet">Set admin PIN</button>`;
  };
  drawPin();
  w._acts.pinSet = () => openPinSetup('set');
  w._acts.pinChange = () => openPinSetup('change');
  w._acts.pinRemove = () => openPinSetup('remove');
  const PR_HINT = {
    system: "Opens the phone or computer print dialog. Choose your printer or Save as PDF. Works with Wi-Fi printers and with Bluetooth printers that have their maker's print plugin installed.",
    bt: 'For Bluetooth Low Energy thermal printers (ESC/POS). Older printers that only support classic Bluetooth will not show up in the list. Use the RawBT option for those.',
    rawbt: 'Install the free RawBT app from the Play Store, pair your printer inside RawBT and set it as the default printer. Tindahan then sends each receipt to RawBT.'
  };
  const drawPr = () => {
    const m = D.settings.printMode || 'system';
    $('#prsec', w).innerHTML = `
      <label class="lbl" for="p_mode">Printer type</label>
      <select id="p_mode" class="in" data-in="pmode">
        <option value="system"${m === 'system' ? ' selected' : ''}>Phone print dialog</option>
        <option value="bt"${m === 'bt' ? ' selected' : ''}>Bluetooth thermal printer (BLE)</option>
        <option value="rawbt"${m === 'rawbt' ? ' selected' : ''}>RawBT app (classic Bluetooth printers)</option></select>
      <label class="lbl" for="p_paper">Paper width</label>
      <select id="p_paper" class="in" data-in="ppaper"><option value="58"${D.settings.paper !== 80 ? ' selected' : ''}>58 mm (32 characters)</option><option value="80"${D.settings.paper === 80 ? ' selected' : ''}>80 mm (48 characters)</option></select>
      <p class="note">${PR_HINT[m]}</p>
      ${m === 'bt' ? `<div class="qrset"><div class="l"><b>${esc(D.settings.printerName || 'No printer chosen')}</b><small>Bluetooth printer</small></div><button class="btn ghost" data-act="btPick">${D.settings.printerName ? 'Change' : 'Connect'}</button></div>` : ''}
      <label class="check"><input type="checkbox" id="p_auto" data-in="pauto"${D.settings.autoPrint ? ' checked' : ''}> Print receipt automatically when I tap Confirm</label>
      ${m !== 'system' ? `<label class="check"><input type="checkbox" id="p_drawer" data-in="pdrawer"${D.settings.drawer ? ' checked' : ''}> Open cash drawer on cash sales</label>
        ${D.settings.drawer ? `<label class="lbl" for="p_pin">Drawer connector</label>
        <select id="p_pin" class="in" data-in="ppin"><option value="0"${D.settings.drawerPin !== 1 ? ' selected' : ''}>Pin 2 (most drawers)</option><option value="1"${D.settings.drawerPin === 1 ? ' selected' : ''}>Pin 5</option></select>
        <p class="note">Plug the drawer's RJ11/RJ12 cable into the drawer port of your receipt printer.</p>` : ''}` : ''}
      <div class="btnrow" style="margin-top:8px"><button class="btn ghost" data-act="testPrint">Print a test receipt</button>${m !== 'system' && D.settings.drawer ? '<button class="btn ghost" data-act="testDrawer">Open drawer</button>' : ''}</div>`;
  };
  drawPr();
  w._in.pmode = el => { D.settings.printMode = el.value; save('settings'); drawPr(); };
  w._in.ppaper = el => { D.settings.paper = num(el.value); save('settings'); };
  w._in.pauto = el => { D.settings.autoPrint = el.checked; save('settings'); };
  w._in.pdrawer = el => { D.settings.drawer = el.checked; save('settings'); drawPr(); };
  w._in.ppin = el => { D.settings.drawerPin = num(el.value) === 1 ? 1 : 0; save('settings'); };
  w._acts.testDrawer = () => openDrawer();
  w._acts.btPick = () => btConnect(true).then(() => { toast('Printer connected'); drawPr(); }).catch(e => {
    if (e && e.name === 'NotFoundError') return;
    toast(e && e.code === 'nobt' ? 'Bluetooth is not available here. Try the RawBT option.' : e && e.code === 'nowrite' ? 'Connected, but this printer is not compatible. Try the RawBT option.' : 'Could not connect to the printer.');
  });
  w._acts.testPrint = () => printSale(sampleSale(), false);
  w._acts.qrUp = el => pickQr(el.dataset.k, drawQr);
  w._acts.qrDel = el => { D.settings.qr = { ...(D.settings.qr || {}), [el.dataset.k]: '' }; save('settings'); drawQr(); };
  setFooter(w, `<button class="btn primary grow" data-act="saveSet">Save settings</button>`);
  w._acts.saveSet = () => {
    Object.assign(D.settings, { storeName: $('#s_name', w).value.trim() || 'My Store', address: $('#s_addr', w).value.trim(), phone: $('#s_phone', w).value.trim(), footer: $('#s_foot', w).value.trim(), lowStock: Math.max(0, Math.floor(num($('#s_low', w).value))) });
    save('settings'); closeSheet(); render(); toast('Settings saved');
  };
  w._acts.backup = () => { download(backupName(), backupJSON(), 'application/json'); markBackup(); $('#s_bk', w).innerHTML = '<b>' + bk() + '</b>'; toast('Backup saved to Downloads'); };
  w._acts.shareBackup = async () => {
    try { await navigator.share({ files: [new File([backupJSON()], backupName(), { type: 'application/json' })], title: 'Tindahan backup' }); markBackup(); $('#s_bk', w).innerHTML = '<b>' + bk() + '</b>'; }
    catch (e) { if (e.name !== 'AbortError') toast('Could not share the backup'); }
  };
  w._acts.restore = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const j = JSON.parse(await inp.files[0].text());
        if (j.app !== 'tindahan-pos' || !j.data || !Array.isArray(j.data.products)) throw new Error('bad');
        confirmBox({ title: 'Replace current data?', msg: `This backup has ${j.data.products.length} items and ${(j.data.sales || []).length} sales. Everything on this phone will be replaced.`, ok: 'Restore', danger: true }, () => {
          COLS.forEach(k => { D[k] = Array.isArray(j.data[k]) ? j.data[k] : []; });
          D.settings = { ...DEFAULT_SETTINGS, ...(j.data.settings || {}) };
          saveAll(); S.cart = []; closeSheet(); closeSheet(); render(); toast('Backup restored');
        });
      } catch { toast('That is not a Tindahan backup file'); }
    };
    inp.click();
  };
  w._acts.install = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; };
  w._acts.reset = () => requirePin('Admin PIN required to erase data', () => confirmBox({ title: 'Erase everything?', msg: 'All items, sales, customers and ledgers on this phone will be deleted. Save a backup first if you may need them.', ok: 'Erase all data', danger: true }, () => {
    COLS.forEach(k => { D[k] = []; }); D.settings = { ...DEFAULT_SETTINGS }; S.cart = []; saveAll(); closeSheet(); closeSheet(); render(); toast('All data erased');
  }));
}
function exportCsv() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['Receipt', 'Date', 'Time', 'Item', 'Qty', 'Price', 'Line total', 'Payment', 'Customer', 'Status']];
  D.sales.forEach(s => s.items.forEach(i => {
    const d = new Date(s.ts);
    rows.push([pad(s.no), d.toLocaleDateString('en-CA'), d.toLocaleTimeString('en-PH'), i.name, i.qty, i.price, round2(i.price * i.qty), METHODS[s.method], cust(s.customerId)?.name || '', s.voided ? 'Voided' : 'OK']);
  }));
  download('tindahan-sales-' + new Date().toISOString().slice(0, 10) + '.csv', '\ufeff' + rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
}

/* =====================================================================
   Barcode scanner (camera). Uses the browser BarcodeDetector where available.
   USB / Bluetooth scanners work too: focus the search box and scan.
   ===================================================================== */
async function openScanner(onCode, continuous = false) {
  if (!('BarcodeDetector' in window)) return toast('Camera scanning is not supported here. Type the code or use a Bluetooth scanner.');
  let stream, timer, running = true;
  const w = openSheet({
    title: 'Scan barcode', cls: 'scan',
    html: '<div class="vid"><video playsinline muted></video><div class="reticle"></div></div><p class="hint">Point the camera at the barcode</p>',
    onClose: () => { running = false; clearTimeout(timer); stream && stream.getTracks().forEach(t => t.stop()); }
  });
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'].filter(f => supported.includes(f));
    const det = new BarcodeDetector(formats.length ? { formats } : undefined);
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (!running) { stream.getTracks().forEach(t => t.stop()); return; }
    const video = $('video', w); video.srcObject = stream; await video.play();
    let last = '', lastT = 0;
    const tick = async () => {
      if (!running) return;
      try {
        const r = await det.detect(video);
        if (r.length) {
          const v = r[0].rawValue, now = Date.now();
          if (v !== last || now - lastT > 1600) {
            last = v; lastT = now; onCode(v);
            if (!continuous) { closeSheet(); return; }
          }
        }
      } catch { /* frame not ready */ }
      timer = setTimeout(tick, 160);
    };
    tick();
  } catch {
    if (running) { closeSheet(); toast('Camera is blocked. Allow camera access for this app in your phone settings.'); }
  }
}

/* =====================================================================
   Actions & input handlers
   ===================================================================== */
const A = {
  close: () => closeSheet(),
  tab: el => { S.tab = el.dataset.v; render(); main.scrollTop = 0; },
  settings: openSettings,
  cat: el => { S.cat = el.dataset.v; renderSell(); },
  add: el => { const p = byId(el.dataset.id); if (p) addToCart(p); },
  openCart,
  customItem,
  sample: loadSample,
  scanSell: () => openScanner(code => {
    const p = D.products.find(x => x.barcode && x.barcode === code);
    if (p) { addToCart(p); toast('Added ' + p.name); } else { beep(300, 0.2); toast('No item with barcode ' + code); }
  }, true),
  newProduct: () => openProduct(),
  editProduct: el => openProduct(el.dataset.id),
  lowOnly: el => { S.lowOnly = el.dataset.v === '1'; renderItems(); },
  newCustomer: () => openCustomerForm(null, c => { render(); openCustomer(c.id); }),
  openCustomer: el => openCustomer(el.dataset.id),
  cashTab: el => { S.cashTab = el.dataset.v; renderCash(); },
  cashIn: () => cashEntry('in'),
  cashOut: () => cashEntry('out'),
  openDrawer: () => openDrawer(),
  editCash: el => cashEntry(null, el.dataset.id),
  newExpense: () => expenseEntry(),
  editExpense: el => expenseEntry(el.dataset.id),
  openSale: el => openSale(el.dataset.id),
  period: el => { S.period = el.dataset.v; renderReports(); },
  exportCsv
};
const IN = {
  sellq: el => { S.q = el.value; drawSellList(); },
  itemq: el => { S.iq = el.value; drawItemList(); },
  custq: el => { S.uq = el.value; drawCustList(); }
};

/* =====================================================================
   Boot
   ===================================================================== */
(async function init() {
  try { store = await idbStore(); } catch { store = lsStore; }
  try { await load(); } catch { toast('Could not read saved data'); }
  navigator.storage?.persist?.().catch(() => {});
  setNet(); render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
