// Safe Markdown renderer (CommonMark/GFM subset) that builds React elements directly — no HTML strings,
// so file contents can never inject markup or scripts. Links only allow http(s)/mailto; images http(s)/data:image.
import { Fragment } from 'react';
import { CodeBlock } from './CodeView';

const SAFE_LINK = /^(https?:|mailto:|#)/i;
const SAFE_IMG = /^(https?:|data:image\/(png|jpe?g|gif|webp);)/i;
const LANG_ALIAS = { javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', python: 'py', py: 'py', bash: 'sh', shell: 'sh', sh: 'sh', zsh: 'sh', json: 'json', html: 'html', xml: 'html', css: 'css', scss: 'css', sql: 'sql', yaml: 'yaml', yml: 'yaml', toml: 'yaml', go: 'c', rust: 'c', java: 'c', c: 'c', cpp: 'c', csharp: 'c', cs: 'c', php: 'c', ruby: 'py', rb: 'py', kotlin: 'c', swift: 'c' };

/* ---------------- inline ---------------- */
function inline(text, key = 'i') {
  const out = [];
  let rest = text;
  let n = 0;
  const push = (node) => out.push(<Fragment key={`${key}-${n++}`}>{node}</Fragment>);
  const RULES = [
    [/^\\([\\`*_{}[\]()#+\-.!~|>])/, (m) => m[1]],
    [/^(`+)(?!`)([\s\S]*?[^`])\1(?!`)/, (m) => <code className="md-code">{m[2].replace(/^ (.*\S.*) $/, '$1')}</code>],
    [/^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/, (m) => (SAFE_IMG.test(m[2]) ? <img src={m[2]} alt={m[1]} title={m[3]} className="md-img" loading="lazy" /> : `[image: ${m[1] || m[2]}]`)],
    [/^\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/, (m) => (SAFE_LINK.test(m[2])
      ? <a href={m[2]} title={m[3]} target={m[2].startsWith('#') ? undefined : '_blank'} rel="noreferrer noopener">{inline(m[1], `${key}l${n}`)}</a>
      : inline(m[1], `${key}l${n}`))],
    [/^<(https?:\/\/[^>\s]+)>/, (m) => <a href={m[1]} target="_blank" rel="noreferrer noopener">{m[1]}</a>],
    [/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/, (m) => <strong>{inline(m[2], `${key}b${n}`)}</strong>],
    [/^(\*|_)(?=\S)([\s\S]*?\S)\1(?![\w*])/, (m) => <em>{inline(m[2], `${key}e${n}`)}</em>],
    [/^~~(?=\S)([\s\S]*?\S)~~/, (m) => <del>{inline(m[1], `${key}d${n}`)}</del>],
    [/^(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/, (m) => <a href={m[1]} target="_blank" rel="noreferrer noopener">{m[1]}</a>],
  ];
  let buf = '';
  outer: while (rest.length) {
    for (const [re, fn] of RULES) {
      const m = rest.match(re);
      if (m && !(re.source.startsWith('^(https') && /\w$/.test(buf))) {
        if (buf) { push(buf); buf = ''; }
        push(fn(m));
        rest = rest.slice(m[0].length);
        continue outer;
      }
    }
    // Hard line break: two trailing spaces or a backslash before a newline.
    const br = rest.match(/^( {2,}|\\)\n/);
    if (br) { if (buf) { push(buf); buf = ''; } push(<br />); rest = rest.slice(br[0].length); continue; }
    buf += rest[0];
    rest = rest.slice(1);
  }
  if (buf) push(buf);
  return out;
}

/* ---------------- blocks ---------------- */
/** A code fence opener: ``` or ~~~ (a backtick fence's info string can't contain backticks). */
const fenceMatch = (l) => {
  const m = l.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m || (m[1][0] === '`' && m[2].includes('`'))) return null;
  return { marker: m[1], lang: (m[2].trim().match(/^[\w+#-]*/) || [''])[0] };
};
const isHr = (l) => /^ {0,3}([-*_])( *\1){2,} *$/.test(l);
const listMatch = (l) => l.match(/^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/);
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = fenceMatch(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence.marker)) body.push(lines[i++]);
      i++;
      blocks.push({ t: 'code', lang: fence.lang.toLowerCase(), text: body.join('\n') });
      continue;
    }
    // Optional closing #s must be preceded by whitespace, so "# Learn C#" keeps its "#".
    const h = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/);
    if (h) { blocks.push({ t: 'h', level: h[1].length, text: h[2] || '' }); i++; continue; }
    if (isHr(line)) { blocks.push({ t: 'hr' }); i++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim() && /^ {0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      blocks.push({ t: 'quote', children: parseBlocks(body) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : undefined));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      blocks.push({ t: 'table', head, align, rows });
      continue;
    }
    const lm = listMatch(line);
    if (lm) {
      const indent = lm[1].length;
      const ordered = /\d/.test(lm[2]);
      const start = ordered ? parseInt(lm[2], 10) : 1;
      const items = [];
      let loose = false;
      while (i < lines.length) {
        // Blank lines between items keep the list going when the next item is a same-indent marker of the same type.
        if (!lines[i].trim() && items.length) {
          let j = i;
          while (j < lines.length && !lines[j].trim()) j++;
          const nm = j < lines.length ? listMatch(lines[j]) : null;
          if (nm && nm[1].length === indent && /\d/.test(nm[2]) === ordered) { i = j; loose = true; continue; }
          break;
        }
        const m = listMatch(lines[i]);
        if (m && m[1].length === indent && /\d/.test(m[2]) === ordered) {
          const body = [m[3]];
          i++;
          // Continuation lines: indented more than the marker, or blank lines followed by indented content.
          while (i < lines.length) {
            const l = lines[i];
            const sub = listMatch(l);
            if (sub && sub[1].length <= indent) break;
            if (!l.trim()) {
              const next = lines[i + 1];
              if (next && /^\s+/.test(next) && (next.match(/^\s*/)[0].length > indent)) { body.push(''); i++; continue; }
              break;
            }
            if (!sub && !/^\s/.test(l)) { body.push(l); i++; continue; } // lazy continuation
            body.push(l.slice(Math.min(l.match(/^\s*/)[0].length, indent + 2)));
            i++;
          }
          const task = body[0].match(/^\[([ xX])\]\s+(.*)$/);
          if (task) body[0] = task[2];
          items.push({ task: task ? task[1].toLowerCase() === 'x' : null, children: parseBlocks(body), tight: body.length === 1 || !body.includes('') });
        } else break;
      }
      if (loose) items.forEach((it) => { it.tight = false; });
      blocks.push({ t: 'list', ordered, start, items });
      continue;
    }
    // Paragraph (setext headings too)
    const body = [];
    const start = i;
    while (i < lines.length && lines[i].trim()) {
      // Setext heading underline (checked before the horizontal-rule test, so "Title\n---" is an h2).
      if (body.length && /^ {0,3}(=+|-+)\s*$/.test(lines[i])) {
        blocks.push({ t: 'h', level: lines[i].trim()[0] === '=' ? 1 : 2, text: body.join('\n') });
        body.length = 0;
        i++;
        break;
      }
      if (/^ {0,3}(#{1,6}(\s|$)|>)/.test(lines[i]) || fenceMatch(lines[i]) || (body.length && (listMatch(lines[i]) || isHr(lines[i])))) break;
      body.push(lines[i].replace(/^ {0,3}/, ''));
      i++;
    }
    if (body.length) blocks.push({ t: 'p', text: body.join('\n') });
    if (i === start) { blocks.push({ t: 'p', text: line }); i++; } // never stall on an unexpected line
  }
  return blocks;
}

const slug = (s) => s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

function renderBlocks(blocks, key = 'b', tight = false) {
  return blocks.map((b, idx) => {
    const k = `${key}-${idx}`;
    switch (b.t) {
      case 'h': { const H = `h${b.level}`; return <H key={k} id={slug(b.text)}>{inline(b.text, k)}</H>; }
      case 'hr': return <hr key={k} />;
      case 'code': return <CodeBlock key={k} code={b.text} lang={LANG_ALIAS[b.lang] || (b.lang ? 'c' : null)} label={b.lang} />;
      case 'quote': return <blockquote key={k}>{renderBlocks(b.children, k)}</blockquote>;
      case 'table': return (
        <div key={k} className="md-table-wrap">
          <table>
            <thead><tr>{b.head.map((c, j) => <th key={j} style={{ textAlign: b.align[j] }}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, ri) => <tr key={ri}>{b.head.map((_, j) => <td key={j} style={{ textAlign: b.align[j] }}>{inline(r[j] || '', `${k}r${ri}${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      case 'list': {
        const L = b.ordered ? 'ol' : 'ul';
        return (
          <L key={k} start={b.ordered && b.start !== 1 ? b.start : undefined} className={b.items.some((it) => it.task != null) ? 'md-tasks' : undefined}>
            {b.items.map((it, j) => (
              <li key={j} className={it.task != null ? 'md-task' : undefined}>
                {it.task != null && <input type="checkbox" checked={it.task} readOnly disabled aria-label={it.task ? 'Done' : 'Not done'} />}
                {renderBlocks(it.children, `${k}-${j}`, it.tight)}
              </li>
            ))}
          </L>
        );
      }
      default: return tight ? <Fragment key={k}>{inline(b.text, k)}</Fragment> : <p key={k}>{inline(b.text, k)}</p>;
    }
  });
}

export default function Markdown({ source }) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return <div className="markdown-body">{renderBlocks(parseBlocks(lines))}</div>;
}
