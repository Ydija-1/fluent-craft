'use strict';

const bridge = window.api;
const call = (channel, arg) => bridge.invoke(channel, arg);

const LOADERS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const TYPES = { mod: 'Моды', modpack: 'Сборки', resourcepack: 'Ресурспаки', shader: 'Шейдеры' };
const SOURCES = { modrinth: 'Modrinth', curseforge: 'CurseForge' };
const SORTS = { relevance: 'По релевантности', downloads: 'По загрузкам', updated: 'По обновлению', newest: 'Сначала новые' };

const state = {
  route: 'library',
  cfg: {},
  info: {},
  accounts: { accounts: [], selected: null },
  instances: [],
  running: new Set(),
  starting: new Set(),
  logs: [],
  tasks: new Map(),
  mcVersions: null,
  logBox: null,
  browse: {
    source: 'modrinth', type: 'mod', query: '', mc: '', loader: '', sort: 'relevance',
    items: [], total: 0, loading: false, error: null, token: 0,
  },
};

const view = () => $('#view');
const selectedAccount = () => state.accounts.accounts.find((a) => a.id === state.accounts.selected) || null;
const instLabel = (i) => `${i.mc} · ${LOADERS[i.loader] || i.loader}${i.loaderVersion ? ' ' + i.loaderVersion : ''}`;

async function safe(fn, fallback) {
  try { return await fn(); } catch (e) { toast(e.message, 'err', 6000); return fallback; }
}

// ======================= тема, навигация =======================

function applyTheme() {
  document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const NAV = [
  ['library', 'Библиотека', 'library'],
  ['browse', 'Обзор', 'browse'],
  ['accounts', 'Аккаунты', 'user'],
  ['logs', 'Журнал', 'terminal'],
];

const navList = () => (state.cfg.devMode ? [...NAV, ['dev', 'Разработка', 'code']] : NAV);

function renderNav() {
  const nav = $('#nav');
  const acc = selectedAccount();
  nav.replaceChildren(
    h('button', { class: 'profile', onclick: () => go('accounts'), title: 'Сменить аккаунт' },
      avatar(acc ? acc.name : '?'),
      h('div', { class: 'who' },
        h('b', null, acc ? acc.name : 'Нет аккаунта'),
        h('small', null, acc ? 'Оффлайн-аккаунт' : 'Добавьте, чтобы играть'))),
    ...navList().map(([id, label, ic]) => navItem(id, label, ic)),
    h('div', { class: 'nav-spacer' }),
    navItem('settings', 'Настройки', 'settings'));
}

function navItem(id, label, ic) {
  return h('button', { class: 'nav-item' + (state.route === id ? ' active' : ''), onclick: () => go(id), 'aria-current': state.route === id ? 'page' : null },
    icon(ic, 18), h('span', null, label),
    id === 'library' && state.running.size ? h('i', { class: 'badge-dot', title: 'Игра запущена' }) : null);
}

function go(route) {
  state.route = route;
  renderNav();
  render();
}

function render() {
  const v = view();
  v.className = state.route === 'logs' ? 'fill' : '';
  v.scrollTop = 0;
  state.logBox = null;
  clearInterval(state.devTimer);
  const pages = { library: pageLibrary, browse: pageBrowse, accounts: pageAccounts, logs: pageLogs, settings: pageSettings, dev: pageDev };
  v.replaceChildren(pages[state.route]());
}

function pageHead(title, sub, ...actions) {
  return h('div', { class: 'page-head' }, h('h1', null, title), actions, sub ? h('p', { class: 'sub' }, sub) : null);
}

// ======================= библиотека =======================

function pageLibrary() {
  const root = h('div');
  root.append(pageHead('Библиотека', 'Ваши сборки — у каждой своя версия игры, моды и сохранения.',
    h('button', { class: 'btn', onclick: () => safe(() => call('import:file')) }, icon('import'), 'Импорт сборки'),
    h('button', { class: 'btn accent', onclick: openCreate }, icon('plus'), 'Создать сборку')));

  if (!state.instances.length) {
    root.append(h('div', { class: 'empty' },
      icon('cube', 40),
      h('h3', null, 'Пока нет ни одной сборки'),
      h('p', null, 'Создайте пустую сборку или скачайте готовую из Modrinth и CurseForge.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn accent', onclick: openCreate }, icon('plus'), 'Создать сборку'),
        h('button', { class: 'btn', onclick: () => { state.browse.type = 'modpack'; go('browse'); } }, icon('browse'), 'Найти сборку'))));
    return root;
  }
  root.append(h('div', { class: 'grid' }, state.instances.map(instCard)));
  return root;
}

function instCard(inst) {
  const running = state.running.has(inst.id);
  const starting = state.starting.has(inst.id);
  const cover = h('div', { class: 'cover' },
    inst.icon ? h('img', { src: inst.icon, alt: '', onerror: (e) => e.target.replaceWith(coverCanvas(inst.name + inst.id)) }) : coverCanvas(inst.name + inst.id),
    running ? h('span', { class: 'chip ok state' }, 'Запущена') : null);

  const play = running
    ? h('button', { class: 'btn stopbtn', onclick: () => safe(() => call('inst:stop', inst.id)) }, icon('stop'), 'Остановить')
    : h('button', { class: 'btn accent', disabled: starting, onclick: () => launch(inst) },
      starting ? h('span', { class: 'ring' }) : icon('play'), starting ? 'Запуск…' : 'Играть');

  return h('article', { class: 'inst' },
    cover,
    h('div', { class: 'info' },
      h('b', { title: inst.name }, inst.name),
      h('small', null, instLabel(inst)),
      h('br'),
      h('small', null, inst.lastPlayed ? 'Играли ' + fmtDate(inst.lastPlayed) : 'Ещё не запускалась')),
    h('div', { class: 'acts' },
      play,
      h('button', { class: 'btn icon', title: 'Управление: моды, настройки', 'aria-label': 'Управление', onclick: () => openInstance(inst.id) }, icon('more'))));
}

async function launch(inst) {
  if (!selectedAccount()) {
    toast('Сначала добавьте аккаунт', 'err');
    go('accounts');
    return;
  }
  state.starting.add(inst.id);
  if (state.route === 'library') render();
  pushLog(`[лаунчер] Запуск «${inst.name}» (${instLabel(inst)})`);
  try {
    await call('inst:launch', inst.id);
  } catch (e) {
    pushLog(`[лаунчер] Ошибка запуска: ${e.message}`);
    if (e.code === 'NO_ACCOUNT') go('accounts');
    toast(e.message, 'err', 7000);
  } finally {
    state.starting.delete(inst.id);
    if (state.route === 'library') render();
  }
}

async function reloadInstances() {
  const r = await call('inst:list');
  state.instances = r.list;
  state.running = new Set(r.running);
  renderNav();
  if (state.route === 'library') render();
}

// ----- создание сборки -----

async function ensureMcVersions() {
  if (!state.mcVersions) state.mcVersions = await call('ver:mc');
  return state.mcVersions;
}

async function openCreate() {
  const name = h('input', { class: 'input', placeholder: 'Например, Выживание', maxlength: 40 });
  const mcSel = h('select', { class: 'input', disabled: true }, h('option', null, 'Загрузка…'));
  const ldSel = h('select', { class: 'input' }, Object.entries(LOADERS).map(([k, v]) => h('option', { value: k, selected: k === 'fabric' }, v)));
  const lvSel = h('select', { class: 'input' });
  const lvField = field('Версия загрузчика', lvSel);
  let createBtn = null;
  let token = 0;

  async function refreshLoader() {
    const t = ++token;
    const loader = ldSel.value;
    lvField.hidden = loader === 'vanilla';
    if (loader === 'vanilla') { lvSel.replaceChildren(); if (createBtn) createBtn.disabled = false; return; }
    lvSel.replaceChildren(h('option', null, 'Загрузка…'));
    if (createBtn) createBtn.disabled = true;
    let list = [];
    try { list = await call('ver:loader', { loader, mc: mcSel.value }); } catch (e) { toast(e.message, 'err'); }
    if (t !== token) return;
    if (!list.length) {
      lvSel.replaceChildren(h('option', { value: '' }, `Для ${mcSel.value} нет версий ${LOADERS[loader]}`));
      return;
    }
    lvSel.replaceChildren(...list.map((x, i) => h('option', { value: x.version }, x.version + (i === 0 ? ' (новая)' : x.stable === false ? ' (бета)' : ''))));
    if (createBtn) createBtn.disabled = false;
  }
  mcSel.addEventListener('change', refreshLoader);
  ldSel.addEventListener('change', refreshLoader);

  const dlg = dialog({
    title: 'Новая сборка',
    body: [
      field('Название', name),
      h('div', { class: 'two' }, field('Версия Minecraft', mcSel), field('Загрузчик модов', ldSel)),
      lvField,
      h('p', { class: 'hint' }, 'Нужную Java и файлы игры лаунчер скачает при первом запуске.'),
    ],
    buttons: [
      {
        label: 'Создать', accent: true,
        onclick: async (close, btn) => {
          if (!name.value.trim()) { name.focus(); toast('Введите название сборки', 'err'); return; }
          btn.disabled = true;
          try {
            await call('inst:create', {
              name: name.value, mc: mcSel.value, loader: ldSel.value,
              loaderVersion: ldSel.value === 'vanilla' ? '' : lvSel.value,
            });
            close();
            await reloadInstances();
            toast('Сборка создана', 'ok');
          } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
        },
      },
      { label: 'Отмена' },
    ],
  });
  createBtn = dlg.box.querySelector('.btn.accent');

  try {
    const list = await ensureMcVersions();
    mcSel.replaceChildren(...list.map((v) => h('option', { value: v.id }, v.id + (v.type !== 'release' ? ` (${v.type})` : ''))));
    mcSel.disabled = false;
    refreshLoader();
  } catch (e) {
    mcSel.replaceChildren(h('option', null, 'Не удалось загрузить список'));
    toast('Не удалось получить список версий: ' + e.message, 'err');
  }
}

// ----- управление сборкой -----

function openInstance(id) {
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  let tab = 'mod';
  const TABS = [['mod', 'Моды'], ['resourcepack', 'Ресурспаки'], ['shader', 'Шейдеры'], ['settings', 'Настройки']];
  const pivot = h('div', { class: 'pivot' });
  const content = h('div');
  let dlg = null;

  function drawPivot() {
    pivot.replaceChildren(...TABS.map(([k, label]) =>
      h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; drawPivot(); drawTab(); } }, label)));
  }

  async function drawTab() {
    if (tab === 'settings') return drawSettings();
    content.replaceChildren(h('div', { class: 'skeleton' }));
    const list = await safe(() => call('inst:content', { id, type: tab }), []);
    if (!list.length) {
      content.replaceChildren(h('div', { class: 'empty' },
        h('h3', null, 'Здесь пока пусто'),
        h('p', null, `${TYPES[tab]} можно установить из каталога или положить файлы в папку сборки.`),
        h('div', { class: 'row' }, h('button', { class: 'btn accent', onclick: () => { state.browse.type = tab; dlg.close(); go('browse'); } }, icon('browse'), 'Открыть каталог'))));
      return;
    }
    content.replaceChildren(h('div', { class: 'rows' }, list.map((f) => h('div', { class: 'row-item' },
      switchEl(!f.disabled, async (on) => {
        await safe(() => call('inst:toggle', { id, rel: f.rel }));
        drawTab();
      }),
      h('div', { class: 't' + (f.disabled ? ' off' : ''), title: f.file }, f.title),
      h('small', null, fmtSize(f.size)),
      h('button', {
        class: 'btn subtle icon', title: 'Удалить', 'aria-label': 'Удалить ' + f.title,
        onclick: async () => {
          if (await confirmDialog({ title: 'Удалить файл?', text: f.title })) {
            await safe(() => call('inst:removeContent', { id, rel: f.rel }));
            drawTab();
          }
        },
      }, icon('trash')))), ));
  }

  function drawSettings() {
    const save = async (patch) => {
      await safe(() => call('inst:update', { id, patch }));
      await reloadInstances();
    };
    const mem = h('input', {
      class: 'input', type: 'number', min: 1024, step: 256, placeholder: String(state.cfg.memoryMax || 4096),
      value: inst.memory || '', onchange: (e) => save({ memory: e.target.value ? Math.max(1024, Number(e.target.value)) : null }),
    });
    content.replaceChildren(
      field('Название', h('input', { class: 'input', value: inst.name, maxlength: 40, onchange: (e) => e.target.value.trim() && save({ name: e.target.value.trim() }) })),
      h('div', { style: { height: '12px' } }),
      field('Память для этой сборки, МБ (пусто — по умолчанию из настроек)', mem),
      h('div', { style: { height: '12px' } }),
      field('Дополнительные аргументы JVM', h('input', { class: 'input mono', value: inst.jvmArgs || '', placeholder: '-XX:+UseZGC', onchange: (e) => save({ jvmArgs: e.target.value }) })),
      h('p', { class: 'hint' }, `Версия: ${instLabel(inst)}`));
  }

  drawPivot();
  drawTab();
  dlg = dialog({
    title: inst.name,
    wide: true,
    body: [pivot, content],
    buttons: [
      { label: 'Открыть папку', onclick: () => safe(() => call('inst:folder', id)) },
      {
        label: 'Удалить сборку', danger: true,
        onclick: async (close) => {
          if (await confirmDialog({ title: 'Удалить сборку?', text: `«${inst.name}» и все её сохранения будут удалены без возможности восстановления.` })) {
            close();
            await safe(() => call('inst:remove', id));
            reloadInstances();
          }
        },
      },
      { label: 'Закрыть' },
    ],
  });
}

// ======================= каталог =======================

function pageBrowse() {
  const b = state.browse;
  const root = h('div');
  const results = h('div', { class: 'results' });
  const notice = h('div');

  const srcSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Источник' });
  const pivot = h('div', { class: 'pivot' });

  function drawChrome() {
    srcSeg.replaceChildren(...Object.entries(SOURCES).map(([k, label]) =>
      h('button', { class: b.source === k ? 'on' : '', onclick: () => { b.source = k; drawChrome(); run(true); } }, label)));
    pivot.replaceChildren(...Object.entries(TYPES).map(([k, label]) =>
      h('button', { class: b.type === k ? 'on' : '', onclick: () => { b.type = k; drawChrome(); run(true); } }, label)));
    loaderSel.hidden = !(b.type === 'mod' || b.type === 'modpack');
  }

  const q = h('input', {
    class: 'input', type: 'search', placeholder: 'Поиск по названию', value: b.query, 'aria-label': 'Поиск',
    onkeydown: (e) => { if (e.key === 'Enter') { b.query = q.value.trim(); run(true); } },
  });
  const mcSel = h('select', { class: 'input', 'aria-label': 'Версия Minecraft', onchange: (e) => { b.mc = e.target.value; run(true); } },
    h('option', { value: '' }, 'Любая версия'));
  const loaderSel = h('select', { class: 'input', 'aria-label': 'Загрузчик', onchange: (e) => { b.loader = e.target.value; run(true); } },
    h('option', { value: '' }, 'Любой загрузчик'),
    ...Object.entries(LOADERS).filter(([k]) => k !== 'vanilla').map(([k, v]) => h('option', { value: k, selected: b.loader === k }, v)));
  const sortSel = h('select', { class: 'input', 'aria-label': 'Сортировка', onchange: (e) => { b.sort = e.target.value; run(true); } },
    ...Object.entries(SORTS).map(([k, v]) => h('option', { value: k, selected: b.sort === k }, v)));

  ensureMcVersions().then((list) => {
    mcSel.append(...list.map((v) => h('option', { value: v.id, selected: b.mc === v.id }, v.id)));
  }).catch(() => {});

  async function run(reset) {
    if (reset) { b.items = []; b.total = 0; b.error = null; }
    const token = ++b.token;
    b.loading = true;
    drawResults();
    try {
      const r = await call('browse:search', {
        source: b.source, type: b.type, query: b.query, mc: b.mc || undefined, loader: b.loader || undefined,
        sort: b.sort, offset: b.items.length, limit: 20,
      });
      if (token !== b.token) return;
      b.items = b.items.concat(r.items);
      b.total = r.total;
      b.error = null;
    } catch (e) {
      if (token !== b.token) return;
      b.error = e;
    }
    b.loading = false;
    drawResults();
  }

  function drawResults() {
    notice.replaceChildren();
    if (b.error) {
      const keyIssue = b.error.code === 'NO_CF_KEY' || b.error.code === 'BAD_CF_KEY';
      notice.append(infobar(keyIssue ? 'warn' : 'err', keyIssue ? 'Нужен ключ CurseForge' : 'Не удалось загрузить каталог', b.error.message,
        keyIssue ? h('button', { class: 'btn', onclick: () => go('settings') }, 'Открыть настройки')
          : h('button', { class: 'btn', onclick: () => run(true) }, 'Повторить')));
    }
    results.replaceChildren();
    results.append(...b.items.map(projectRow));
    if (b.loading) results.append(...Array.from({ length: b.items.length ? 1 : 5 }, () => h('div', { class: 'skeleton' })));
    if (!b.loading && !b.error && !b.items.length) {
      results.append(h('div', { class: 'empty' }, h('h3', null, 'Ничего не найдено'), h('p', null, 'Измените запрос или сбросьте фильтры версии и загрузчика.')));
    }
    if (!b.loading && b.items.length && b.items.length < b.total) {
      results.append(h('div', { class: 'more' }, h('button', { class: 'btn', onclick: () => run(false) }, `Показать ещё (${fmtNum(b.total - b.items.length)})`)));
    }
  }

  root.append(
    pageHead('Обзор', 'Моды, сборки, ресурспаки и шейдеры из Modrinth и CurseForge.', srcSeg),
    pivot,
    h('div', { class: 'filters' }, h('div', { class: 'search' }, icon('search'), q), mcSel, loaderSel, sortSel),
    notice, results);
  drawChrome();
  if (!b.items.length && !b.error) run(true); else drawResults();
  return root;
}

function projectRow(item) {
  const isPack = item.type === 'modpack';
  return h('article', { class: 'proj' },
    h('div', { class: 'logo' }, item.icon ? h('img', { src: item.icon, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : icon('puzzle', 24)),
    h('div', { class: 'body' },
      h('div', { class: 'head' }, h('b', { title: item.title }, item.title), item.author ? h('span', null, 'от ' + item.author) : null),
      h('p', { class: 'desc' }, item.description),
      h('div', { class: 'tags' },
        h('span', { class: 'chip' }, '↓ ' + fmtNum(item.downloads)),
        item.categories.map((c) => h('span', { class: 'chip' }, c)))),
    h('div', { class: 'side' },
      h('button', { class: 'btn icon subtle', title: 'Открыть на сайте', 'aria-label': 'Открыть на сайте', onclick: () => safe(() => call('app:openExternal', item.url)) }, icon('external')),
      h('button', { class: 'btn accent', onclick: () => (isPack ? openPackDialog(item) : openInstallDialog(item)) },
        icon('download'), isPack ? 'Установить сборку' : 'Установить')));
}

const verLabel = (v) => `${v.name || v.versionNumber} · ${v.gameVersions.slice(0, 3).join(', ')}${v.gameVersions.length > 3 ? '…' : ''} · ${v.type}`;

function pickDefault(list) {
  return list.find((v) => v.type === 'release') || list[0];
}

async function openInstallDialog(item) {
  if (!state.instances.length) {
    toast('Сначала создайте сборку, в которую установить', 'err');
    return;
  }
  const b = state.browse;
  const preferred = state.instances.find((i) => i.mc === b.mc && (!b.loader || i.loader === b.loader)) || state.instances[0];
  const instSel = h('select', { class: 'input' },
    state.instances.map((i) => h('option', { value: i.id, selected: i.id === preferred.id }, `${i.name} — ${instLabel(i)}`)));
  const verSel = h('select', { class: 'input', disabled: true }, h('option', null, 'Загрузка…'));
  const deps = h('input', { type: 'checkbox', checked: true });
  const warn = h('div');
  let installBtn = null;
  let token = 0;

  async function loadVersions() {
    const t = ++token;
    const inst = state.instances.find((i) => i.id === instSel.value);
    warn.replaceChildren();
    verSel.disabled = true;
    verSel.replaceChildren(h('option', null, 'Загрузка…'));
    if (installBtn) installBtn.disabled = true;
    if (item.type === 'mod' && inst.loader === 'vanilla') {
      warn.append(infobar('warn', '', 'В сборке Vanilla моды не работают. Выберите сборку с Fabric, Quilt, Forge или NeoForge.'));
      verSel.replaceChildren(h('option', null, '—'));
      return;
    }
    let list = [];
    try {
      list = await call('browse:versions', {
        source: item.source, projectId: item.id, mc: inst.mc,
        loader: inst.loader === 'vanilla' ? undefined : inst.loader, type: item.type,
      });
    } catch (e) {
      if (t !== token) return;
      warn.append(infobar('err', 'Не удалось получить версии', e.message));
      verSel.replaceChildren(h('option', null, '—'));
      return;
    }
    if (t !== token) return;
    if (!list.length) {
      warn.append(infobar('warn', '', `Для ${instLabel(inst)} нет подходящих версий «${item.title}».`));
      verSel.replaceChildren(h('option', null, 'Нет совместимых версий'));
      return;
    }
    const def = pickDefault(list);
    verSel.replaceChildren(...list.map((v) => h('option', { value: v.id, selected: v.id === def.id }, verLabel(v))));
    verSel.disabled = false;
    if (installBtn) installBtn.disabled = false;
  }
  instSel.addEventListener('change', loadVersions);

  const dlg = dialog({
    title: `Установить «${item.title}»`,
    body: [
      field('Сборка', instSel),
      field('Версия', verSel),
      warn,
      item.type === 'mod'
        ? h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' } }, deps, 'Установить обязательные зависимости')
        : null,
    ],
    buttons: [
      {
        label: 'Установить', accent: true,
        onclick: async (close) => {
          if (verSel.disabled) return;
          await safe(() => call('browse:install', {
            source: item.source, instanceId: instSel.value, projectId: item.id, versionId: verSel.value,
            type: item.type, title: item.title, deps: deps.checked,
          }));
          close();
          toast('Загрузка началась — прогресс справа внизу', 'ok');
        },
      },
      { label: 'Отмена' },
    ],
  });
  installBtn = dlg.box.querySelector('.btn.accent');
  loadVersions();
}

async function openPackDialog(item) {
  const nameIn = h('input', { class: 'input', value: item.title, maxlength: 40 });
  const verSel = h('select', { class: 'input', disabled: true }, h('option', null, 'Загрузка…'));
  const warn = h('div');
  let btn = null;

  const dlg = dialog({
    title: `Установить сборку «${item.title}»`,
    body: [
      field('Название сборки', nameIn),
      field('Версия сборки', verSel),
      warn,
      h('p', { class: 'hint' }, 'Будет создана новая сборка: лаунчер скачает все моды, настроит загрузчик и применит конфиги.'),
    ],
    buttons: [
      {
        label: 'Установить', accent: true,
        onclick: async (close) => {
          if (verSel.disabled) return;
          await safe(() => call('browse:installPack', {
            source: item.source, projectId: item.id, versionId: verSel.value, title: nameIn.value.trim() || item.title, icon: item.icon,
          }));
          close();
          toast('Установка сборки началась — прогресс справа внизу', 'ok');
        },
      },
      { label: 'Отмена' },
    ],
  });
  btn = dlg.box.querySelector('.btn.accent');
  btn.disabled = true;
  try {
    const list = await call('browse:versions', { source: item.source, projectId: item.id, type: 'modpack' });
    if (!list.length) throw new Error('У сборки нет доступных версий');
    const def = pickDefault(list);
    verSel.replaceChildren(...list.map((v) => h('option', { value: v.id, selected: v.id === def.id }, verLabel(v))));
    verSel.disabled = false;
    btn.disabled = false;
  } catch (e) {
    warn.append(infobar('err', 'Не удалось получить версии', e.message));
    verSel.replaceChildren(h('option', null, '—'));
  }
}

// ======================= аккаунты =======================

function pageAccounts() {
  const root = h('div');
  root.append(pageHead('Аккаунты', 'Оффлайн-аккаунт — это просто ник. Лицензия и вход через Microsoft не нужны.'));

  const list = state.accounts.accounts;
  if (list.length) {
    root.append(...list.map((a) => {
      const sel = a.id === state.accounts.selected;
      return h('div', { class: 'setting acc' + (sel ? ' sel' : '') },
        avatar(a.name, true),
        h('div', { class: 'txt' }, h('b', null, a.name), h('small', { class: 'mono' }, a.uuid)),
        sel ? h('span', { class: 'chip ok' }, 'Используется') : h('span', { class: 'chip' }, 'Оффлайн'),
        h('div', { class: 'ctl' },
          sel ? null : h('button', { class: 'btn', onclick: () => updateAccounts('acc:select', a.id) }, 'Выбрать'),
          h('button', {
            class: 'btn subtle icon', title: 'Удалить аккаунт', 'aria-label': 'Удалить ' + a.name,
            onclick: async () => { if (await confirmDialog({ title: 'Удалить аккаунт?', text: a.name })) updateAccounts('acc:remove', a.id); },
          }, icon('trash'))));
    }));
  } else {
    root.append(infobar('info', 'Аккаунтов пока нет', 'Добавьте ник — он будет отображаться в игре.'));
  }

  const err = h('div', { class: 'err-text', role: 'alert' });
  const nick = h('input', {
    class: 'input', placeholder: 'Steve_2026', maxlength: 16, autocomplete: 'off',
    onkeydown: (e) => { if (e.key === 'Enter') add(); },
  });
  async function add() {
    err.textContent = '';
    try {
      state.accounts = await call('acc:add', nick.value);
      renderNav(); render();
      toast('Аккаунт добавлен', 'ok');
    } catch (e) { err.textContent = e.message; }
  }
  root.append(
    h('h2', { class: 'group' }, 'Добавить оффлайн-аккаунт'),
    h('div', { class: 'form-row' }, field('Ник игрока', nick), h('button', { class: 'btn accent', onclick: add }, icon('plus'), 'Добавить')),
    err,
    h('p', { class: 'hint' }, 'От 3 до 16 символов: латиница, цифры и «_». С оффлайн-аккаунтом нельзя зайти на серверы с проверкой лицензии (online-mode), а скин не отображается — играть можно в одиночной игре и на серверах с отключённой проверкой.'));
  return root;
}

async function updateAccounts(channel, arg) {
  state.accounts = await safe(() => call(channel, arg), state.accounts);
  renderNav();
  if (state.route === 'accounts') render();
}

// ======================= журнал =======================

function logClass(line) {
  if (/^\[лаунчер\]/.test(line)) return 'l-sys';
  if (/\b(ERROR|FATAL)\b|Exception|Caused by/.test(line)) return 'l-err';
  if (/\bWARN\b/.test(line)) return 'l-warn';
  return '';
}

function pushLog(line) {
  state.logs.push(line);
  if (state.logs.length > 4000) state.logs.splice(0, state.logs.length - 4000);
  const box = state.logBox;
  if (box) {
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.append(h('div', { class: logClass(line) }, line));
    while (box.childElementCount > 4000) box.firstChild.remove();
    if (near) box.scrollTop = box.scrollHeight;
  }
}

function pageLogs() {
  const box = h('div', { class: 'log', tabindex: 0, 'aria-label': 'Журнал игры' },
    state.logs.map((l) => h('div', { class: logClass(l) }, l)));
  state.logBox = box;
  queueMicrotask(() => { box.scrollTop = box.scrollHeight; });
  const root = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    pageHead('Журнал', 'Вывод игры и сообщения лаунчера. Пригодится, если сборка не запускается.',
      h('button', {
        class: 'btn', onclick: async () => {
          try { await navigator.clipboard.writeText(state.logs.join('\n')); toast('Журнал скопирован', 'ok'); } catch { toast('Не удалось скопировать', 'err'); }
        },
      }, icon('copy'), 'Копировать'),
      h('button', { class: 'btn', onclick: () => { state.logs = []; box.replaceChildren(); } }, icon('trash'), 'Очистить')),
    box);
  return root;
}

// ======================= настройки =======================

function pageSettings() {
  const cfg = state.cfg;
  const info = state.info;
  const save = async (patch) => { state.cfg = await safe(() => call('cfg:set', patch), cfg); };
  const maxMb = info.totalMemMb || 16384;

  const row = (title, desc, ctl, col) => h('div', { class: 'setting' + (col ? ' col' : '') },
    h('div', { class: 'txt' }, h('b', null, title), desc ? h('small', null, desc) : null),
    h('div', { class: 'ctl' }, ctl));

  const javaIn = h('input', { class: 'input mono', value: cfg.javaPath || '', placeholder: 'Автоматически (Adoptium)', onchange: (e) => save({ javaPath: e.target.value.trim() }) });
  const keyIn = h('input', { class: 'input mono', type: 'password', value: cfg.curseforgeKey || '', placeholder: '$2a$10$…', autocomplete: 'off', onchange: (e) => save({ curseforgeKey: e.target.value.trim() }) });

  return h('div', null,
    pageHead('Настройки'),
    h('h2', { class: 'group' }, 'Оформление'),
    row('Тема', 'Лаунчер может следовать теме Windows',
      h('select', { class: 'input', onchange: (e) => save({ theme: e.target.value }) },
        [['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([k, v]) => h('option', { value: k, selected: cfg.theme === k }, v)))),

    h('h2', { class: 'group' }, 'Игра'),
    row('Память по умолчанию, МБ', `Доступно в системе: ${Math.round(maxMb / 1024)} ГБ. Для больших сборок обычно хватает 4–8 ГБ.`,
      h('input', {
        class: 'input num', type: 'number', min: 1024, max: maxMb, step: 256, value: cfg.memoryMax,
        onchange: (e) => save({ memoryMax: Math.min(maxMb, Math.max(1024, Number(e.target.value) || 4096)) }),
      })),
    row('Аргументы JVM', 'Применяются ко всем сборкам',
      h('input', { class: 'input mono', value: cfg.jvmArgs || '', placeholder: '-XX:+UseG1GC', onchange: (e) => save({ jvmArgs: e.target.value }) })),
    row('Путь к Java', 'Пусто — лаунчер сам скачает нужную версию для каждой сборки',
      [javaIn,
        h('button', { class: 'btn', onclick: async () => { const p = await safe(() => call('app:pickJava')); if (p) { javaIn.value = p; save({ javaPath: p }); } } }, 'Выбрать…')]),
    row('Сворачивать лаунчер при запуске игры', null, switchEl(cfg.minimizeOnLaunch, (v) => save({ minimizeOnLaunch: v }))),
    row('Показывать снапшоты в списке версий', 'Список обновится после перезапуска', switchEl(cfg.showSnapshots, (v) => { save({ showSnapshots: v }); state.mcVersions = null; })),

    h('h2', { class: 'group' }, 'Для разработчиков'),
    row('Режим разработчика', 'Раздел «Разработка» в меню: диагностика, сетевой журнал, DevTools. Журнал запуска показывает полную команду Java.',
      switchEl(cfg.devMode, async (v) => { await save({ devMode: v }); renderNav(); })),

    h('h2', { class: 'group' }, 'CurseForge'),
    row('API-ключ', 'Бесплатный ключ нужен для поиска и загрузки с CurseForge. Modrinth работает без ключа.',
      [keyIn, h('button', { class: 'btn', onclick: () => safe(() => call('app:openExternal', 'https://console.curseforge.com/')) }, icon('external'), 'Получить ключ')]),

    h('h2', { class: 'group' }, 'О программе'),
    row('FluentCraft Launcher ' + (info.version || ''), `Electron ${info.electron || ''} · ${info.platform || ''} ${info.arch || ''}`,
      h('button', { class: 'btn', onclick: () => safe(() => call('app:openDataDir')) }, icon('folder'), 'Папка данных')),
    h('p', { class: 'hint', style: { marginTop: '12px' } }, 'Создан вместе с ИИ (Claude, Anthropic). Minecraft — товарный знак Mojang Studios; этот лаунчер — неофициальный проект и не связан с Mojang или Microsoft.'));
}

// ======================= разработка =======================

function netRow(e) {
  const ok = e.status >= 200 && e.status < 400;
  return h('div', { class: 'net-row', title: e.error ? `${e.url}\n${e.error}` : e.url },
    h('span', { class: 't' }, new Date(e.t).toLocaleTimeString('ru')),
    h('span', null, e.method),
    h('span', { class: ok ? 'good' : 'bad' }, e.status || 'ERR'),
    h('span', { class: 'ms' }, e.ms + ' мс'),
    h('span', { class: 'u' }, e.url));
}

function pageDev() {
  const kv = h('div', { class: 'kv' }, h('div', { class: 'skeleton', style: { gridColumn: '1 / -1' } }));
  const net = h('div', { class: 'nettable', role: 'table', 'aria-label': 'Сетевые запросы' });
  let diagText = '';

  async function loadDiag() {
    const d = await safe(() => call('dev:diagnostics'), null);
    if (!d) return;
    diagText = d.text;
    kv.replaceChildren(...d.rows.flatMap(([k, v]) => [h('span', { class: 'k' }, k), h('span', { class: 'v mono' }, String(v))]));
  }
  async function loadNet() {
    let list;
    try { list = await call('dev:netlog'); } catch { return; }
    net.replaceChildren(...(list.length
      ? list.slice(0, 100).map(netRow)
      : [h('div', { class: 'hint', style: { padding: '8px' } }, 'Запросов пока не было — откройте «Обзор», и они появятся здесь.')]));
  }

  const btn = (label, ic, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, icon(ic), label);
  const open = (what) => () => safe(() => call('dev:openPath', what));

  const root = h('div', null,
    pageHead('Разработка', 'Инструменты для отладки лаунчера и сборок. Раздел виден только в режиме разработчика.'),
    h('h2', { class: 'group' }, 'Инструменты'),
    h('div', { class: 'toolbar' },
      btn('Консоль DevTools', 'terminal', () => safe(() => call('dev:devtools'))),
      btn('Перезагрузить интерфейс', 'refresh', () => safe(() => call('dev:reload')))),
    h('h2', { class: 'group' }, 'Папки'),
    h('div', { class: 'toolbar' },
      btn('Данные', 'folder', open('data')),
      btn('Minecraft', 'folder', open('minecraft')),
      btn('Сборки', 'folder', open('instances')),
      btn('Java', 'folder', open('java')),
      btn('Кэш загрузок', 'folder', open('cache')),
      btn('Очистить кэш', 'trash', async () => {
        if (await confirmDialog({ title: 'Очистить кэш загрузок?', text: 'Скачанные установщики и архивы сборок будут удалены. Сами сборки и игра не пострадают.', okLabel: 'Очистить' })) {
          const n = await safe(() => call('dev:clearCache'), null);
          if (n !== null) toast(`Удалено файлов: ${n}`, 'ok');
        }
      }, 'danger')),
    h('h2', { class: 'group' }, 'Диагностика'),
    kv,
    h('div', { class: 'toolbar', style: { marginTop: '8px' } },
      btn('Копировать для отчёта об ошибке', 'copy', async () => {
        try { await navigator.clipboard.writeText(diagText); toast('Диагностика скопирована', 'ok'); } catch { toast('Не удалось скопировать', 'err'); }
      }),
      btn('Обновить', 'refresh', loadDiag)),
    h('h2', { class: 'group' }, 'Сетевые запросы'),
    h('p', { class: 'hint', style: { margin: '0 0 8px' } }, 'Последние запросы к Modrinth, CurseForge, Mojang и загрузчикам. Список обновляется сам.'),
    net);

  loadDiag();
  loadNet();
  state.devTimer = setInterval(() => { if (state.route === 'dev') loadNet(); }, 3000);
  return root;
}

// ======================= задачи =======================

function renderTasks() {
  const box = $('#tasks');
  const list = [...state.tasks.values()].reverse();
  box.hidden = !list.length;
  box.replaceChildren(...list.map((t) => {
    const indet = t.status === 'running' && (t.progress == null);
    return h('div', { class: 'task ' + t.status },
      h('div', { class: 't-head' },
        t.status === 'running' ? h('span', { class: 'ring' }) : icon(t.status === 'done' ? 'check' : 'warning', 16),
        h('b', { title: t.title }, t.title),
        t.status !== 'running' ? h('button', { class: 'btn subtle icon', 'aria-label': 'Скрыть', onclick: () => { state.tasks.delete(t.id); renderTasks(); } }, icon('close', 14)) : null),
      t.detail ? h('div', { class: 't-detail', title: t.detail }, t.detail) : null,
      t.status === 'running'
        ? h('div', { class: 'bar' + (indet ? ' indet' : '') }, h('i', { style: indet ? null : { width: Math.round((t.progress || 0) * 100) + '%' } }))
        : null);
  }));
}

function onTask(t) {
  state.tasks.set(t.id, t);
  renderTasks();
  if (t.status === 'done') setTimeout(() => { state.tasks.delete(t.id); renderTasks(); }, 6000);
}

// ======================= запуск =======================

async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('mica') === '1') document.body.classList.add('mica');
  document.body.classList.add('platform-' + (params.get('platform') || 'win32'));
  if (params.get('edition') === 'dev') {
    document.documentElement.dataset.edition = 'dev';
    $('#edition-badge').hidden = false;
    $('#tb-title').textContent = 'FluentCraft Launcher Dev';
    document.title = 'FluentCraft Launcher Dev';
  }
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  bridge.on('task:update', onTask);
  bridge.on('theme:changed', (dark) => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; });
  bridge.on('game:log', ({ line }) => pushLog(line));
  bridge.on('game:state', ({ id, state: s, code }) => {
    if (s === 'starting') state.starting.add(id);
    if (s === 'running') { state.starting.delete(id); state.running.add(id); }
    if (s === 'stopped') {
      state.starting.delete(id); state.running.delete(id);
      if (code && code !== 0) toast(`Игра завершилась с ошибкой (код ${code}). Подробности — в журнале.`, 'err', 7000);
    }
    renderNav();
    if (state.route === 'library') render();
  });
  bridge.on('inst:changed', () => reloadInstances());

  try {
    const [cfg, info, accounts, inst] = await Promise.all([call('cfg:get'), call('app:info'), call('acc:list'), call('inst:list')]);
    state.cfg = cfg; state.info = info; state.accounts = accounts;
    state.instances = inst.list; state.running = new Set(inst.running);
  } catch (e) {
    toast('Не удалось загрузить данные: ' + e.message, 'err', 8000);
  }
  renderNav();
  render();
}

init();
