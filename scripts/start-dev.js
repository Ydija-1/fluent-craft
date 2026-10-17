'use strict';
// Запуск Dev-редакции: npm run start:dev (работает одинаково на Windows, macOS и Linux)
const { spawn } = require('child_process');
const electron = require('electron'); // в Node это путь к исполняемому файлу Electron

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, FLUENTCRAFT_DEV: '1' },
});
child.on('exit', (code) => process.exit(code === null ? 1 : code));
