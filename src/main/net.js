'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const UA = 'FluentCraftLauncher/1.0.0 (desktop launcher)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, { headers = {}, method = 'GET', body, retries = 2, timeout = 30000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'User-Agent': UA, ...headers },
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} (${new URL(url).host})`);
        await sleep(600 * (i + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr || new Error('Сетевая ошибка');
}

async function fetchJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} (${new URL(url).host})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function hashFile(file, algo = 'sha1') {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/**
 * Скачивает файл во временный *.part, проверяет хеш и переименовывает.
 * Если файл уже есть и хеш совпадает — ничего не делает.
 */
async function download(url, dest, { sha1, onProgress, retries = 2 } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (sha1 && fs.existsSync(dest)) {
    try { if ((await hashFile(dest)) === sha1.toLowerCase()) return dest; } catch { /* перекачаем */ }
  }
  const tmp = dest + '.part';
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await request(url, { retries: 0, timeout: 120000 });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} при загрузке ${path.basename(dest)}`);
      const total = Number(res.headers.get('content-length')) || 0;
      let got = 0;
      const src = Readable.fromWeb(res.body);
      src.on('data', (c) => { got += c.length; if (onProgress) onProgress(got, total); });
      await pipeline(src, fs.createWriteStream(tmp));
      if (sha1) {
        const actual = await hashFile(tmp);
        if (actual !== sha1.toLowerCase()) throw new Error(`Хеш не совпал: ${path.basename(dest)}`);
      }
      fs.renameSync(tmp, dest);
      return dest;
    } catch (e) {
      lastErr = e;
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

/** Выполняет worker для каждого элемента не более чем в `limit` потоков. */
async function pool(items, limit, worker) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

module.exports = { UA, request, fetchJson, download, hashFile, pool, sleep };
