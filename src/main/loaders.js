'use strict';
/**
 * Версии Minecraft и установка загрузчиков модов: Fabric, Quilt, Forge, NeoForge.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const P = require('./paths');
const { readJson, writeJson } = require('./store');
const { fetchJson, download } = require('./net');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

const memo = new Map();
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  memo.set(key, { t: Date.now(), v });
  return v;
}

const HOUR = 3600 * 1000;

function getManifest() {
  return cached('manifest', HOUR, () => fetchJson(MANIFEST_URL));
}

async function mcVersions({ snapshots = false } = {}) {
  const m = await getManifest();
  return m.versions
    .filter((v) => snapshots || v.type === 'release')
    .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
}

/** Минорная версия: "1.20.4" → 20. Для новой схемы версий (26.x и т.п.) возвращает 99. */
function mcMinor(mc) {
  const m = /^1\.(\d+)/.exec(mc);
  return m ? parseInt(m[1], 10) : 99;
}

/** Гарантирует наличие versions/<mc>/<mc>.json и возвращает его содержимое. */
async function ensureVanillaJson(mc) {
  const file = path.join(P.mc, 'versions', mc, `${mc}.json`);
  const local = readJson(file, null);
  if (local) return local;
  const m = await getManifest();
  const entry = m.versions.find((v) => v.id === mc);
  if (!entry) throw new Error(`Версия Minecraft ${mc} не найдена`);
  const json = await fetchJson(entry.url);
  writeJson(file, json);
  return json;
}

// ---------- список версий загрузчиков ----------

async function fabricLike(base, mc) {
  const list = await cached(`${base}:${mc}`, HOUR, () => fetchJson(`${base}/versions/loader/${encodeURIComponent(mc)}`));
  return list.map((x) => ({ version: x.loader.version, stable: x.loader.stable !== false }));
}

async function forgeVersions(mc) {
  const meta = await cached('forge-meta', HOUR, () =>
    fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'));
  const all = meta[mc] || [];
  return all
    .map((full) => full.startsWith(mc + '-') ? full.slice(mc.length + 1) : full)
    .reverse()
    .map((v, i) => ({ version: v, stable: i === 0 || undefined }));
}

function neoforgePrefix(mc) {
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(mc);
  if (m) return `${m[1]}.${m[2] || 0}.`;
  return mc + '.';
}

async function neoforgeVersions(mc) {
  if (mc === '1.20.1') {
    const j = await cached('neo-legacy', HOUR, () =>
      fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge'));
    return (j.versions || []).filter((v) => v.startsWith('1.20.1-')).reverse()
      .map((v) => ({ version: v, stable: true }));
  }
  const j = await cached('neo', HOUR, () =>
    fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'));
  const prefix = neoforgePrefix(mc);
  return (j.versions || []).filter((v) => v.startsWith(prefix)).reverse()
    .map((v) => ({ version: v, stable: !/beta|alpha|rc/i.test(v) }));
}

async function loaderVersions(loader, mc) {
  switch (loader) {
    case 'fabric': return fabricLike('https://meta.fabricmc.net/v2', mc);
    case 'quilt': return fabricLike('https://meta.quiltmc.org/v3', mc);
    case 'forge': return forgeVersions(mc);
    case 'neoforge': return neoforgeVersions(mc);
    default: return [];
  }
}

// ---------- установка ----------

function versionDirs() {
  const d = path.join(P.mc, 'versions');
  try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
}

function runInstaller(javaExe, jar, onLine) {
  return new Promise((resolve, reject) => {
    const profiles = path.join(P.mc, 'launcher_profiles.json');
    if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, JSON.stringify({ profiles: {} }));
    const p = spawn(javaExe, ['-jar', jar, '--installClient', P.mc], { cwd: P.mc, windowsHide: true });
    let tail = '';
    const feed = (b) => {
      const s = b.toString();
      tail = (tail + s).slice(-2000);
      s.split(/\r?\n/).filter(Boolean).forEach(onLine);
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Установщик завершился с кодом ${code}\n${tail}`)));
  });
}

/**
 * Устанавливает загрузчик для сборки.
 * Возвращает { customId } — id версии в versions/, либо { forgeJar } для старых Forge (<1.13),
 * либо {} для чистого Minecraft.
 */
async function installLoader(inst, javaExe, onStatus = () => {}) {
  const { loader, mc, loaderVersion } = inst;
  if (!loader || loader === 'vanilla') return {};

  const existing = inst.customVersionId;
  if (existing && fs.existsSync(path.join(P.mc, 'versions', existing, `${existing}.json`))) {
    return { customId: existing };
  }

  if (loader === 'fabric' || loader === 'quilt') {
    const base = loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
    onStatus({ detail: `Установка ${loader === 'fabric' ? 'Fabric' : 'Quilt'} ${loaderVersion}…` });
    const profile = await fetchJson(`${base}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/profile/json`);
    const id = profile.id;
    writeJson(path.join(P.mc, 'versions', id, `${id}.json`), profile);
    return { customId: id };
  }

  // Forge / NeoForge
  let url; let name;
  if (loader === 'forge') {
    const full = `${mc}-${loaderVersion}`;
    url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
    name = `forge-${full}-installer.jar`;
  } else if (mc === '1.20.1') {
    url = `https://maven.neoforged.net/releases/net/neoforged/forge/${loaderVersion}/forge-${loaderVersion}-installer.jar`;
    name = `neoforge-legacy-${loaderVersion}-installer.jar`;
  } else {
    url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
    name = `neoforge-${loaderVersion}-installer.jar`;
  }

  const jar = path.join(P.cache, name);
  onStatus({ detail: `Загрузка установщика ${loader}…`, progress: 0 });
  await download(url, jar, { onProgress: (g, t) => onStatus({ progress: t ? g / t : null }) });

  // Старые Forge (до 1.13) запускает сам minecraft-launcher-core
  if (loader === 'forge' && mcMinor(mc) < 13) return { forgeJar: jar };

  onStatus({ detail: `Установка ${loader} ${loaderVersion}…`, progress: null });
  await ensureVanillaJson(mc);
  const before = new Set(versionDirs());
  await runInstaller(javaExe, jar, (line) => onStatus({ detail: line.slice(0, 120) }));
  const after = versionDirs();
  const fresh = after.filter((d) => !before.has(d));
  const id = fresh.find((d) => /forge/i.test(d)) || after.find((d) => d.includes(loaderVersion) && /forge/i.test(d));
  if (!id) throw new Error('Установщик отработал, но версия загрузчика не найдена в папке versions');
  return { customId: id };
}

module.exports = { mcVersions, loaderVersions, installLoader, ensureVanillaJson, mcMinor };
