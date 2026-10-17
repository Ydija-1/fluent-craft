'use strict';
/* Если в интерфейсе что-то сломалось — показываем причину на экране, а не пустое окно. */
(function () {
  let box = null;
  function show(msg) {
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;left:16px;bottom:16px;right:16px;z-index:100;padding:12px 16px;border-radius:8px;' +
        'background:#c42b1c;color:#fff;font:13px/20px "Segoe UI",sans-serif;user-select:text;white-space:pre-wrap;box-shadow:0 8px 16px rgba(0,0,0,.35)';
      const close = document.createElement('button');
      close.textContent = '✕';
      close.setAttribute('aria-label', 'Закрыть');
      close.style.cssText = 'position:absolute;top:6px;right:8px;border:0;background:transparent;color:#fff;cursor:pointer;font-size:14px';
      close.onclick = () => { box.remove(); box = null; };
      box.append(close, document.createElement('div'));
      document.body.append(box);
    }
    box.lastChild.textContent = 'Ошибка интерфейса: ' + msg + '\nОткройте консоль (Ctrl+Shift+I) и пришлите её вывод.';
  }
  window.addEventListener('error', (e) => show(e.message || 'неизвестная ошибка'));
  window.addEventListener('unhandledrejection', (e) => show((e.reason && e.reason.message) || String(e.reason)));
})();
