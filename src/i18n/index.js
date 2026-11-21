// Tiny translation runtime (no dependency).
//
// Keys ARE the English source strings, so anything not in a catalog (or not yet loaded) falls back to English:
//   t('New folder')                              -> 'Bagong folder' (fil)
//   t('Moved {name} to Trash', { name })         -> {placeholders} are filled from vars
//   t('{n, plural, one {# item} other {# items}}', { n: 3 })
//                                                -> ICU-lite plurals: `{var, plural, <cat> {…} other {…}}`, categories
//                                                   from Intl.PluralRules (one/few/many/other) plus exact `=0`, `=1`;
//                                                   `#` is the locale-formatted number. Branches may contain {name}.
// Catalogs: en is the source (no file needed); fil and es are lazy-loaded with dynamic import().
// In components use `const t = useT();` (re-renders when the language setting changes). The plain `t` export
// translates with whatever language is active right now (fine for event handlers / toasts).
import { useEffect, useSyncExternalStore } from 'react';
import { useDrive } from '../store/DriveStore';

export const LANGUAGES = [
  { code: 'en', label: 'English', locale: 'en-US' },
  { code: 'fil', label: 'Filipino', locale: 'fil-PH' },
  { code: 'es', label: 'Español', locale: 'es-ES' },
];
const LOADERS = {
  fil: () => import('./fil.js'),
  es: () => import('./es.js'),
};

/** Maps any stored setting / browser locale ('es-ES', 'tl', 'fil-PH', 'en-US', …) to a supported code, or null. */
export function normalizeLanguage(value) {
  if (!value) return null;
  const base = String(value).toLowerCase().split(/[-_]/)[0];
  if (base === 'tl' || base === 'fil') return 'fil';
  if (base === 'es') return 'es';
  if (base === 'en') return 'en';
  return null;
}
function browserLanguage() {
  try {
    for (const l of navigator.languages || [navigator.language]) {
      const code = normalizeLanguage(l);
      if (code) return code;
    }
  } catch { /* no navigator */ }
  return 'en';
}
/** The language to show for a stored settings.language value (empty/unsupported -> browser language -> English). */
export const resolveLanguage = (setting) => normalizeLanguage(setting) || browserLanguage();

// ---- active-language store ---------------------------------------------------------------------------------
const catalogs = { en: {} };
const loading = {};
let active = 'en';
let wanted = 'en';
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getActive = () => active;

function applyDocument(code) {
  if (typeof document === 'undefined') return;
  const meta = LANGUAGES.find((l) => l.code === code);
  document.documentElement.lang = meta ? meta.locale.split('-')[0] : 'en';
  document.documentElement.dir = 'ltr'; // all supported languages are left-to-right
}

function loadCatalog(code) {
  if (catalogs[code]) return Promise.resolve(catalogs[code]);
  if (!LOADERS[code]) return Promise.resolve(null);
  loading[code] ||= LOADERS[code]()
    .then((m) => { catalogs[code] = m.default || {}; return catalogs[code]; })
    .catch(() => { delete loading[code]; return null; });
  return loading[code];
}

/** Switches the active language (loads its catalog first; stays on the previous language until it arrives). */
export function setLanguage(value) {
  const code = normalizeLanguage(value) || 'en';
  wanted = code;
  if (code === active && catalogs[code]) return Promise.resolve();
  return loadCatalog(code).then((cat) => {
    if (wanted !== code) return; // a newer choice won
    active = cat ? code : 'en';
    applyDocument(active);
    emit();
  });
}

// Start loading the saved language before React renders, so the first paint is usually already translated.
try {
  const saved = JSON.parse(localStorage.getItem('workvault-drive:v1') || 'null')?.settings?.language;
  setLanguage(resolveLanguage(saved));
} catch { setLanguage(browserLanguage()); }

export const currentLanguage = () => active;
export const currentLocale = () => (LANGUAGES.find((l) => l.code === active) || LANGUAGES[0]).locale;

// ---- formatting ------------------------------------------------------------------------------------------------
const pluralRules = {};
function pluralCategory(n, locale) {
  pluralRules[locale] ||= new Intl.PluralRules(locale);
  return pluralRules[locale].select(n);
}
/** Locale-aware number formatting (1,234.5 / 1.234,5). */
export const formatNumber = (n, opts) => new Intl.NumberFormat(currentLocale(), opts).format(n);

function interpolate(str, vars, locale) {
  if (!vars || str.indexOf('{') < 0) return str;
  let out = '';
  let i = 0;
  while (i < str.length) {
    const open = str.indexOf('{', i);
    if (open < 0) { out += str.slice(i); break; }
    out += str.slice(i, open);
    // find the matching close brace (branches of a plural can nest braces)
    let depth = 0;
    let close = open;
    for (; close < str.length; close++) {
      if (str[close] === '{') depth++;
      else if (str[close] === '}' && --depth === 0) break;
    }
    if (close >= str.length) { out += str.slice(open); break; }
    const body = str.slice(open + 1, close);
    const m = body.match(/^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/);
    if (m) {
      out += plural(m[1], m[2], vars, locale);
    } else {
      const k = body.trim();
      out += vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : `{${k}}`;
    }
    i = close + 1;
  }
  return out;
}
function plural(name, spec, vars, locale) {
  const n = Number(vars[name]);
  const branches = {};
  const re = /\s*(=?\w+)\s*\{/g;
  let m;
  while ((m = re.exec(spec))) {
    let depth = 1;
    let j = re.lastIndex;
    for (; j < spec.length && depth; j++) {
      if (spec[j] === '{') depth++;
      else if (spec[j] === '}') depth--;
    }
    branches[m[1]] = spec.slice(re.lastIndex, j - 1);
    re.lastIndex = j;
  }
  const pick = branches[`=${n}`] ?? branches[pluralCategory(n, locale)] ?? branches.other ?? '';
  const num = Number.isFinite(n) ? new Intl.NumberFormat(locale).format(n) : String(vars[name]);
  return interpolate(pick.replace(/#/g, num), vars, locale);
}

function translate(code, key, vars) {
  const cat = catalogs[code] || {};
  const str = cat[key] ?? key;
  const locale = (LANGUAGES.find((l) => l.code === code) || LANGUAGES[0]).locale;
  return interpolate(String(str), vars, locale);
}

const bound = {};
function translatorFor(code) {
  if (!bound[code]) {
    const fn = (key, vars) => translate(code, key, vars);
    fn.lang = code;
    fn.locale = (LANGUAGES.find((l) => l.code === code) || LANGUAGES[0]).locale;
    fn.number = (n, opts) => new Intl.NumberFormat(fn.locale, opts).format(n);
    bound[code] = fn;
  }
  return bound[code];
}

/** Translate with the currently active language (non-hook; for handlers and utilities). */
export const t = (key, vars) => translate(active, key, vars);

/** Hook: returns a translator for the language in settings.language; re-renders when it changes or loads. */
export function useT() {
  const { state } = useDrive();
  const want = resolveLanguage(state.settings?.language);
  useEffect(() => { setLanguage(want); }, [want]);
  const code = useSyncExternalStore(subscribe, getActive, getActive);
  return translatorFor(code);
}
