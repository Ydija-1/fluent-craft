'use strict';
/**
 * Сборки (instances). Каждая живёт в своей папке instances/<id>/ — это и есть игровая директория.
 * Метаданные: instance.json, учёт установленного контента: fluentcraft-content.json.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./paths');
const { readJson, writeJson } = require('./store');

const CONTENT_DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const SUB = ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'config'];

function slug(s) {
  return (String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'instance').slice(0, 32);
}

const metaFile = (id) => path.join(P.instance(id), 'instance.json');
const contentFile = (id) => path.join(P.instance(id), 'fluentcraft-content.json');

function get(id) {
  return readJson(metaFile(id), null);
}

function list() {
  let dirs = [];
  try { dirs = fs.readdirSync(P.instances, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { /* пусто */ }
  return dirs.map((e) => get(e.name)).filter(Boolean).sort((a, b) => (b.lastPlayed || b.created) - (a.lastPlayed || a.created));
}

function create({ name, mc, loader = 'vanilla', loaderVersion = '', icon = null, source = null }) {
  if (!name || !String(name).trim()) throw new Error('Укажите название сборки');
  if (!mc) throw new Error('Выберите версию Minecraft');
  if (loader !== 'vanilla' && !loaderVersion) throw new Error('Выберите версию загрузчика');
  const id = `${slug(name)}-${crypto.randomBytes(2).toString('hex')}`;
  const inst = {
    id, name: String(name).trim(), mc, loader, loaderVersion,
    icon, source, memory: null, jvmArgs: '',
    customVersionId: null, created: Date.now(), lastPlayed: null,
  };
  fs.mkdirSync(P.instance(id), { recursive: true });
  for (const s of SUB) fs.mkdirSync(path.join(P.instance(id), s), { recursive: true });
  writeJson(metaFile(id), inst);
  return inst;
}

function update(id, patch) {
  const inst = get(id);
  if (!inst) throw new Error('Сборка не найдена');
  const allowed = ['name', 'memory', 'jvmArgs', 'lastPlayed', 'customVersionId'];
  for (const k of allowed) if (k in patch) inst[k] = patch[k];
  writeJson(metaFile(id), inst);
  return inst;
}

function remove(id) {
  if (!get(id)) return;
  fs.rmSync(P.instance(id), { recursive: true, force: true });
}

// ----- учёт контента -----

function readContent(id) { return readJson(contentFile(id), { files: {} }); }

function recordContent(id, rel, info) {
  const d = readContent(id);
  d.files[rel.replace(/\\/g, '/')] = info;
  writeJson(contentFile(id), d);
}

function findContentByProject(id, source, projectId) {
  const d = readContent(id);
  return Object.entries(d.files).filter(([, v]) => v.source === source && String(v.projectId) === String(projectId)).map(([k]) => k);
}

function forgetContent(id, rel) {
  const d = readContent(id);
  delete d.files[rel.replace(/\\/g, '/')];
  writeJson(contentFile(id), d);
}

/** Список установленного контента одного типа (mod | resourcepack | shader). */
function listContent(id, type) {
  const sub = CONTENT_DIRS[type];
  if (!sub) throw new Error('Неизвестный тип контента');
  const dir = path.join(P.instance(id), sub);
  const known = readContent(id).files;
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* нет папки */ }
  return names
    .filter((e) => /\.(jar|zip|disabled)$/i.test(e.name) && (e.isFile() || e.isDirectory()))
    .map((e) => {
      const rel = `${sub}/${e.name}`;
      const disabled = /\.disabled$/i.test(e.name);
      const baseName = disabled ? e.name.replace(/\.disabled$/i, '') : e.name;
      const meta = known[rel] || known[`${sub}/${baseName}`] || {};
      let size = 0;
      try { size = fs.statSync(path.join(dir, e.name)).size; } catch { /* ignore */ }
      return { file: e.name, rel, disabled, title: meta.title || baseName, source: meta.source || null, size };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function contentPath(id, rel) {
  return P.safeJoin(P.instance(id), rel);
}

function toggleContent(id, rel) {
  const full = contentPath(id, rel);
  if (!fs.existsSync(full)) throw new Error('Файл не найден');
  const disabled = /\.disabled$/i.test(full);
  const next = disabled ? full.replace(/\.disabled$/i, '') : full + '.disabled';
  fs.renameSync(full, next);
  // Записи об установке хранятся по базовому имени (без .disabled), поэтому менять их не нужно.
  return true;
}

function removeContent(id, rel) {
  const full = contentPath(id, rel);
  fs.rmSync(full, { recursive: true, force: true });
  forgetContent(id, rel.replace(/\.disabled$/i, ''));
}

module.exports = {
  get, list, create, update, remove,
  recordContent, findContentByProject, forgetContent,
  listContent, toggleContent, removeContent, contentPath,
  CONTENT_DIRS,
};
