'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const { fetchJson, download, pool } = require('./net');
const instances = require('./instances');

const API = 'https://api.modrinth.com/v2';

// Хосты, с которых по спецификации .mrpack разрешено качать файлы сборок
const ALLOWED_HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'];

const TYPE_DIR = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };

function loaderList(loader) {
  if (loader === 'quilt') return ['quilt', 'fabric']; // Quilt запускает и Fabric-моды
  return loader ? [loader] : [];
}

async function search({ type = 'mod', query = '', mc, loader, sort = 'relevance', offset = 0, limit = 20 }) {
  const facets = [[`project_type:${type}`]];
  if (mc) facets.push([`versions:${mc}`]);
  if (loader && (type === 'mod' || type === 'modpack')) facets.push([`categories:${loader}`]);
  const qs = new URLSearchParams({
    query, facets: JSON.stringify(facets), limit: String(limit), offset: String(offset), index: sort,
  });
  const j = await fetchJson(`${API}/search?${qs}`);
  return {
    total: j.total_hits,
    items: j.hits.map((h) => ({
      source: 'modrinth',
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      icon: h.icon_url || null,
      downloads: h.downloads,
      categories: (h.display_categories || h.categories || []).slice(0, 4),
      type: h.project_type,
      updated: h.date_modified,
      url: `https://modrinth.com/${h.project_type}/${h.slug}`,
    })),
  };
}

function simplify(v) {
  return {
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    type: v.version_type, // release | beta | alpha
    gameVersions: v.game_versions,
    loaders: v.loaders,
    date: v.date_published,
    downloads: v.downloads,
  };
}

async function rawVersions(projectId, { mc, loader, type } = {}) {
  const q = new URLSearchParams();
  if (type === 'mod' && loader) q.set('loaders', JSON.stringify(loaderList(loader)));
  if (mc) q.set('game_versions', JSON.stringify([mc]));
  const qs = q.toString();
  return fetchJson(`${API}/project/${encodeURIComponent(projectId)}/version${qs ? '?' + qs : ''}`);
}

async function versions(projectId, opts) {
  return (await rawVersions(projectId, opts)).map(simplify);
}

function primaryFile(v) {
  const f = v.files.find((x) => x.primary) || v.files[0];
  if (!f) throw new Error('У версии нет файлов');
  return f;
}

/** Ставит одну версию в сборку (+ обязательные зависимости). */
async function installVersion(inst, v, { type, title, deps = true, task, visited = new Set() }) {
  if (visited.has(v.project_id)) return;
  visited.add(v.project_id);

  const sub = TYPE_DIR[type];
  const f = primaryFile(v);
  const dest = path.join(P.instance(inst.id), sub, f.filename);
  task.update({ detail: f.filename });

  // Если тот же проект уже стоял в другой версии — удаляем старый файл
  for (const old of instances.findContentByProject(inst.id, 'modrinth', v.project_id)) {
    try { instances.removeContent(inst.id, old); } catch { /* ignore */ }
    try { instances.removeContent(inst.id, old + '.disabled'); } catch { /* ignore */ }
  }

  await download(f.url, dest, { sha1: f.hashes && f.hashes.sha1 });
  instances.recordContent(inst.id, `${sub}/${f.filename}`, {
    source: 'modrinth', projectId: v.project_id, versionId: v.id, title: title || v.name, type,
  });

  if (!deps) return;
  for (const dep of v.dependencies || []) {
    if (dep.dependency_type !== 'required' || !dep.project_id || visited.has(dep.project_id)) continue;
    try {
      const proj = await fetchJson(`${API}/project/${encodeURIComponent(dep.project_id)}`);
      const depType = proj.project_type === 'mod' ? 'mod' : null;
      if (!depType) continue;
      let dv;
      if (dep.version_id) {
        dv = await fetchJson(`${API}/version/${encodeURIComponent(dep.version_id)}`);
      } else {
        const all = await rawVersions(dep.project_id, { mc: inst.mc, loader: inst.loader === 'vanilla' ? null : inst.loader, type: 'mod' });
        dv = all[0];
      }
      if (dv) await installVersion(inst, dv, { type: 'mod', title: proj.title, deps: true, task, visited });
    } catch (e) {
      task.update({ detail: `Зависимость не установлена: ${e.message}` });
    }
  }
}

async function installProject(instId, { projectId, versionId, type, title, deps = true }, task) {
  const inst = instances.get(instId);
  if (!inst) throw new Error('Сборка не найдена');
  const v = await fetchJson(`${API}/version/${encodeURIComponent(versionId)}`);
  await installVersion(inst, v, { type, title, deps, task });
  void projectId;
}

// ---------- сборки (.mrpack) ----------

function parseLoader(deps) {
  if (deps['fabric-loader']) return { loader: 'fabric', loaderVersion: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { loader: 'quilt', loaderVersion: deps['quilt-loader'] };
  if (deps.neoforge) return { loader: 'neoforge', loaderVersion: deps.neoforge };
  if (deps.forge) return { loader: 'forge', loaderVersion: deps.forge };
  return { loader: 'vanilla', loaderVersion: '' };
}

async function importMrpack(file, { task, name, icon, source }) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(file);
  const idxEntry = zip.getEntry('modrinth.index.json');
  if (!idxEntry) throw new Error('Это не сборка Modrinth: нет modrinth.index.json');
  const idx = JSON.parse(zip.readAsText(idxEntry));
  const deps = idx.dependencies || {};
  if (!deps.minecraft) throw new Error('В сборке не указана версия Minecraft');

  const inst = instances.create({ name: name || idx.name, mc: deps.minecraft, ...parseLoader(deps), icon, source });
  const dir = P.instance(inst.id);

  const files = (idx.files || []).filter((f) => !(f.env && f.env.client === 'unsupported'));
  let done = 0;
  const failed = [];
  task.update({ detail: `Файлов: 0/${files.length}`, progress: 0 });

  await pool(files, 8, async (f) => {
    try {
      const dest = P.safeJoin(dir, f.path);
      const urls = (f.downloads || []).filter((u) => {
        try { return ALLOWED_HOSTS.includes(new URL(u).hostname); } catch { return false; }
      });
      if (!urls.length) throw new Error('нет разрешённого источника');
      let err;
      for (const u of urls) {
        try { await download(u, dest, { sha1: f.hashes && f.hashes.sha1 }); err = null; break; } catch (e) { err = e; }
      }
      if (err) throw err;
      if (/^(mods|resourcepacks|shaderpacks)\//.test(f.path)) {
        instances.recordContent(inst.id, f.path, { source: 'modpack', title: path.basename(f.path), projectId: null });
      }
    } catch (e) {
      failed.push(`${f.path}: ${e.message}`);
    }
    done++;
    task.update({ detail: `Файлов: ${done}/${files.length}`, progress: done / (files.length || 1) });
  });

  // overrides / client-overrides
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    for (const prefix of ['overrides/', 'client-overrides/']) {
      if (entry.entryName.startsWith(prefix)) {
        const dest = P.safeJoin(dir, entry.entryName.slice(prefix.length));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.getData());
      }
    }
  }

  return { instance: inst, failed };
}

async function downloadPack(projectId, versionId, task) {
  const v = await fetchJson(`${API}/version/${encodeURIComponent(versionId)}`);
  const f = primaryFile(v);
  const dest = path.join(P.cache, `${versionId}.mrpack`);
  task.update({ detail: 'Загрузка сборки…', progress: 0 });
  await download(f.url, dest, {
    sha1: f.hashes && f.hashes.sha1,
    onProgress: (g, t) => task.update({ progress: t ? g / t : null }),
  });
  void projectId;
  return dest;
}

module.exports = { search, versions, installProject, importMrpack, downloadPack };
