'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const { isDev } = require('./edition');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const DEFAULT_CONFIG = {
  theme: 'system',          // system | light | dark
  memoryMax: 4096,          // МБ по умолчанию
  javaPath: '',             // пусто = скачать подходящую Java автоматически
  jvmArgs: '',
  curseforgeKey: '',
  minimizeOnLaunch: false,
  showSnapshots: false,
  devMode: isDev,           // раздел «Разработка» и подробные журналы
};

let cache = null;

function getConfig() {
  if (!cache) cache = { ...DEFAULT_CONFIG, ...readJson(P.config(), {}) };
  return cache;
}

function setConfig(patch) {
  cache = { ...getConfig(), ...patch };
  writeJson(P.config(), cache);
  return cache;
}

module.exports = { readJson, writeJson, getConfig, setConfig, DEFAULT_CONFIG };
