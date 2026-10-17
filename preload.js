'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/** Все вызовы возвращают { ok, data } / { ok:false, error } — здесь превращаем это в обычные промисы. */
async function call(channel, arg) {
  const res = await ipcRenderer.invoke(channel, arg);
  if (res && res.ok) return res.data;
  const err = new Error((res && res.error) || 'Неизвестная ошибка');
  if (res && res.code) err.code = res.code;
  throw err;
}

const EVENTS = ['task:update', 'game:log', 'game:state', 'inst:changed', 'theme:changed'];

contextBridge.exposeInMainWorld('api', {
  invoke: call,
  on(channel, cb) {
    if (!EVENTS.includes(channel)) throw new Error('Неизвестное событие: ' + channel);
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
