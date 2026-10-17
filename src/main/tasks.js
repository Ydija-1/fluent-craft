'use strict';
const crypto = require('crypto');

let send = () => {};
const tasks = new Map();

function setSender(fn) { send = fn; }

/** Фоновая задача, прогресс которой виден во всплывающей панели. */
function createTask(title) {
  const t = { id: crypto.randomUUID(), title, status: 'running', progress: null, detail: '' };
  tasks.set(t.id, t);
  send('task:update', { ...t });
  const push = () => send('task:update', { ...t });
  return {
    id: t.id,
    update(patch) { Object.assign(t, patch); push(); },
    done(detail) { Object.assign(t, { status: 'done', progress: 1, detail: detail || '' }); push(); },
    fail(err) {
      Object.assign(t, { status: 'error', detail: err && err.message ? err.message : String(err) });
      push();
    },
  };
}

module.exports = { createTask, setSender };
