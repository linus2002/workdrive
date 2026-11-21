// Small, dependency-free syntax highlighter. It tokenizes per line family (C-like, Python, shell, SQL, CSS,
// markup, YAML, JSON) well enough for reading code in a preview; it is not a full parser.

const KW = {
  js: 'await async break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield interface type enum implements private public protected readonly as',
  c: 'abstract auto bool break case catch char class const continue default delete do double else enum extern final float for fn func go goto if impl import int interface let long loop match mod mut namespace new package private protected pub public return short signed sizeof static struct super switch this throw throws trait try typedef union unsigned use using var void volatile while defer chan select map range val fun when object override data echo function',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield begin end module require puts unless then do',
  sh: 'if then else elif fi for while do done case esac in function return export local echo exit set unset source alias cd',
  sql: 'select from where and or not insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset as distinct union all null is like in between case when then else end primary key foreign references default exists view',
};
const LITERALS = /^(true|false|null|undefined|None|True|False|nil|NULL)$/;

const RULES = {
  common: [
    ['str', /^("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/],
    ['num', /^(0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i],
    ['word', /^[A-Za-z_$][\w$]*/],
    ['punct', /^[{}()[\];,.<>+\-*/%=!&|^~?:@#]+/],
    ['ws', /^\s+/],
  ],
};

const COMMENT = {
  js: [/^\/\/.*/],
  c: [/^\/\/.*/, /^#\s*(include|define|ifdef|ifndef|endif|pragma)\b.*/],
  py: [/^#.*/],
  sh: [/^#.*/],
  sql: [/^--.*/],
  yaml: [/^#.*/],
};
// Tokens that may run past the 4000-char window are matched against the whole source (sticky regexes).
const BLOCK_COMMENT = { js: true, c: true, sql: true };
const RE_BLOCK = /\/\*[\s\S]*?(?:\*\/|$)/y;
const RE_TEMPLATE = /`(?:[^`\\]|\\[\s\S])*`/y;
const RE_TEMPLATE_OPEN = /`[^\n]*/y; // unterminated: stop at the end of the line
const longToken = (re, src, i) => { re.lastIndex = i; const m = re.exec(src); return m ? [m[0]] : null; };

function tokenizeGeneric(src, lang) {
  const kw = new Set((KW[lang] || '').split(' '));
  const out = [];
  let i = 0;
  let prevWord = '';
  while (i < src.length) {
    const rest = src.slice(i, i + 4000); // bounded window keeps large files linear
    let m = null; let type = null;
    if (BLOCK_COMMENT[lang] && src[i] === '/' && src[i + 1] === '*') { m = longToken(RE_BLOCK, src, i); type = 'com'; }
    else if (src[i] === '`') { m = (lang === 'js' ? longToken(RE_TEMPLATE, src, i) : rest.match(/^`[^`\n]*`/)) || longToken(RE_TEMPLATE_OPEN, src, i); type = 'str'; }
    if (!m) for (const re of COMMENT[lang] || []) { m = rest.match(re); if (m) { type = 'com'; break; } }
    if (!m && lang === 'sh') { m = rest.match(/^\$\{?[\w@#?*!-]+\}?/); if (m) type = 'var'; }
    if (!m) {
      for (const [t, re] of RULES.common) { m = rest.match(re); if (m) { type = t; break; } }
    }
    if (!m) { m = [rest[0]]; type = 'plain'; }
    const text = m[0];
    if (type === 'word') {
      const lower = lang === 'sql' ? text.toLowerCase() : text;
      if (kw.has(lower)) type = 'kw';
      else if (LITERALS.test(text)) type = 'lit';
      else if (/^\s*\(/.test(src.slice(i + text.length, i + text.length + 40))) type = 'fn';
      else if (/^[A-Z]/.test(text) && lang !== 'sql') type = 'type';
      else if (['def', 'function', 'class', 'fn', 'func'].includes(prevWord)) type = 'fn';
      else type = 'plain';
      prevWord = text;
    } else if (type === 'punct' || type === 'ws') {
      if (type === 'punct') prevWord = '';
      type = type === 'punct' ? 'punct' : 'plain';
    }
    out.push([type, text]);
    i += text.length;
  }
  return out;
}

function tokenizeJson(src) {
  const out = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+)|(.)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) { out.push([m[2] ? 'prop' : 'str', m[1]]); if (m[2]) out.push(['punct', m[2]]); }
    else if (m[3]) out.push(['num', m[3]]);
    else if (m[4]) out.push(['lit', m[4]]);
    else if (m[5]) out.push(['punct', m[5]]);
    else out.push(['plain', m[0]]);
  }
  return out;
}

function tokenizeHtml(src) {
  const out = [];
  const re = /(<!--[\s\S]*?(?:-->|$))|(<\/?)([\w:-]+)((?:\s+[\w:@.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?>)?|([^<]+)|(<)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) out.push(['com', m[1]]);
    else if (m[3]) {
      out.push(['punct', m[2]]); out.push(['tag', m[3]]);
      const attrs = m[4] || '';
      const ar = /(\s+)([\w:@.-]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+))?/g;
      let a;
      while ((a = ar.exec(attrs))) {
        out.push(['plain', a[1]]); out.push(['attr', a[2]]);
        if (a[3]) { out.push(['punct', a[3]]); out.push(['str', a[4]]); }
      }
      if (m[5]) out.push(['punct', m[5]]);
    } else out.push(['plain', m[0]]);
  }
  return out;
}

function tokenizeCss(src) {
  const out = [];
  const re = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[0-9a-fA-F]{3,8}\b)|(-?\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?)|([\w-]+)(\s*:)(?![^{]*\{)|(@[\w-]+)|([.#]?[\w-]+)|(\s+)|(.)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) out.push(['com', m[1]]);
    else if (m[2]) out.push(['str', m[2]]);
    else if (m[3]) out.push(['num', m[3]]);
    else if (m[4]) out.push(['num', m[4]]);
    else if (m[5]) { out.push(['prop', m[5]]); out.push(['punct', m[6]]); }
    else if (m[7]) out.push(['kw', m[7]]);
    else if (m[8]) out.push([/^[.#]/.test(m[8]) ? 'tag' : 'plain', m[8]]);
    else out.push(['plain', m[0]]);
  }
  return out;
}

function tokenizeYaml(src) {
  const out = [];
  for (const line of src.split(/(\n)/)) {
    if (line === '\n') { out.push(['plain', line]); continue; }
    const m = line.match(/^(\s*-?\s*)([\w.\-"' ]+?)(\s*[:=])(\s*)(.*)$/);
    if (/^\s*[#;]/.test(line)) { out.push(['com', line]); continue; }
    if (/^\s*\[.*\]\s*$/.test(line)) { out.push(['tag', line]); continue; }
    if (!m) { out.push(['plain', line]); continue; }
    out.push(['plain', m[1]]); out.push(['prop', m[2]]); out.push(['punct', m[3]]); out.push(['plain', m[4]]);
    const v = m[5];
    const c = v.match(/^(.*?)(\s+#.*)$/);
    const val = c ? c[1] : v;
    out.push([/^-?\d+(\.\d+)?$/.test(val) ? 'num' : /^(true|false|null|yes|no|on|off)$/i.test(val) ? 'lit' : /^["']/.test(val) ? 'str' : 'plain', val]);
    if (c) out.push(['com', c[2]]);
  }
  return out;
}

/** Tokens for the whole source: [[type, text], ...]. */
export function tokenize(src, lang) {
  if (lang === 'json') return tokenizeJson(src);
  if (lang === 'html') return tokenizeHtml(src);
  if (lang === 'css') return tokenizeCss(src);
  if (lang === 'yaml') return tokenizeYaml(src);
  return tokenizeGeneric(src, lang);
}

/** Tokens split into lines (multi-line comments and strings are split across lines). */
export function highlightLines(src, lang) {
  const lines = [[]];
  for (const [type, text] of tokenize(src, lang)) {
    const parts = text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push([type, p]);
    });
  }
  return lines;
}
