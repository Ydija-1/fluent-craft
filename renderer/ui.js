'use strict';
/* Базовые UI-хелперы: построение DOM, диалоги, уведомления, генерация обложек. */

const $ = (sel, el = document) => el.querySelector(sel);

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'readOnly', 'min', 'max', 'step']);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtNum = (n) => new Intl.NumberFormat('ru', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ');

function hash(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
function rng(seed) {
  let s = seed || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Аватар аккаунта: цвет получается из ника. */
function avatar(name, small) {
  const hue = hash(name) % 360;
  return h('div', {
    class: 'avatar' + (small ? ' sm' : ''),
    style: { background: `linear-gradient(135deg, hsl(${hue} 55% 46%), hsl(${(hue + 40) % 360} 60% 36%))` },
  }, (name[0] || '?').toUpperCase());
}

/** Пиксельная обложка сборки: детерминированный узор из блоков. */
function coverCanvas(seedText) {
  const W = 34; const H = 12;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const seed = hash(seedText);
  const rand = rng(seed);
  const hue = seed % 360;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, `hsl(${hue} 50% 34%)`);
  grad.addColorStop(1, `hsl(${(hue + 50) % 360} 55% 24%)`);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x++) {
    const top = 4 + Math.floor(rand() * 4);
    for (let y = top; y < H; y++) {
      const depth = y - top;
      const l = depth === 0 ? 46 : 28 - depth * 2 + rand() * 7;
      const hh = depth === 0 ? (hue + 110) % 360 : hue;
      g.fillStyle = `hsl(${hh} ${depth === 0 ? 45 : 30}% ${Math.max(10, l)}%)`;
      g.fillRect(x, y, 1, 1);
    }
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(255,255,255,${0.05 + rand() * 0.1})`;
    g.fillRect(Math.floor(rand() * W), Math.floor(rand() * 4), 1, 1);
  }
  return c;
}

// ---------- уведомления ----------
function toast(msg, kind = 'info', ms = 4200) {
  const el = h('div', { class: 'toast ' + kind, role: 'status' },
    icon(kind === 'err' ? 'warning' : kind === 'ok' ? 'check' : 'info', 18), h('span', null, msg));
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- диалоги ----------
function dialog({ title, body, buttons = [], wide = false, onClose }) {
  const smoke = h('div', { class: 'smoke' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    smoke.remove();
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'd-head' }, title),
    h('div', { class: 'd-body' }, body),
    buttons.length
      ? h('div', { class: 'd-foot' }, buttons.map((b) => h('button', {
        class: 'btn' + (b.accent ? ' accent' : '') + (b.danger ? ' danger' : ''),
        onclick: (e) => (b.onclick ? b.onclick(close, e.currentTarget) : close()),
      }, b.label)))
      : null);
  smoke.append(box);
  smoke.addEventListener('mousedown', (e) => { if (e.target === smoke) close(); });
  document.addEventListener('keydown', onKey);
  $('#dialogs').append(smoke);
  const first = box.querySelector('input, select, .btn.accent');
  if (first) first.focus();
  return { close, box };
}

function confirmDialog({ title, text, okLabel = 'Удалить', danger = true }) {
  return new Promise((resolve) => {
    let answered = false;
    dialog({
      title,
      body: h('p', null, text),
      onClose: () => { if (!answered) resolve(false); },
      buttons: [
        { label: okLabel, accent: !danger, danger, onclick: (close) => { answered = true; resolve(true); close(); } },
        { label: 'Отмена' },
      ],
    });
  });
}

function field(label, control) {
  return h('div', { class: 'field' }, h('label', null, label), control);
}

function switchEl(checked, onchange) {
  return h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange(e.target.checked) }), h('i'));
}

function infobar(kind, title, text, action) {
  return h('div', { class: 'infobar ' + kind },
    icon(kind === 'err' ? 'warning' : kind === 'ok' ? 'check' : kind === 'warn' ? 'warning' : 'info', 18),
    h('div', { class: 'msg' }, title ? h('b', null, title) : null, text),
    action || null);
}
