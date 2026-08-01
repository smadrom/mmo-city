import { ru } from './ru.js';
import { en } from './en.js';

export type Lang = 'ru' | 'en';
const dicts: Record<Lang, Record<string, string>> = { ru, en };

// выбор языка: сохранённый → navigator → ru
let lang: Lang = (() => {
  const saved = localStorage.getItem('lang');
  if (saved === 'ru' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
})();

export function getLang(): Lang { return lang; }

export function setLang(l: Lang): void {
  lang = l;
  localStorage.setItem('lang', l);
}

// отсутствующий ключ: fallback ru → сам ключ (заметно в dev)
export function t(key: string, params?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? ru[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// статика index.html: data-i18n="key" → textContent, data-i18n-ph="key" → placeholder
export function applyStatic(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n!); });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh!); });
}
