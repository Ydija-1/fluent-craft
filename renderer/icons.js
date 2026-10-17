'use strict';
/* Небольшой набор линейных иконок 24×24 в духе Fluent. */
const ICONS = {
  library: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  browse: '<circle cx="12" cy="12" r="8.5"/><path d="M15.6 8.4l-2 5.2-5.2 2 2-5.2z"/>',
  user: '<circle cx="12" cy="8.2" r="3.7"/><path d="M4.6 20c.6-3.6 3.6-5.6 7.4-5.6s6.8 2 7.4 5.6"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.4"/><path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  play: '<path d="M8 5.6v12.8a.8.8 0 001.2.7l10.2-6.4a.8.8 0 000-1.4L9.2 4.9A.8.8 0 008 5.6z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.8" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h4l2 2.2h7.6c1 0 1.7.8 1.7 1.7v7.9c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7z"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.8 7l.8 12.2h8.8L17.2 7M10 11v5M14 11v5"/>',
  download: '<path d="M12 4v11M7.5 10.8L12 15.3l4.5-4.5M5 19.5h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  external: '<path d="M14 4.5h5.5V10M19 5l-8 8M18 14v4a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 015 18V8a1.5 1.5 0 011.5-1.5H10"/>',
  import: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V14"/>',
  puzzle: '<path d="M9 4.5h3a1.7 1.7 0 013.4 0H18.5V9a1.7 1.7 0 010 3.4V17a1.5 1.5 0 01-1.5 1.5h-4.2a1.7 1.7 0 00-3.4 0H5.5V14a1.7 1.7 0 000-3.4V6A1.5 1.5 0 017 4.5z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8v.1"/>',
  warning: '<path d="M12 4.2l8.4 14.6H3.6z"/><path d="M12 10v4.2M12 16.8v.1"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5A2 2 0 0013.5 4.5h-7a2 2 0 00-2 2v7a2 2 0 002 2h2"/>',
  chevron: '<path d="M8 10l4 4 4-4"/>',
  cube: '<path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M4.8 7.9L12 12l7.2-4.1M12 12v8.2"/>',
};

function icon(name, size = 16) {
  const s = document.createElement('span');
  s.className = 'ic';
  s.style.width = s.style.height = size + 'px';
  s.innerHTML =
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return s;
}
