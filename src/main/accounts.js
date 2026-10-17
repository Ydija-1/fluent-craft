'use strict';
const crypto = require('crypto');
const P = require('./paths');
const { readJson, writeJson } = require('./store');

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

/** UUID оффлайн-игрока — точно так же, как его считает сам Minecraft (UUID v3 от "OfflinePlayer:<имя>"). */
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function load() {
  const d = readJson(P.accounts(), { accounts: [], selected: null });
  if (!Array.isArray(d.accounts)) d.accounts = [];
  return d;
}

function list() { return load(); }

function add(name) {
  name = String(name || '').trim();
  if (!NAME_RE.test(name)) {
    throw new Error('Ник: от 3 до 16 символов — латиница, цифры и «_»');
  }
  const d = load();
  if (d.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('Такой аккаунт уже есть');
  }
  const acc = {
    id: crypto.randomUUID(),
    type: 'offline',
    name,
    uuid: offlineUuid(name),
    created: Date.now(),
  };
  d.accounts.push(acc);
  if (!d.selected) d.selected = acc.id;
  writeJson(P.accounts(), d);
  return d;
}

function remove(id) {
  const d = load();
  d.accounts = d.accounts.filter((a) => a.id !== id);
  if (d.selected === id) d.selected = d.accounts[0] ? d.accounts[0].id : null;
  writeJson(P.accounts(), d);
  return d;
}

function select(id) {
  const d = load();
  if (d.accounts.some((a) => a.id === id)) d.selected = id;
  writeJson(P.accounts(), d);
  return d;
}

function getSelected() {
  const d = load();
  return d.accounts.find((a) => a.id === d.selected) || null;
}

module.exports = { offlineUuid, list, add, remove, select, getSelected, NAME_RE };
