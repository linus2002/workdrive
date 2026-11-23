import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Film, FileArchive, FileQuestion, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { blobRegistry, useDrive } from '../../store/DriveStore';
import { PdfPages, usePdfDocument, FindContext } from '../../viewing/PdfPages';
import { genThumb, langOf, getFileType } from '../../utils/fileTypes';
import Markdown from '../../viewing/Markdown';
import { CodeViewer } from '../../viewing/CodeView';
import AudioPlayer from '../../viewing/AudioPlayer';
import { formatSize } from '../../utils/format';
import { sampleSheet, sampleSlides, sampleText, sampleArchive } from '../../utils/sampleContent';
import { FileGlyph } from '../common';
import { fileBlob } from '../../store/useItemActions';
import { readZipIndex, safeZipPath, ZipError } from '../../utils/zip';
import { parseCsv } from '../../utils/csv';

export const realUrl = (item) => blobRegistry.get(item.id)?.url || item.dataUrl || null;

/**
 * URL that is safe to open in a new tab, or null. A blob: or data: URL runs with this app's origin, so only
 * types the browser displays without running page scripts are allowed (no SVG, HTML or XML, whatever the extension).
 */
const NEW_TAB_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp|bmp|avif)|video\/(mp4|webm|ogg|quicktime))$/i;
export function newTabUrl(item) {
  const entry = blobRegistry.get(item.id);
  if (entry) return NEW_TAB_TYPES.test(entry.blob?.type || '') ? entry.url : null;
  const m = /^data:([^;,]+)/i.exec(item.dataUrl || '');
  return m && NEW_TAB_TYPES.test(m[1]) ? item.dataUrl : null;
}

export function ImageViewer({ item, zoom }) {
  const url = realUrl(item) || (item.thumb?.startsWith('gen:') ? genThumb(item.thumb.slice(4)) : genThumb(1));
  return (
    <div className="viewer-center checker">
      <img src={url} alt={item.name} className="preview-img" style={{ transform: `scale(${zoom})` }} draggable={false} />
    </div>
  );
}

function PaperPages({ title, text, zoom, page, setPage }) {
  const pages = useMemo(() => {
    const lines = String(text).split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i += 34) out.push(lines.slice(i, i + 34));
    return out.length ? out : [['']];
  }, [text]);
  useEffect(() => { setPage?.(1); }, [text]); // eslint-disable-line
  return (
    <div className="pages" style={{ '--zoom': zoom }}>
      {pages.map((ls, i) => (
        <div key={i} className="paper" id={`page-${i + 1}`}>
          {i === 0 && title && <h1>{title}</h1>}
          {ls.map((l, j) => (l.trim() ? <p key={j}>{l}</p> : <br key={j} />))}
          <div className="paper-num">{i + 1} / {pages.length}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Most phone browsers show a blank box (or a lone "Open" button) for a PDF inside an iframe, so on touch devices
 * and small screens real PDFs are drawn page by page on canvases instead.
 */
export const pdfNeedsCanvas = () => {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  return !!coarse || window.innerWidth < 760;
};

function PdfCanvasViewer({ item, zoom, onDownload }) {
  const { blobsVersion } = useDrive();
  const pdf = usePdfDocument(() => fileBlob(item), `${item.id}@${item.version || 1}#${blobsVersion}`);
  if (pdf.error) {
    return (
      <NoPreview item={item} onDownload={onDownload}
        text={`${pdf.error} This browser can't show the PDF inline here${onDownload ? ', so download it to open it in a PDF app.' : '.'}`} />
    );
  }
  return <PdfPages pdf={pdf} zoom={zoom} />;
}

/** The browser's own PDF viewer: its text can't be searched from here, so the find bar says so. */
function PdfFrame({ url, title }) {
  const find = useContext(FindContext);
  const setEngine = find?.setEngine;
  useEffect(() => {
    if (!setEngine) return undefined;
    setEngine('none');
    return () => setEngine(null);
  }, [setEngine]);
  return <iframe className="pdf-frame" src={url} title={title} />;
}

/**
 * contained: render pages ourselves even where the browser has a PDF viewer. Used on public link and embed
 * pages, where the browser viewer's own Download / Print buttons would skip the link's download rules.
 */
export function PdfViewer({ item, zoom, onDownload, contained = false }) {
  const url = realUrl(item);
  const [canvas] = useState(() => contained || pdfNeedsCanvas());
  if (url && canvas) return <PdfCanvasViewer item={item} zoom={zoom} onDownload={onDownload} />;
  if (url) return <PdfFrame url={url} title={item.name} />;
  // Uploaded files carry a mime type; if their bytes are missing, say so instead of showing sample text.
  if (item.mime) return <NoPreview item={item} text="This file's contents aren't available in this browser. Upload it again to preview it." />;
  return <div className="viewer-scroll"><PaperPages title={item.name.replace(/\.pdf$/i, '')} text={sampleText(item).split('\n').slice(item.content ? 0 : 2).join('\n')} zoom={zoom} /></div>;
}

export function TextViewer({ item, editing, draft, setDraft, mono = true }) {
  // Uploads keep their text inline only under 1 MB; bigger ones are read from the stored bytes.
  const fromBytes = item.content == null && (!!realUrl(item) || !!item.mime);
  const loaded = useFileText(item, fromBytes && !editing);
  const text = item.content ?? loaded?.text ?? '';
  const lang = langOf(item.ext);
  const [mode, setMode] = useState('rendered'); // Markdown only: rendered | source
  useEffect(() => { setMode('rendered'); }, [item.id]); // each file opens in Preview mode
  if (editing) {
    if (lang === 'markdown') {
      return (
        <div className="md-split">
          <textarea className="doc-editor mono" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus spellCheck aria-label="Markdown source" />
          <div className="md-split-preview" aria-label="Live preview"><div className="md-page"><Markdown source={draft} /></div></div>
        </div>
      );
    }
    return (
      <div className="viewer-scroll">
        <textarea className={`doc-editor ${mono ? 'mono' : ''}`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus spellCheck={!mono} aria-label="File contents" />
      </div>
    );
  }
  if (fromBytes && loaded === undefined) return <div className="viewer-center"><div className="muted">Loading…</div></div>;
  if (fromBytes && loaded === null) return <NoPreview item={item} text="This file's contents aren't available in this browser. Upload it again to preview it." />;
  if (!text) {
    return <div className="viewer-scroll"><pre className="text-view"><span className="muted">This file is empty.</span></pre></div>;
  }
  if (loaded?.truncated) {
    return (
      <div className="viewer-scroll">
        <div className="sign-message" role="status">Showing the first {formatSize(TEXT_PREVIEW_MAX)} of {formatSize(item.size)}. Download the file to see all of it.</div>
        <CodeViewer code={text} lang={lang === 'markdown' ? null : lang} embedded />
      </div>
    );
  }
  if (lang === 'markdown') {
    return (
      <div className="viewer-scroll md-viewer">
        <div className="md-mode seg-dark" role="tablist" aria-label="Markdown view">
          <button role="tab" aria-selected={mode === 'rendered'} className={mode === 'rendered' ? 'active' : ''} onClick={() => setMode('rendered')}>Preview</button>
          <button role="tab" aria-selected={mode === 'source'} className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}>Source</button>
        </div>
        {mode === 'rendered' ? <div className="md-page"><Markdown source={text} /></div> : <CodeViewer code={text} lang={null} langName="Markdown" embedded />}
      </div>
    );
  }
  if (lang) return <CodeViewer code={lang === 'json' ? prettyJson(text) : text} lang={lang} langName={getFileType(item.ext).name} />;
  return (
    <div className="viewer-scroll">
      <pre className="text-view">{text}</pre>
    </div>
  );
}

/** Minified JSON is re-indented for reading; anything that doesn't parse is shown as-is. */
function prettyJson(text) {
  if (text.length > 2_000_000 || text.split('\n').length > 3) return text;
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

export function AudioViewer({ item }) {
  return <AudioPlayer item={item} />;
}

export function DocViewer({ item, editing, draft, setDraft, zoom }) {
  const uploadedBinary = !!realUrl(item) && item.content == null;
  if (uploadedBinary) return <NoPreview item={item} text="Uploaded Office documents can't be rendered in this prototype. Download the file to open it in a desktop app." />;
  if (editing) {
    return (
      <div className="viewer-scroll">
        <div className="paper editing" style={{ '--zoom': 1 }}>
          <textarea className="doc-editor paper-editor" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder="Start typing…" aria-label="Document body" />
        </div>
      </div>
    );
  }
  const text = item.content ?? sampleText(item);
  return <div className="viewer-scroll"><PaperPages text={text || ' '} zoom={zoom} /></div>;
}

const col = (i) => String.fromCharCode(65 + (i % 26));

/** Rows of an uploaded CSV read from its bytes: undefined while loading, null if unavailable. */
/** Most text shown in a preview; bigger files show the start with a note (reading all of it can freeze the tab). */
export const TEXT_PREVIEW_MAX = 2 * 1024 * 1024;

/**
 * Text of a file read from its stored bytes: undefined while loading, null if unavailable,
 * else { text, truncated }. Only the first TEXT_PREVIEW_MAX bytes are read.
 */
function useFileText(item, active) {
  const { blobsVersion } = useDrive();
  const [state, setState] = useState({ key: null, value: undefined });
  const key = active ? `${item.id}@${item.version || 1}#${blobsVersion}` : null;
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    fileBlob(item)
      .then((b) => (b ? b.slice(0, TEXT_PREVIEW_MAX).text().then((text) => ({ text, truncated: b.size > TEXT_PREVIEW_MAX })) : null))
      .then((value) => { if (alive) setState({ key, value }); })
      .catch(() => { if (alive) setState({ key, value: null }); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- key identifies the item version
  return state.key === key ? state.value : undefined;
}

function useCsvRows(item, active) {
  const value = useFileText(item, active);
  return useMemo(() => (value == null ? value : parseCsv(value.text)), [value]);
}

/** True for a CSV the user uploaded (its rows come from the file, not item.sheet or sample data). */
export const isUploadedCsv = (item) => item.ext === 'csv' && !item.sheet && (!!realUrl(item) || !!item.mime);

export function SheetViewer({ item, editing, sheet, setSheet }) {
  const uploadedBinary = !!realUrl(item) && !item.sheet;
  const csv = isUploadedCsv(item);
  const csvRows = useCsvRows(item, csv && !editing);
  if (uploadedBinary && !['csv'].includes(item.ext)) return <NoPreview item={item} text="Uploaded spreadsheets can't be rendered in this prototype. Download to open in a spreadsheet app." />;
  if (csv && !editing && csvRows === undefined) return <div className="viewer-center"><div className="muted">Loading…</div></div>;
  if (csv && !editing && csvRows === null) return <NoPreview item={item} text="This file's contents aren't available in this browser. Upload it again to preview it." />;
  const rows = editing ? sheet : csv ? csvRows : sampleSheet(item);
  const width = Math.max(6, ...rows.map((r) => r.length));
  const height = Math.max(editing ? rows.length : 18, rows.length);
  const set = (r, c, v) => setSheet((s) => {
    const n = s.map((row) => [...row]);
    while (n.length <= r) n.push([]);
    while (n[r].length <= c) n[r].push('');
    n[r][c] = v;
    return n;
  });
  return (
    <div className="viewer-scroll sheet-scroll">
      <div className="sheet-wrap">
        <table className="sheet">
          <thead><tr><th className="corner" />{Array.from({ length: width }).map((_, c) => <th key={c}>{col(c)}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: height }).map((_, r) => (
              <tr key={r}>
                <th>{r + 1}</th>
                {Array.from({ length: width }).map((_, c) => {
                  const v = rows[r]?.[c] ?? '';
                  const num = v !== '' && !isNaN(Number(v));
                  return editing ? (
                    <td key={c} className="edit"><input value={v} onChange={(e) => set(r, c, e.target.value)} aria-label={`Cell ${col(c)}${r + 1}`} /></td>
                  ) : <td key={c} className={`${num ? 'num' : ''} ${r === 0 ? 'hdr' : ''}`}>{num ? Number(v).toLocaleString() : v}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {editing && (
          <div className="sheet-tools">
            <button className="btn btn-secondary btn-sm" onClick={() => setSheet((s) => [...s, Array(width).fill('')])}><Plus size={14} /> Row</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSheet((s) => s.map((r) => [...r, '']))}><Plus size={14} /> Column</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SlidesViewer({ item, editing, slides, setSlides }) {
  const uploadedBinary = !!realUrl(item) && !item.slides;
  const list = editing ? slides : sampleSlides(item);
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [item.id]); // each file starts on its first slide
  // Find in file: slides containing the query are marked in the rail; if this slide has none, go to the first that does.
  const findQ = (useContext(FindContext)?.query || '').toLowerCase();
  const slideHit = (sl) => !!findQ && `${sl.title}\n${sl.body}`.toLowerCase().includes(findQ);
  const listRef = useRef(list);
  listRef.current = list;
  useEffect(() => {
    if (!findQ || editing) return;
    setIdx((i) => {
      const l = listRef.current;
      if (l[i] && `${l[i].title}\n${l[i].body}`.toLowerCase().includes(findQ)) return i;
      const j = l.findIndex((sl) => `${sl.title}\n${sl.body}`.toLowerCase().includes(findQ));
      return j >= 0 ? j : i;
    });
  }, [findQ, editing]);
  useEffect(() => { if (idx >= list.length) setIdx(Math.max(0, list.length - 1)); }, [list.length, idx]);
  useEffect(() => {
    const onKey = (e) => {
      if (editing || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      if (e.key === 'PageDown') setIdx((i) => Math.min(list.length - 1, i + 1));
      if (e.key === 'PageUp') setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, list.length]);
  if (uploadedBinary) return <NoPreview item={item} text="Uploaded presentations can't be rendered in this prototype. Download to open in a presentation app." />;
  const s = list[idx] || { title: '', body: '' };
  const upd = (patch) => setSlides((arr) => arr.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  return (
    <div className="slides-viewer">
      <div className="slide-rail">
        {list.map((sl, i) => (
          <button key={i} className={`slide-thumb ${i === idx ? 'active' : ''} ${slideHit(sl) ? 'find-hit' : ''}`} onClick={() => setIdx(i)} aria-label={`Slide ${i + 1}${slideHit(sl) ? ', contains a match' : ''}`}>
            <span className="slide-n">{i + 1}</span>
            <span className="slide-mini"><strong>{sl.title}</strong><span>{sl.body.split('\n')[0]}</span></span>
          </button>
        ))}
        {editing && <button className="btn btn-secondary btn-sm full" onClick={() => { setSlides((a) => [...a, { title: 'New slide', body: '' }]); setIdx(list.length); }}><Plus size={14} /> Add slide</button>}
      </div>
      <div className="slide-stage">
        <div className="slide">
          {editing ? (
            <>
              <input className="slide-title-input" value={s.title} onChange={(e) => upd({ title: e.target.value })} aria-label="Slide title" />
              <textarea className="slide-body-input" value={s.body} onChange={(e) => upd({ body: e.target.value })} aria-label="Slide body" />
            </>
          ) : (
            <>
              <h2>{s.title}</h2>
              <div className="slide-body">{s.body.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>
            </>
          )}
        </div>
        <div className="slide-nav">
          <button className="icon-btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)} aria-label="Previous slide"><ChevronLeft size={18} /></button>
          <span>Slide {idx + 1} of {list.length}</span>
          <button className="icon-btn" disabled={idx >= list.length - 1} onClick={() => setIdx(idx + 1)} aria-label="Next slide"><ChevronRight size={18} /></button>
          {editing && list.length > 1 && <button className="icon-btn" onClick={() => setSlides((a) => a.filter((_, i) => i !== idx))} aria-label="Delete slide" data-tip="Delete slide"><Trash2 size={16} /></button>}
        </div>
      </div>
    </div>
  );
}

/** contained: hide the browser's own download / picture-in-picture options (public link and embed pages). */
export function VideoViewer({ item, contained = false }) {
  const url = realUrl(item);
  if (url) {
    const lock = contained ? { controlsList: 'nodownload noremoteplayback', disablePictureInPicture: true, onContextMenu: (e) => e.preventDefault() } : {};
    return <div className="viewer-center dark"><video className="preview-video" src={url} controls autoPlay {...lock} /></div>;
  }
  return (
    <div className="viewer-center dark">
      <div className="video-placeholder">
        <Film size={48} strokeWidth={1.2} />
        <div className="strong">{item.name}</div>
        <div className="muted small">{formatSize(item.size)} · Sample video</div>
        <p>This is a sample file without media data. Upload an MP4 to play it here with full playback controls.</p>
      </div>
    </div>
  );
}

export function ArchiveViewer({ item, onExtract }) {
  // Real .zip files (uploaded or generated samples) are listed from their actual central directory.
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setEntries(null); setError(null);
    if (item.ext !== 'zip') { setEntries(sampleArchive(item)); return undefined; }
    fileBlob(item)
      .then((b) => b.arrayBuffer())
      .then((buf) => { if (alive) setEntries(readZipIndex(buf).filter((e) => !e.dir && safeZipPath(e.path)).map((e) => ({ name: e.path, size: e.size }))); })
      .catch((e) => { if (alive) { setError(e instanceof ZipError ? e.message : 'Could not read this archive.'); setEntries([]); } });
    return () => { alive = false; };
  }, [item.id, item.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!entries) return <div className="viewer-center"><span className="muted">Reading archive…</span></div>;
  return (
    <div className="viewer-scroll">
      <div className="archive-box">
        <div className="archive-head"><FileArchive size={20} /> <strong>{item.name}</strong> <span className="muted">· {entries.length} file{entries.length === 1 ? '' : 's'}</span>
          {onExtract && !error && entries.length > 0 && <button className="btn btn-secondary btn-sm ml-auto" onClick={onExtract}>Extract here</button>}
        </div>
        {error && <div className="banner warning">{error}</div>}
        <ul>
          {entries.map((e) => (
            <li key={e.name}><FileGlyph ext={e.name.split('.').pop()} size={22} /><span className="grow truncate">{e.name}</span><span className="muted small">{formatSize(e.size)}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function NoPreview({ item, text, onDownload }) {
  return (
    <div className="viewer-center">
      <div className="no-preview">
        <FileGlyph ext={item.ext} size={64} />
        <div className="strong">{item.name}</div>
        <p className="muted">{text || 'Preview is not available for this file type.'}</p>
        {onDownload && <button className="btn btn-primary" onClick={onDownload}><Download size={15} /> Download</button>}
      </div>
    </div>
  );
}

export { FileQuestion };
