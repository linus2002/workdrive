import { useEffect, useMemo, useRef, useState } from 'react';
import { GitCompare, ChevronsUpDown } from 'lucide-react';
import { useDrive, blobRegistry, versionKey } from '../store/DriveStore';
import { versionNo } from '../store/selectors';
import { getFileType, genThumb } from '../utils/fileTypes';
import { formatDateTime } from '../utils/format';
import { sampleSheet, sampleSlides } from '../utils/sampleContent';
import { extractText } from '../search/extract';
import { Modal } from '../components/common';
import { diffLines, diffSheets, foldRows } from './diff';

/** A version (or the current file) as an item-shaped object, so the normal readers work on it. */
function sideItem(item, ref) {
  if (ref === 'current') return { item, label: `Current (v${versionNo(item)})`, at: item.modifiedAt, by: item.modifiedBy };
  const v = (item.versions || []).find((x) => x.id === ref);
  if (!v) return null;
  return {
    item: { ...item, id: versionKey(item.id, v.no), content: v.content, sheet: v.sheet, slides: v.slides, dataUrl: v.dataUrl, mime: v.mime, size: v.size, thumb: item.thumb },
    label: `Version ${v.no}`, at: v.at, by: v.by,
  };
}

const parseCsv = (text) => text.replace(/\r/g, '').split('\n').filter((l, i, a) => l || i < a.length - 1).map((l) => {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
});

/** Comparable contents: { kind: 'text'|'sheet'|'image'|'none', text?, rows?, url?, note? } */
async function loadComparable(it) {
  const cat = getFileType(it.ext).category;
  const reg = blobRegistry.get(it.id);
  if (cat === 'image') return { kind: 'image', url: reg?.url || it.dataUrl || genThumb(it.thumb?.replace('gen:', '') || 1) };
  if (cat === 'spreadsheet') {
    if (it.sheet || (!reg && !it.dataUrl)) return { kind: 'sheet', rows: sampleSheet(it) };
    if (it.ext === 'csv' && reg) return { kind: 'sheet', rows: parseCsv(await reg.blob.text()) };
  }
  if (cat === 'presentation' && (it.slides || !reg)) {
    return { kind: 'text', text: sampleSlides(it).map((s, i) => `── Slide ${i + 1} ──\n${s.title}\n${s.body}`).join('\n\n') };
  }
  if (cat === 'text') return { kind: 'text', text: it.content ?? (reg ? await reg.blob.text() : '') };
  if (['document', 'pdf', 'spreadsheet', 'presentation'].includes(cat)) {
    const r = await extractText(it, { ocr: false });
    if (r) return { kind: 'text', text: r.text, note: cat === 'pdf' || reg ? 'Compared as extracted text; formatting is not compared.' : '' };
  }
  return { kind: 'none' };
}

function Segs({ side }) {
  if (!side) return null;
  if (!side.segs) return side.text || '​';
  return side.segs.map((s, i) => (s.ch ? <mark key={i} className="cmp-word">{s.t}</mark> : <span key={i}>{s.t}</span>));
}

function TextDiff({ rows, mode, fold, eolNote }) {
  const shown = useMemo(() => (fold ? foldRows(rows) : rows), [rows, fold]);
  if (!rows.some((r) => r.type !== 'same')) return <div className="cmp-same">{eolNote ? `The only difference is the line ending: ${eolNote.charAt(0).toLowerCase()}${eolNote.slice(1)}` : 'These versions have identical contents.'}</div>;
  if (mode === 'inline') {
    return (
      <div className="cmp-table inline" role="table" aria-label="Changes">
        {shown.map((r, i) => {
          if (r.type === 'fold') return <div key={i} className="cmp-fold"><ChevronsUpDown size={13} /> {r.count} unchanged line{r.count === 1 ? '' : 's'}</div>;
          const parts = r.type === 'mod' ? [['del', r.left], ['add', r.right]] : r.type === 'same' ? [['same', r.right]] : [[r.type, r.left || r.right]];
          return parts.map(([t, side], j) => (
            <div key={`${i}-${j}`} className={`cmp-row ${t}`} role="row">
              <span className="cmp-no">{t !== 'add' ? (r.left?.no ?? '') : ''}</span>
              <span className="cmp-no">{t !== 'del' ? (r.right?.no ?? '') : ''}</span>
              <span className="cmp-sign">{t === 'add' ? '+' : t === 'del' ? '−' : ''}</span>
              <span className="cmp-text"><Segs side={side} /></span>
            </div>
          ));
        })}
      </div>
    );
  }
  return (
    <div className="cmp-table split" role="table" aria-label="Changes side by side">
      {shown.map((r, i) => (r.type === 'fold'
        ? <div key={i} className="cmp-fold"><ChevronsUpDown size={13} /> {r.count} unchanged line{r.count === 1 ? '' : 's'}</div>
        : (
          <div key={i} className={`cmp-row ${r.type}`} role="row">
            <span className="cmp-no">{r.left?.no ?? ''}</span>
            <span className={`cmp-text left ${r.left ? '' : 'empty'}`}><Segs side={r.left} /></span>
            <span className="cmp-no">{r.right?.no ?? ''}</span>
            <span className={`cmp-text right ${r.right ? '' : 'empty'}`}><Segs side={r.right} /></span>
          </div>
        )))}
    </div>
  );
}

const colName = (i) => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

function SheetDiff({ diff }) {
  return (
    <div className="cmp-sheet-wrap">
      <table className="sheet cmp-sheet">
        <thead><tr><th className="corner" />{Array.from({ length: diff.cols }).map((_, c) => <th key={c}>{colName(c)}</th>)}</tr></thead>
        <tbody>
          {diff.cells.map((row, r) => (
            <tr key={r}>
              <th>{r + 1}</th>
              {row.map((cell, c) => (
                <td key={c} className={`cmp-cell ${cell.type}`} title={cell.type === 'same' ? undefined : `Was: ${cell.old || '(empty)'}\nNow: ${cell.value || '(empty)'}`}>
                  {cell.type === 'mod' ? <><del>{cell.old}</del> <ins>{cell.value}</ins></> : cell.type === 'del' ? <del>{cell.old}</del> : cell.value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImageDiff({ a, b, labels }) {
  const [mode, setMode] = useState('side');
  const [pos, setPos] = useState(50);
  const canvasRef = useRef(null);
  const [diffInfo, setDiffInfo] = useState(null);
  useEffect(() => {
    if (mode !== 'diff') return undefined;
    let alive = true;
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
    Promise.all([load(a.url), load(b.url)]).then(([ia, ib]) => {
      if (!alive) return;
      const w = Math.min(1600, ib.naturalWidth || 800); const h = Math.round(w * ((ib.naturalHeight || 500) / (ib.naturalWidth || 800)));
      const c = canvasRef.current; c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const read = (img) => { ctx.clearRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h); return ctx.getImageData(0, 0, w, h); };
      const da = read(ia).data; const base = read(ib); const db = base.data;
      let changed = 0;
      for (let p = 0; p < db.length; p += 4) {
        const d = Math.abs(da[p] - db[p]) + Math.abs(da[p + 1] - db[p + 1]) + Math.abs(da[p + 2] - db[p + 2]);
        const g = (db[p] + db[p + 1] + db[p + 2]) / 3;
        if (d > 40) { changed++; db[p] = 239; db[p + 1] = 68; db[p + 2] = 68; db[p + 3] = 255; }
        else { db[p] = db[p + 1] = db[p + 2] = 200 + g * 0.2; }
      }
      ctx.putImageData(base, 0, 0);
      setDiffInfo(`${((changed / (w * h)) * 100).toFixed(1)}% of pixels differ`);
    }).catch(() => alive && setDiffInfo('Could not compare these images pixel by pixel.'));
    return () => { alive = false; };
  }, [mode, a.url, b.url]);
  return (
    <div className="cmp-image">
      <div className="seg" role="tablist" aria-label="Image comparison">
        {[['side', 'Side by side'], ['swipe', 'Swipe'], ['diff', 'Difference']].map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'active' : ''} onClick={() => setMode(k)}>{l}</button>)}
      </div>
      {mode === 'side' && (
        <div className="cmp-img-side">
          <figure><img src={a.url} alt={labels[0]} /><figcaption>{labels[0]}</figcaption></figure>
          <figure><img src={b.url} alt={labels[1]} /><figcaption>{labels[1]}</figcaption></figure>
        </div>
      )}
      {mode === 'swipe' && (
        <div className="cmp-swipe">
          <div className="cmp-swipe-box">
            <img src={b.url} alt={labels[1]} />
            <div className="cmp-swipe-top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}><img src={a.url} alt={labels[0]} /></div>
            <div className="cmp-swipe-line" style={{ left: `${pos}%` }} />
          </div>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Swipe position" />
          <div className="muted small cmp-swipe-labels"><span>← {labels[0]}</span><span>{labels[1]} →</span></div>
        </div>
      )}
      {mode === 'diff' && (
        <div className="cmp-diffimg">
          <canvas ref={canvasRef} />
          <div className="muted small">{diffInfo || 'Comparing…'} · changed areas are shown in red</div>
        </div>
      )}
    </div>
  );
}

export default function CompareDialog({ itemId, left, right, onClose }) {
  const { state, api } = useDrive();
  const item = state.items[itemId];
  const versions = item?.versions || [];
  const options = item ? [{ id: 'current', label: `Current version (v${versionNo(item)})` }, ...versions.map((v) => ({ id: v.id, label: `Version ${v.no} · ${formatDateTime(v.at)}` }))] : [];
  // Sides are always ordered by version number: older on the left (red), newer on the right (green).
  const rank = (ref) => (ref === 'current' ? Infinity : (versions.find((v) => v.id === ref)?.no ?? 0));
  const ordered = (x, y) => (rank(x) <= rank(y) ? [x, y] : [y, x]);
  const [pair, setPair] = useState(() => ordered(left || versions[0]?.id || 'current', right || 'current'));
  const [a, b] = pair;
  const setA = (v) => setPair(ordered(v, b));
  const setB = (v) => setPair(ordered(a, v));
  const [mode, setMode] = useState(() => (window.innerWidth < 900 ? 'inline' : 'split'));
  const [fold, setFold] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!item) return undefined;
    let alive = true;
    setData(null);
    const sa = sideItem(item, a); const sb = sideItem(item, b);
    if (!sa || !sb) { setData({ error: 'That version no longer exists.' }); return undefined; }
    Promise.all([loadComparable(sa.item), loadComparable(sb.item)])
      .then(([x, y]) => alive && setData({ x, y, sa, sb }))
      .catch(() => alive && setData({ error: 'Could not read one of these versions.' }));
    return () => { alive = false; };
  }, [item?.id, item?.version, a, b]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (item) api.logEvent('Versions compared', item.name, `${sideItem(item, a)?.label} ↔ ${sideItem(item, b)?.label}`, { itemId: item.id }); }, [a, b]); // eslint-disable-line react-hooks/exhaustive-deps

  const textDiff = useMemo(() => (data?.x?.kind === 'text' && data?.y?.kind === 'text' ? diffLines(data.x.text, data.y.text) : null), [data]);
  const sheetDiff = useMemo(() => (data?.x?.kind === 'sheet' && data?.y?.kind === 'sheet' ? diffSheets(data.x.rows, data.y.rows) : null), [data]);
  if (!item) return null;
  const stats = textDiff?.stats || sheetDiff?.stats;
  const nameOf = (id) => (id === state.meId ? 'You' : state.users.find((u) => u.id === id)?.name || 'Someone');

  return (
    <Modal title="Compare versions" subtitle={item.name} onClose={onClose} width={1240} className="compare-modal" icon={<GitCompare size={18} />}>
      <div className="cmp-bar">
        <label className="cmp-pick"><span className="cmp-tag del">Older</span>
          <select className="select select-sm" value={a} onChange={(e) => setA(e.target.value)} aria-label="Older version">{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </label>
        <label className="cmp-pick"><span className="cmp-tag add">Newer</span>
          <select className="select select-sm" value={b} onChange={(e) => setB(e.target.value)} aria-label="Newer version">{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </label>
        <span className="grow" />
        {stats && (
          <span className="cmp-stats" aria-live="polite">
            <span className="cmp-stat add">+{stats.added} added</span><span className="cmp-stat del">−{stats.removed} removed</span><span className="cmp-stat mod">~{stats.changed} changed</span>
          </span>
        )}
        {textDiff && (
          <>
            <div className="seg" role="tablist" aria-label="Layout">
              <button role="tab" aria-selected={mode === 'split'} className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>Side by side</button>
              <button role="tab" aria-selected={mode === 'inline'} className={mode === 'inline' ? 'active' : ''} onClick={() => setMode('inline')}>Inline</button>
            </div>
            <label className="check-row"><input type="checkbox" checked={fold} onChange={(e) => setFold(e.target.checked)} /> Only changes</label>
          </>
        )}
      </div>
      {data?.sa && (
        <div className="cmp-heads">
          <div><strong>{data.sa.label}</strong> <span className="muted small">· {nameOf(data.sa.by)} · {formatDateTime(data.sa.at)}</span></div>
          <div><strong>{data.sb.label}</strong> <span className="muted small">· {nameOf(data.sb.by)} · {formatDateTime(data.sb.at)}</span></div>
        </div>
      )}
      <div className="cmp-body">
        {a === b && <div className="cmp-same">Pick two different versions to compare.</div>}
        {a !== b && !data && <div className="cmp-same muted">Reading both versions…</div>}
        {a !== b && data?.error && <div className="banner warning">{data.error}</div>}
        {a !== b && textDiff && <><TextDiff rows={textDiff.rows} mode={mode} fold={fold} eolNote={textDiff.eolNote} />{textDiff.eolNote && textDiff.rows.some((r) => r.type !== 'same') && <div className="muted small cmp-note">{textDiff.eolNote}</div>}{(data.x.note || data.y.note) && <div className="muted small cmp-note">{data.x.note || data.y.note}</div>}</>}
        {a !== b && sheetDiff && <SheetDiff diff={sheetDiff} />}
        {a !== b && data?.x?.kind === 'image' && data?.y?.kind === 'image' && <ImageDiff a={data.x} b={data.y} labels={[data.sa.label, data.sb.label]} />}
        {a !== b && data?.x && !textDiff && !sheetDiff && !(data.x.kind === 'image' && data.y.kind === 'image') && (
          <div className="cmp-same">These versions can't be compared in the browser (for example, legacy Office formats or video). Download both versions from Version history to compare them in a desktop app.</div>
        )}
      </div>
    </Modal>
  );
}

/** Whether a file type has a meaningful comparison view. */
export const comparable = (item) => ['text', 'document', 'pdf', 'spreadsheet', 'presentation', 'image'].includes(getFileType(item?.ext).category);
