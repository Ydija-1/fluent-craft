'use strict';
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, nativeTheme, app, BrowserWindow } = require('electron');

const P = require('./paths');
const { getConfig, setConfig } = require('./store');
const accounts = require('./accounts');
const instances = require('./instances');
const loaders = require('./loaders');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const launcher = require('./launch');
const { createTask } = require('./tasks');
const { systemMemoryMb, findJava } = require('./java');
const net = require('./net');
const edition = require('./edition');
const os = require('os');

const SOURCES = { modrinth, curseforge };

/** Обёртка: исключения не пробрасываются как «Error invoking remote method…», а возвращаются чистым текстом. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err), code: err && err.code };
    }
  });
}

function win() { return BrowserWindow.getAllWindows()[0] || null; }
function send(channel, payload) {
  const w = win();
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function applyTheme(theme) {
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';
}

function requireDev() {
  if (!getConfig().devMode && !edition.isDev) throw new Error('Включите режим разработчика в настройках');
}

function diagnostics() {
  const cfg = { ...getConfig() };
  if (cfg.curseforgeKey) cfg.curseforgeKey = '••••' + cfg.curseforgeKey.slice(-4);
  const javas = [];
  try {
    for (const d of fs.readdirSync(P.java, { withFileTypes: true })) {
      if (d.isDirectory() && findJava(path.join(P.java, d.name))) javas.push(d.name);
    }
  } catch { /* папки нет */ }
  const log = net.getNetLog();
  const rows = [
    ['Редакция', edition.edition],
    ['Версия лаунчера', app.getVersion()],
    ['Electron', process.versions.electron],
    ['Chromium', process.versions.chrome],
    ['Node.js', process.versions.node],
    ['Система', `${process.platform} ${process.arch} (${os.release()})`],
    ['Память (всего / свободно), МБ', `${systemMemoryMb()} / ${Math.floor(os.freemem() / 1048576)}`],
    ['Процессор', `${os.cpus().length} × ${(os.cpus()[0] || {}).model || '?'}`],
    ['Папка данных', P.root],
    ['Установленные Java', javas.join(', ') || 'нет'],
    ['Сборок / аккаунтов', `${instances.list().length} / ${accounts.list().accounts.length}`],
    ['Сетевые запросы (ошибок / всего)', `${log.filter((e) => e.status === 0 || e.status >= 400).length} / ${log.length}`],
    ['Настройки', JSON.stringify(cfg)],
  ];
  return { rows, text: rows.map(([k, v]) => `${k}: ${v}`).join('\n') };
}

function failedNote(failed) {
  return failed.length ? `Готово, но не скачано файлов: ${failed.length}` : 'Сборка установлена';
}

function register() {
  // ---------- приложение ----------
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    dataDir: P.root,
    totalMemMb: systemMemoryMb(),
  }));
  handle('app:openExternal', (url) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Разрешены только https-ссылки');
    return shell.openExternal(url);
  });
  handle('app:openDataDir', () => shell.openPath(P.root));
  handle('app:pickJava', async () => {
    const r = await dialog.showOpenDialog(win(), {
      title: 'Выберите java / javaw',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : [],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // ---------- настройки ----------
  handle('cfg:get', () => getConfig());
  handle('cfg:set', (patch) => {
    const cfg = setConfig(patch);
    if ('theme' in patch) {
      applyTheme(cfg.theme);
      send('theme:changed', nativeTheme.shouldUseDarkColors);
    }
    return cfg;
  });

  // ---------- аккаунты ----------
  handle('acc:list', () => accounts.list());
  handle('acc:add', (name) => accounts.add(name));
  handle('acc:remove', (id) => accounts.remove(id));
  handle('acc:select', (id) => accounts.select(id));

  // ---------- версии ----------
  handle('ver:mc', () => loaders.mcVersions({ snapshots: getConfig().showSnapshots }));
  handle('ver:loader', ({ loader, mc }) => loaders.loaderVersions(loader, mc));

  // ---------- сборки ----------
  handle('inst:list', () => ({ list: instances.list(), running: launcher.runningIds() }));
  handle('inst:create', (data) => instances.create(data));
  handle('inst:update', ({ id, patch }) => instances.update(id, patch));
  handle('inst:remove', (id) => {
    if (launcher.isRunning(id)) throw new Error('Сначала остановите игру');
    instances.remove(id);
  });
  handle('inst:folder', (id) => shell.openPath(P.instance(id)));
  handle('inst:content', ({ id, type }) => instances.listContent(id, type));
  handle('inst:toggle', ({ id, rel }) => instances.toggleContent(id, rel));
  handle('inst:removeContent', ({ id, rel }) => instances.removeContent(id, rel));

  handle('inst:launch', async (id) => {
    const inst = instances.get(id);
    if (!inst) throw new Error('Сборка не найдена');
    const account = accounts.getSelected();
    if (!account) {
      const e = new Error('Сначала добавьте аккаунт на вкладке «Аккаунты»');
      e.code = 'NO_ACCOUNT';
      throw e;
    }
    const task = createTask(`Запуск: ${inst.name}`);
    const cfg = getConfig();
    send('game:state', { id, state: 'starting' });
    try {
      await launcher.launch(inst, account, {
        task,
        verbose: !!cfg.devMode,
        log: (line) => send('game:log', { id, line }),
        onExit: (code) => {
          send('game:state', { id, state: 'stopped', code });
          const w = win();
          if (cfg.minimizeOnLaunch && w && !w.isDestroyed()) { w.restore(); w.focus(); }
        },
      });
      send('game:state', { id, state: 'running' });
      const w = win();
      if (cfg.minimizeOnLaunch && w) w.minimize();
    } catch (err) {
      task.fail(err);
      send('game:state', { id, state: 'stopped', code: -1 });
      throw err;
    }
  });
  handle('inst:stop', (id) => launcher.stop(id));

  // ---------- каталог ----------
  handle('browse:search', ({ source, ...q }) => SOURCES[source].search(q));
  handle('browse:versions', ({ source, projectId, mc, loader, type }) =>
    SOURCES[source].versions(projectId, { mc, loader, type }));

  // Установка мода / ресурспака / шейдера в существующую сборку — выполняется в фоне
  handle('browse:install', (args) => {
    const { source, instanceId, title } = args;
    const task = createTask(`Установка: ${title}`);
    (async () => {
      try {
        await SOURCES[source].installProject(instanceId, args, task);
        task.done('Установлено');
        send('inst:changed', { id: instanceId });
      } catch (e) { task.fail(e); }
    })();
    return true;
  });

  // Установка сборки — создаёт новую сборку
  handle('browse:installPack', ({ source, projectId, versionId, title, icon }) => {
    const task = createTask(`Сборка: ${title}`);
    (async () => {
      try {
        const src = { type: source, projectId, versionId };
        let res;
        if (source === 'modrinth') {
          const file = await modrinth.downloadPack(projectId, versionId, task);
          res = await modrinth.importMrpack(file, { task, name: title, icon, source: src });
        } else {
          const file = await curseforge.downloadPack(projectId, versionId, task);
          res = await curseforge.importZip(file, { task, name: title, icon, source: src });
        }
        task.done(failedNote(res.failed));
        send('inst:changed', { id: res.instance.id });
      } catch (e) { task.fail(e); }
    })();
    return true;
  });

  // Импорт локального файла сборки (.mrpack или .zip от CurseForge)
  handle('import:file', async () => {
    const r = await dialog.showOpenDialog(win(), {
      title: 'Импорт сборки',
      properties: ['openFile'],
      filters: [{ name: 'Сборки', extensions: ['mrpack', 'zip'] }],
    });
    if (r.canceled) return false;
    const file = r.filePaths[0];
    const task = createTask(`Импорт: ${path.basename(file)}`);
    (async () => {
      try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(file);
        let res;
        if (zip.getEntry('modrinth.index.json')) res = await modrinth.importMrpack(file, { task, source: null });
        else if (zip.getEntry('manifest.json')) res = await curseforge.importZip(file, { task, source: null });
        else throw new Error('Не удалось определить формат: нет modrinth.index.json или manifest.json');
        task.done(failedNote(res.failed));
        send('inst:changed', { id: res.instance.id });
      } catch (e) { task.fail(e); }
    })();
    return true;
  });

  // ---------- инструменты разработчика ----------
  handle('dev:diagnostics', () => { requireDev(); return diagnostics(); });
  handle('dev:netlog', () => { requireDev(); return net.getNetLog(); });
  handle('dev:devtools', () => { requireDev(); const w = win(); if (w) w.webContents.toggleDevTools(); });
  handle('dev:reload', () => { requireDev(); const w = win(); if (w) w.webContents.reload(); });
  handle('dev:openPath', (what) => {
    requireDev();
    const map = { data: P.root, minecraft: P.mc, java: P.java, cache: P.cache, instances: P.instances };
    if (!map[what]) throw new Error('Неизвестная папка');
    return shell.openPath(map[what]);
  });
  handle('dev:clearCache', () => {
    requireDev();
    let n = 0;
    for (const f of fs.readdirSync(P.cache)) { fs.rmSync(path.join(P.cache, f), { recursive: true, force: true }); n++; }
    return n;
  });
}

module.exports = { register, applyTheme };
