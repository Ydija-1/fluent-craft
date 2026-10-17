'use strict';
/**
 * Редакция приложения: обычная (stable) или для разработчиков (dev).
 * Dev включается переменной FLUENTCRAFT_DEV=1 (npm run start:dev)
 * или полем "edition": "dev" в package.json собранной Dev-версии.
 */
const pkg = require('../../package.json');

const isDev = process.env.FLUENTCRAFT_DEV === '1' || pkg.edition === 'dev';

module.exports = {
  isDev,
  edition: isDev ? 'dev' : 'stable',
  dataDirName: isDev ? 'FluentCraft-Dev' : 'FluentCraft',
  title: isDev ? 'FluentCraft Launcher Dev' : 'FluentCraft Launcher',
};
