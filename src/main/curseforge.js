'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const { getConfig } = require('./store');
const { fetchJson, download, pool } = require('./net');
const instances = require('./instances');

const API = 'https://api.curseforge.com/v1';
const GAME_ID = 432; // Minecraft

const CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552 };
const CLASS_TYPE = { 6: 'mod', 4471: 'modpack', 12: 'resourcepack', 6552: 'shader' };
const LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const SORT = { relevance: 2, downloads: 6, follows: 2, updated: 3, newest: 11 };
const TYPE_DIR = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const RELEASE = ['', 'release', 'beta', 'alpha'];

function noKey() {
  const e = new Error('Для CurseForge нужен API-ключ — укажите его в «Настройках».');
  e.code = 'NO_CF_KEY';
  return e;
}

async function cf(pathname, { query, method = 'GET', body } = {}) {
  const key = getConfig().curseforgeKey;
  if (!key) throw noKey();
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')) : '';
  try {
    return await fetchJson(API + pathname + qs, {
      method,
      headers: { 'x-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.status === 403 || e.status === 401) {
      const err = new Error('CurseForge отклонил API-ключ (проверьте, что он введён верно).');
      err.code = 'BAD_CF_KEY';
      throw err;
    }
    throw e;
  }
}

function cdnUrl(f) {
  const id = Number(f.id);
  return `https://edge.forgecdn.net/files/${Math.floor(id / 1000)}/${id % 1000}/${encodeURIComponent(f.fileName)}`;
}

async function search({ type = 'mod', query = '', mc, loader, sort = 'relevance', offset = 0, limit = 20 }) {
  const q = {
    gameId: GAME_ID,
    classId: CLASS[type],
    searchFilter: query,
    sortField: SORT[sort] || 2,
    sortOrder: 'desc',
    pageSize: limit,
    index: offset,
  };
  if (mc) {
    q.gameVersion = mc;
    // modLoaderType работает только вместе с gameVersion
    if (loader && (type === 'mod' || type === 'modpack') && LOADER[loader]) q.modLoaderType = LOADER[loader];
  }
  const j = await cf('/mods/search', { query: q });
  return {
    total: j.pagination ? j.pagination.totalCount : j.data.length,
    items: j.data.map((m) => ({
      source: 'curseforge',
      id: String(m.id),
      slug: m.slug,
      title: m.name,
      description: m.summary,
      author: (m.authors && m.authors[0] && m.authors[0].name) || '',
      icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || null,
      downloads: m.downloadCount,
      categories: (m.categories || []).map((c) => c.name).slice(0, 4),
      type,
      updated: m.dateModified,
      url: (m.links && m.links.websiteUrl) || `https://www.curseforge.com/minecraft/${m.slug}`,
    })),
  };
}

function simplify(f) {
  const gv = f.gameVersions || [];
  return {
    id: String(f.id),
    name: f.displayName,
    versionNumber: f.fileName,
    type: RELEASE[f.releaseType] || 'release',
    gameVersions: gv.filter((v) => /^\d/.test(v)),
    loaders: gv.filter((v) => !/^\d/.test(v)).map((v) => v.toLowerCase()),
    date: f.fileDate,
    downloads: f.downloadCount,
  };
}

async function rawFiles(modId, { mc, loader, type } = {}) {
  const q = { pageSize: 50 };
  if (mc) q.gameVersion = mc;
  if (mc && loader && type === 'mod' && LOADER[loader]) q.modLoaderType = LOADER[loader];
  const j = await cf(`/mods/${encodeURIComponent(modId)}/files`, { query: q });
  return j.data;
}

async function versions(modId, opts) {
  return (await rawFiles(modId, opts)).map(simplify);
}

async function installFile(inst, modId, f, { type, title, deps = true, task, visited = new Set() }) {
  if (visited.has(String(modId))) return;
  visited.add(String(modId));

  const sub = TYPE_DIR[type];
  const dest = path.join(P.instance(inst.id), sub, f.fileName);
  task.update({ detail: f.fileName });

  for (const old of instances.findContentByProject(inst.id, 'curseforge', modId)) {
    try { instances.removeContent(inst.id, old); } catch { /* ignore */ }
    try { instances.removeContent(inst.id, old + '.disabled'); } catch { /* ignore */ }
  }

  const sha1 = ((f.hashes || []).find((h) => h.algo === 1) || {}).value;
  await download(f.downloadUrl || cdnUrl(f), dest, { sha1 });
  instances.recordContent(inst.id, `${sub}/${f.fileName}`, {
    source: 'curseforge', projectId: String(modId), versionId: String(f.id), title: title || f.displayName, type,
  });

  if (!deps) return;
  for (const dep of f.dependencies || []) {
    if (dep.relationType !== 3 || visited.has(String(dep.modId))) continue; // 3 = обязательная зависимость
    try {
      const mod = (await cf(`/mods/${dep.modId}`)).data;
      if (CLASS_TYPE[mod.classId] !== 'mod') continue;
      const files = await rawFiles(dep.modId, { mc: inst.mc, loader: inst.loader === 'vanilla' ? null : inst.loader, type: 'mod' });
      if (files[0]) await installFile(inst, dep.modId, files[0], { type: 'mod', title: mod.name, deps: true, task, visited });
    } catch (e) {
      task.update({ detail: `Зависимость не установлена: ${e.message}` });
    }
  }
}

async function installProject(instId, { projectId, versionId, type, title, deps = true }, task) {
  const inst = instances.get(instId);
  if (!inst) throw new Error('Сборка не найдена');
  const f = (await cf(`/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(versionId)}`)).data;
  await installFile(inst, projectId, f, { type, title, deps, task });
}

// ---------- сборки (zip с manifest.json) ----------

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function importZip(file, { task, name, icon, source }) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(file);
  const mEntry = zip.getEntry('manifest.json');
  if (!mEntry) throw new Error('Это не сборка CurseForge: нет manifest.json');
  const man = JSON.parse(zip.readAsText(mEntry));
  const mc = man.minecraft && man.minecraft.version;
  if (!mc) throw new Error('В сборке не указана версия Minecraft');

  const ml = (man.minecraft.modLoaders || []);
  const primary = ml.find((l) => l.primary) || ml[0];
  let loader = 'vanilla'; let loaderVersion = '';
  if (primary) {
    const i = primary.id.indexOf('-');
    loader = primary.id.slice(0, i);
    loaderVersion = primary.id.slice(i + 1);
    if (!['fabric', 'quilt', 'forge', 'neoforge'].includes(loader)) { loader = 'vanilla'; loaderVersion = ''; }
  }

  const inst = instances.create({ name: name || man.name, mc, loader, loaderVersion, icon, source });
  const dir = P.instance(inst.id);

  const entries = (man.files || []).filter((x) => x.required !== false);
  task.update({ detail: 'Получение списка файлов…', progress: 0 });

  const fileInfo = new Map();
  for (const part of chunk(entries.map((e) => e.fileID), 100)) {
    const r = await cf('/mods/files', { method: 'POST', body: { fileIds: part } });
    for (const f of r.data) fileInfo.set(f.id, f);
  }
  const classOf = new Map();
  for (const part of chunk([...new Set(entries.map((e) => e.projectID))], 100)) {
    const r = await cf('/mods', { method: 'POST', body: { modIds: part } });
    for (const m of r.data) classOf.set(m.id, { classId: m.classId, name: m.name });
  }

  let done = 0;
  const failed = [];
  await pool(entries, 8, async (e) => {
    try {
      const f = fileInfo.get(e.fileID);
      if (!f) throw new Error(`файл ${e.fileID} не найден в CurseForge`);
      const meta = classOf.get(e.projectID) || {};
      const type = CLASS_TYPE[meta.classId] || 'mod';
      const sub = TYPE_DIR[type] || 'mods';
      const dest = path.join(dir, sub, f.fileName);
      const sha1 = ((f.hashes || []).find((h) => h.algo === 1) || {}).value;
      await download(f.downloadUrl || cdnUrl(f), dest, { sha1 });
      instances.recordContent(inst.id, `${sub}/${f.fileName}`, {
        source: 'curseforge', projectId: String(e.projectID), versionId: String(e.fileID), title: meta.name || f.displayName, type,
      });
    } catch (err) {
      failed.push(`${e.projectID}/${e.fileID}: ${err.message}`);
    }
    done++;
    task.update({ detail: `Файлов: ${done}/${entries.length}`, progress: done / (entries.length || 1) });
  });

  const prefix = (man.overrides || 'overrides').replace(/\/?$/, '/');
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const dest = P.safeJoin(dir, entry.entryName.slice(prefix.length));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
  }

  return { instance: inst, failed };
}

async function downloadPack(modId, fileId, task) {
  const f = (await cf(`/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`)).data;
  const dest = path.join(P.cache, `cf-${fileId}.zip`);
  task.update({ detail: 'Загрузка сборки…', progress: 0 });
  const sha1 = ((f.hashes || []).find((h) => h.algo === 1) || {}).value;
  await download(f.downloadUrl || cdnUrl(f), dest, {
    sha1,
    onProgress: (g, t) => task.update({ progress: t ? g / t : null }),
  });
  return dest;
}

module.exports = { search, versions, installProject, importZip, downloadPack };
