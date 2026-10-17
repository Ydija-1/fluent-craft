'use strict';
/**
 * Подготовка и запуск игры. Скачивание клиента, библиотек и ассетов выполняет minecraft-launcher-core,
 * остальное (Java, загрузчики модов) — модули лаунчера.
 */
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const { getConfig } = require('./store');
const { ensureJava } = require('./java');
const { installLoader, ensureVanillaJson } = require('./loaders');
const instances = require('./instances');
const { readJson } = require('./store');

const running = new Map(); // instanceId -> { proc }

function isRunning(id) { return running.has(id); }
function runningIds() { return [...running.keys()]; }

function stop(id) {
  const r = running.get(id);
  if (r && r.proc) { try { r.proc.kill(); } catch { /* ignore */ } }
}

/** "-Dfoo=bar -Xss1M" → ["-Dfoo=bar", "-Xss1M"], кавычки учитываются. */
function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function javaMajor(vanilla, custom) {
  const a = vanilla && vanilla.javaVersion && vanilla.javaVersion.majorVersion;
  const b = custom && custom.javaVersion && custom.javaVersion.majorVersion;
  return Math.max(a || 8, b || 0);
}

async function launch(inst, account, { task, log, onExit }) {
  if (running.has(inst.id)) throw new Error('Эта сборка уже запущена');
  if (!account) throw new Error('Не выбран аккаунт');
  const cfg = getConfig();

  // 1. описание версии → нужная версия Java
  task.update({ detail: 'Проверка версии Minecraft…', progress: null });
  const vanilla = await ensureVanillaJson(inst.mc);

  // 2. временная Java для установщиков (Forge/NeoForge), затем загрузчик
  let customJson = null;
  let javaForInstall = null;
  if (inst.loader === 'forge' || inst.loader === 'neoforge') {
    javaForInstall = await ensureJava(javaMajor(vanilla, null), (s) => task.update(s));
  }
  const loader = await installLoader(inst, javaForInstall && javaForInstall.java, (s) => task.update(s));
  if (loader.customId) {
    instances.update(inst.id, { customVersionId: loader.customId });
    customJson = readJson(path.join(P.mc, 'versions', loader.customId, `${loader.customId}.json`), null);
  }

  // 3. Java
  const java = javaForInstall && javaMajor(vanilla, customJson) === javaMajor(vanilla, null)
    ? javaForInstall
    : await ensureJava(javaMajor(vanilla, customJson), (s) => task.update(s));

  // 4. запуск через minecraft-launcher-core
  const { Client } = require('minecraft-launcher-core');
  const client = new Client();
  const dir = P.instance(inst.id);
  const maxMb = inst.memory || cfg.memoryMax || 4096;

  const opts = {
    authorization: {
      access_token: '0',
      client_token: '0',
      uuid: account.uuid,
      name: account.name,
      user_properties: '{}',
      meta: { type: 'mojang', demo: false },
    },
    root: P.mc,
    version: {
      number: inst.mc,
      type: vanilla.type || 'release',
      ...(loader.customId ? { custom: loader.customId } : {}),
    },
    ...(loader.forgeJar ? { forge: loader.forgeJar } : {}),
    javaPath: java.javaw,
    memory: { max: `${maxMb}M`, min: `${Math.min(1024, maxMb)}M` },
    customArgs: [...splitArgs(cfg.jvmArgs), ...splitArgs(inst.jvmArgs)],
    overrides: { gameDirectory: dir, cwd: dir, detached: false },
  };

  task.update({ detail: 'Загрузка файлов игры…', progress: null });

  client.on('debug', (e) => log(`[лаунчер] ${e}`));
  client.on('data', (e) => log(String(e).replace(/\r?\n$/, '')));
  client.on('progress', (e) => {
    if (e && e.total) {
      task.update({ detail: `Загрузка: ${e.type || ''}`, progress: Math.min(1, (e.task || 0) / e.total) });
    }
  });
  client.on('package-extract', () => task.update({ detail: 'Распаковка…', progress: null }));
  client.on('arguments', () => task.done('Игра запущена'));
  client.on('close', (code) => {
    running.delete(inst.id);
    instances.update(inst.id, { lastPlayed: Date.now() });
    log(`[лаунчер] Игра завершилась с кодом ${code}`);
    onExit(code);
  });

  const proc = await client.launch(opts);
  if (!proc) {
    throw new Error('Не удалось запустить игру — подробности на вкладке «Журнал»');
  }
  running.set(inst.id, { proc });
  return true;
}

module.exports = { launch, stop, isRunning, runningIds };
