'use strict';
const path = require('path');
const fs = require('fs');

let root = null;

function init(base) {
  root = base;
  for (const d of ['minecraft', 'instances', 'java', 'cache']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
}

function need() {
  if (!root) throw new Error('paths.init() не вызван');
  return root;
}

module.exports = {
  init,
  get root() { return need(); },
  get mc() { return path.join(need(), 'minecraft'); },
  get instances() { return path.join(need(), 'instances'); },
  get java() { return path.join(need(), 'java'); },
  get cache() { return path.join(need(), 'cache'); },
  config: () => path.join(need(), 'config.json'),
  accounts: () => path.join(need(), 'accounts.json'),
  instance: (id) => path.join(need(), 'instances', id),
};

/** Склеивает путь внутри base и запрещает выход за его пределы (защита от zip-slip). */
module.exports.safeJoin = function safeJoin(base, rel) {
  const b = path.resolve(base);
  const full = path.resolve(b, rel);
  if (full !== b && !full.startsWith(b + path.sep)) {
    throw new Error('Недопустимый путь: ' + rel);
  }
  return full;
};
