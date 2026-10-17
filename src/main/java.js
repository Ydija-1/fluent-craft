'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const P = require('./paths');
const { getConfig } = require('./store');
const { download } = require('./net');

const isWin = process.platform === 'win32';

function adoptiumTarget() {
  const osName = isWin ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return { osName, arch };
}

/** Ищет bin/java(.exe) внутри распакованного JRE (до 4 уровней вглубь). */
function findJava(dir, depth = 0) {
  if (!fs.existsSync(dir) || depth > 4) return null;
  const bin = path.join(dir, 'bin');
  const exe = path.join(bin, isWin ? 'java.exe' : 'java');
  if (fs.existsSync(exe)) {
    const w = path.join(bin, 'javaw.exe');
    return { java: exe, javaw: isWin && fs.existsSync(w) ? w : exe };
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const r = findJava(path.join(dir, e.name), depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Возвращает пути к java для нужной major-версии.
 * Если пользователь указал свой путь — используется он. Иначе JRE от Adoptium
 * скачивается один раз в папку лаунчера.
 */
async function ensureJava(major, onStatus = () => {}) {
  const cfg = getConfig();
  if (cfg.javaPath && fs.existsSync(cfg.javaPath)) {
    return { java: cfg.javaPath, javaw: cfg.javaPath, custom: true };
  }
  const dir = path.join(P.java, `jre-${major}`);
  const found = findJava(dir);
  if (found) return found;

  const { osName, arch } = adoptiumTarget();
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
  const archive = path.join(P.cache, `jre-${major}.${isWin ? 'zip' : 'tar.gz'}`);

  onStatus({ detail: `Загрузка Java ${major}…`, progress: 0 });
  await download(url, archive, {
    onProgress: (got, total) => onStatus({ detail: `Загрузка Java ${major}…`, progress: total ? got / total : null }),
  });

  onStatus({ detail: `Распаковка Java ${major}…`, progress: null });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (isWin) {
    const AdmZip = require('adm-zip');
    new AdmZip(archive).extractAllTo(dir, true);
  } else {
    const r = spawnSync('tar', ['-xzf', archive, '-C', dir]);
    if (r.status !== 0) throw new Error('Не удалось распаковать Java (нужна утилита tar)');
  }
  try { fs.unlinkSync(archive); } catch { /* ignore */ }

  const res = findJava(dir);
  if (!res) throw new Error(`Java ${major} скачана, но исполняемый файл не найден`);
  return res;
}

function systemMemoryMb() { return Math.floor(os.totalmem() / 1024 / 1024); }

module.exports = { ensureJava, findJava, systemMemoryMb };
