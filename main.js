'use strict';
const { app, BrowserWindow, nativeTheme, shell } = require('electron');
const path = require('path');
const os = require('os');

const isWin = process.platform === 'win32';
const isWin11 = isWin && parseInt(os.release().split('.')[2] || '0', 10) >= 22000;

const editionInfo = require('./src/main/edition');
// Dev и обычная версии не делят ни данные, ни блокировку единственного экземпляра — можно запускать одновременно
app.setPath('userData', path.join(app.getPath('appData'), editionInfo.dataDirName, 'electron'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const P = require('./src/main/paths');
const { getConfig } = require('./src/main/store');
const tasks = require('./src/main/tasks');
const ipc = require('./src/main/ipc');

let mainWindow = null;

const BG = { dark: '#202020', light: '#f3f3f3' };

function symbolColor() { return nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1a1a1a'; }

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  const opts = {
    width: 1220,
    height: 780,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: editionInfo.title,
    // Для Mica фон должен быть прозрачным; на других системах — обычный сплошной цвет
    backgroundColor: isWin11 ? '#00000000' : (dark ? BG.dark : BG.light),
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  };
  if (isWin) {
    opts.titleBarOverlay = { color: '#00000000', symbolColor: symbolColor(), height: 40 };
  }
  if (isWin11) opts.backgroundMaterial = 'mica';

  mainWindow = new BrowserWindow(opts);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: { mica: isWin11 ? '1' : '0', platform: process.platform, edition: editionInfo.edition },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Внешние ссылки открываем в браузере, а не внутри лаунчера
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  // Ctrl+Shift+I или F12 — консоль разработчика (на случай, если что-то не работает)
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
    }
    // Ctrl+R / F5 — перезагрузка интерфейса (удобно при правке renderer/), только в режиме разработчика
    if ((input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) && (editionInfo.isDev || getConfig().devMode)) {
      mainWindow.webContents.reload();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  P.init(path.join(app.getPath('appData'), editionInfo.dataDirName));
  ipc.applyTheme(getConfig().theme);
  tasks.setSender((channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  });
  ipc.register();
  createWindow();

  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (isWin) mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: symbolColor(), height: 40 });
    if (!isWin11) mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? BG.dark : BG.light);
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
