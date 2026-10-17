'use strict';
// Быстрая самопроверка без Electron: синтаксис + логика модулей, которым не нужны внешние пакеты.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const assert = require('assert');

const root = path.join(__dirname, '..');
const files = ['main.js', 'preload.js', ...fs.readdirSync(path.join(root, 'src/main')).map((f) => 'src/main/' + f),
  ...fs.readdirSync(path.join(root, 'renderer')).filter((f) => f.endsWith('.js')).map((f) => 'renderer/' + f)];
for (const f of files) execFileSync(process.execPath, ['--check', path.join(root, f)]);
console.log(`синтаксис: ${files.length} файлов — ок`);

(async () => {
  const P = require('../src/main/paths');
  P.init(fs.mkdtempSync(path.join(os.tmpdir(), 'fc-')));

  // оффлайн UUID должен совпадать с тем, что считает сам Minecraft
  const acc = require('../src/main/accounts');
  assert.strictEqual(acc.offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
  assert.throws(() => acc.add('a'), /Ник/);
  assert.throws(() => acc.add('имя'), /Ник/);
  let d = acc.add('Steve_2026');
  assert.strictEqual(d.selected, d.accounts[0].id);
  assert.throws(() => acc.add('steve_2026'), /уже есть/);
  d = acc.add('Alex');
  d = acc.remove(d.accounts[0].id);
  assert.strictEqual(d.accounts.length, 1);
  console.log('аккаунты — ок');

  // защита от zip-slip
  assert.throws(() => P.safeJoin('/a/b', '../c'), /Недопустимый/);
  assert.ok(P.safeJoin('/a/b', 'mods/x.jar').endsWith(path.join('mods', 'x.jar')));

  // сборки и контент
  const inst = require('../src/main/instances');
  const i = inst.create({ name: 'Моя сборка', mc: '1.21.1', loader: 'fabric', loaderVersion: '0.16.5' });
  assert.ok(/^instance-[0-9a-f]{4}$/.test(i.id) || /^[a-z0-9-]+$/.test(i.id));
  fs.writeFileSync(path.join(P.instance(i.id), 'mods', 'sodium.jar'), 'x');
  inst.recordContent(i.id, 'mods/sodium.jar', { source: 'modrinth', projectId: 'AANobbMI', title: 'Sodium' });
  let list = inst.listContent(i.id, 'mod');
  assert.strictEqual(list[0].title, 'Sodium');
  inst.toggleContent(i.id, 'mods/sodium.jar');
  list = inst.listContent(i.id, 'mod');
  assert.ok(list[0].disabled && list[0].title === 'Sodium');
  inst.toggleContent(i.id, 'mods/sodium.jar.disabled');
  assert.ok(!inst.listContent(i.id, 'mod')[0].disabled);
  assert.throws(() => inst.toggleContent(i.id, '../../etc/passwd'), /Недопустимый/);
  assert.deepStrictEqual(inst.findContentByProject(i.id, 'modrinth', 'AANobbMI'), ['mods/sodium.jar']);
  inst.removeContent(i.id, 'mods/sodium.jar');
  assert.strictEqual(inst.listContent(i.id, 'mod').length, 0);
  assert.throws(() => inst.create({ name: 'x', mc: '1.21', loader: 'forge' }), /загрузчика/);
  inst.remove(i.id);
  assert.strictEqual(inst.list().length, 0);
  console.log('сборки и контент — ок');

  // загрузка файлов: хеш, повтор, пул
  const net = require('../src/main/net');
  const body = crypto.randomBytes(300000);
  const sha1 = crypto.createHash('sha1').update(body).digest('hex');
  let hits = 0;
  const srv = http.createServer((req, res) => { hits++; res.setHeader('content-length', body.length); res.end(body); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/f.jar`;
  const dest = path.join(P.cache, 'f.jar');
  let seen = 0;
  await net.download(url, dest, { sha1, onProgress: (g) => { seen = g; } });
  assert.strictEqual(seen, body.length);
  await net.download(url, dest, { sha1 }); // уже скачан — второй запрос не нужен
  assert.strictEqual(hits, 1);
  await assert.rejects(net.download(url, path.join(P.cache, 'bad.jar'), { sha1: '0'.repeat(40), retries: 0 }), /Хеш/);
  assert.ok(!fs.existsSync(path.join(P.cache, 'bad.jar')) && !fs.existsSync(path.join(P.cache, 'bad.jar.part')));
  let active = 0; let peak = 0;
  await net.pool(Array.from({ length: 20 }, (_, k) => k), 4, async () => { active++; peak = Math.max(peak, active); await net.sleep(5); active--; });
  assert.ok(peak <= 4);
  srv.close();
  console.log('загрузка файлов — ок');

  console.log('\nВсе проверки пройдены.');
})().catch((e) => { console.error('ПРОВАЛ:', e); process.exit(1); });
