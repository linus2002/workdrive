import { useMemo, useState } from 'react';
import { Copy, Check, WrapText } from 'lucide-react';
import { highlightLines } from './highlight';
import { useUI } from '../store/UIContext';

const MAX_HIGHLIGHT = 400_000; // characters; larger files are shown as plain text so the preview stays fast

function Lines({ code, lang, numbers = true }) {
  const lines = useMemo(() => {
    if (!lang || code.length > MAX_HIGHLIGHT) return code.split('\n').map((l) => [['plain', l]]);
    return highlightLines(code, lang);
  }, [code, lang]);
  return (
    <code className="code-lines">
      {lines.map((toks, i) => (
        <span key={i} className="code-line">
          {numbers && <span className="code-ln" aria-hidden="true">{i + 1}</span>}
          <span className="code-src">{toks.length ? toks.map(([t, s], j) => (t === 'plain' ? s : <span key={j} className={`tk-${t}`}>{s}</span>)) : '​'}</span>
        </span>
      ))}
    </code>
  );
}

function CopyButton({ text, dark }) {
  const ui = useUI();
  const [done, setDone] = useState(false);
  const copy = () => {
    const fail = () => ui.toast('Could not copy to the clipboard. Select the text and copy it manually.', { type: 'error' });
    if (!navigator.clipboard?.writeText) { fail(); return; }
    navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(fail);
  };
  return (
    <button className={`btn btn-sm code-copy ${dark ? 'btn-ghost-dark' : 'btn-ghost'}`} onClick={copy} aria-label="Copy code">
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Fenced code block inside rendered Markdown. */
export function CodeBlock({ code, lang, label }) {
  return (
    <div className="md-codeblock">
      <div className="md-codeblock-head"><span>{label || 'code'}</span><CopyButton text={code} /></div>
      <pre className="code-view"><Lines code={code} lang={lang} numbers={false} /></pre>
    </div>
  );
}

/** Full-file code preview with line numbers, wrapping and copy. */
export function CodeViewer({ code, lang, langName, embedded = false }) {
  const [wrap, setWrap] = useState(false);
  const lines = code.split('\n').length;
  return (
    <div className={embedded ? 'code-viewer embedded' : 'viewer-scroll code-viewer'}>
      <div className="code-card">
        <div className="code-head">
          <span className="pill pill-gray">{langName}</span>
          <span className="muted small">{lines.toLocaleString()} line{lines === 1 ? '' : 's'}{code.length > MAX_HIGHLIGHT ? ' · too large to highlight' : ''}</span>
          <span className="grow" />
          <button className={`btn btn-sm btn-ghost ${wrap ? 'active' : ''}`} onClick={() => setWrap(!wrap)} aria-pressed={wrap}><WrapText size={13} /> Wrap</button>
          <CopyButton text={code} />
        </div>
        <pre className={`code-view numbered ${wrap ? 'wrap' : ''}`}><Lines code={code} lang={lang} /></pre>
      </div>
    </div>
  );
}
