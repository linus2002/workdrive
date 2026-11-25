// First-page previews for grid cards (like Google Drive): the real start of a document, the top-left cells of a
// spreadsheet, the first slide, the first lines of code. Everything is drawn with HTML in container-relative
// units, so it scales with the card.
import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useDrive, blobRegistry } from '../../store/DriveStore';
import { getFileType } from '../../utils/fileTypes';
import { sampleSheet, sampleSlides, sampleText } from '../../utils/sampleContent';
import { parseCsv } from '../../utils/csv';
import { FileGlyph } from '../common';
import { useVideoThumb } from './useVideoThumb';
import { formatDuration } from '../../utils/videoThumb';

const PROSE_TEXT = new Set(['txt', 'md', 'markdown', 'rtf', 'log']);
const MAX_ROWS = 24;
const MAX_COLS = 8;

const hasBytes = (item) => !!(blobRegistry.get(item.id) || item.dataUrl);
const blobOf = (item) => blobRegistry.get(item.id)?.blob || (item.dataUrl ? fetch(item.dataUrl).then((r) => r.blob()) : null);
/** An upload whose bytes aren't in this browser: nothing real to show, and no sample either. */
const missingUpload = (item) => !!item.mime && !hasBytes(item) && item.content == null && !item.sheet && !item.slides;

/** What to draw for a file: { kind: 'doc'|'code'|'sheet'|'slide', ... }, computed without reading bytes when possible. */
function syncContent(item) {
  const cat = getFileType(item.ext).category;
  if (cat === 'spreadsheet') {
    if (item.sheet) return { kind: 'sheet', rows: item.sheet };
    if (!hasBytes(item)) return missingUpload(item) ? null : { kind: 'sheet', rows: sampleSheet(item) };
    return undefined; // read from the file
  }
  if (cat === 'presentation') {
    if (item.slides?.length) return { kind: 'slide', ...item.slides[0] };
    if (!hasBytes(item)) return missingUpload(item) ? null : { kind: 'slide', ...sampleSlides(item)[0] };
    return undefined;
  }
  if (cat === 'document' || cat === 'pdf') {
    if (item.content != null) return { kind: 'doc', paras: paragraphsOf(item.content) };
    if (!hasBytes(item)) return missingUpload(item) ? null : { kind: 'doc', paras: paragraphsOf(sampleText(item)) };
    return cat === 'pdf' ? null : undefined; // PDFs with bytes are rendered by pdf.js (usePdfThumb)
  }
  if (cat === 'text' || cat === 'code') {
    const kind = PROSE_TEXT.has(item.ext) ? 'doc' : 'code';
    const wrap = (text) => (kind === 'doc' ? { kind, paras: paragraphsOf(text) } : { kind, text: text.slice(0, 3000) });
    if (item.content != null) return wrap(item.content);
    if (!hasBytes(item)) return null;
    return undefined;
  }
  return null;
}

async function readContent(item) {
  const cat = getFileType(item.ext).category;
  const blob = await blobOf(item);
  if (!blob) return null;
  const { docxParagraphs, xlsxGrid, pptxFirstSlide } = await import('../../search/extract');
  if (cat === 'spreadsheet') {
    if (item.ext === 'csv') return { kind: 'sheet', rows: parseCsv(await blob.slice(0, 32 * 1024).text()).slice(0, MAX_ROWS) };
    if (item.ext === 'xlsx') return { kind: 'sheet', rows: await xlsxGrid(blob, MAX_ROWS, MAX_COLS) };
    return null;
  }
  if (cat === 'presentation') return item.ext === 'pptx' ? { kind: 'slide', ...(await pptxFirstSlide(blob)) } : null;
  if (cat === 'document') {
    if (item.ext !== 'docx') return null;
    const paras = await docxParagraphs(blob);
    if (paras[0] && paras[0].text.length < 120) paras[0] = { ...paras[0], heading: true }; // a short opening line is the title
    return { kind: 'doc', paras };
  }
  const text = await blob.slice(0, 8 * 1024).text();
  return PROSE_TEXT.has(item.ext) ? { kind: 'doc', paras: paragraphsOf(text) } : { kind: 'code', text };
}

// Read uploaded files one at a time and remember the result per file version.
const cache = new Map();
let queue = Promise.resolve();
function loadContent(key, item) {
  if (!cache.has(key)) {
    const job = queue.then(() => readContent(item)).catch(() => null);
    queue = job;
    cache.set(key, job);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

function useCardContent(item) {
  const { blobsVersion } = useDrive();
  const sync = syncContent(item);
  const key = sync === undefined ? `${item.id}@${item.version || 1}#${blobsVersion}` : null;
  const [loaded, setLoaded] = useState({ key: null, value: null });
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    loadContent(key, item).then((value) => { if (alive) setLoaded({ key, value }); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- key identifies the file version
  if (sync !== undefined) return sync;
  return loaded.key === key ? loaded.value : 'loading';
}

/** Plain text -> [{ text, heading }]: the first line is the title; short lines on their own are headings. */
function paragraphsOf(text) {
  const blocks = String(text).slice(0, 2500).replace(/\r/g, '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.slice(0, 30).map((b, i) => ({
    text: b.replace(/^#{1,6}\s+/, ''),
    heading: i === 0 || /^#{1,6}\s/.test(b) || (b.length < 60 && !b.includes('\n') && !/[.,:;!?]$/.test(b) && !/^[•\-*\d]/.test(b)),
  }));
}

const isNum = (v) => /^-?[\d,]*\.?\d+%?$/.test(String(v).trim());

function DocPage({ paras }) {
  return (
    <div className="tp-page" aria-hidden="true">
      {paras.map((p, i) => (p.heading
        ? <div key={i} className={i === 0 ? 'tp-title' : 'tp-h'}>{p.text}</div>
        : <p key={i} className="tp-p">{p.text}</p>))}
    </div>
  );
}

function SheetPage({ rows }) {
  const width = Math.min(MAX_COLS, Math.max(4, ...rows.slice(0, MAX_ROWS).map((r) => r.length)));
  const body = rows.slice(0, MAX_ROWS);
  return (
    <div className="tp-sheet" aria-hidden="true">
      <table>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className={i === 0 ? 'hdr' : ''}>
              {Array.from({ length: width }).map((_, c) => {
                const v = r[c] ?? '';
                return <td key={c} className={i > 0 && isNum(v) ? 'num' : ''}>{String(v)}</td>;
              })}
            </tr>
          ))}
          {Array.from({ length: Math.max(0, 14 - body.length) }).map((_, i) => (
            <tr key={`e${i}`}>{Array.from({ length: width }).map((__, c) => <td key={c} />)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlidePage({ title, body, color }) {
  return (
    <div className="tp-slide-wrap" aria-hidden="true">
      <div className="tp-slide" style={{ '--tc': color }}>
        <div className="tp-slide-title">{title}</div>
        {body && <div className="tp-slide-body">{body}</div>}
      </div>
    </div>
  );
}

const finePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

/** A frame of the video; hovering plays it muted in the card (mouse only). */
function VideoPreview({ item }) {
  const thumb = useVideoThumb(item, true);
  const src = blobRegistry.get(item.id)?.url || item.dataUrl || null;
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const enter = () => { if (src && finePointer()) timer.current = setTimeout(() => setPlaying(true), 350); };
  const leave = () => { clearTimeout(timer.current); setPlaying(false); };
  const duration = formatDuration(thumb?.duration);
  return (
    <div className="tp-video" onMouseEnter={enter} onMouseLeave={leave}>
      {thumb && <img src={thumb.url} alt={`Frame from ${item.name}`} draggable={false} />}
      {playing && <video src={src} muted autoPlay loop playsInline aria-hidden="true" />}
      {!playing && <span className="play-badge" aria-hidden="true"><Play size={18} fill="currentColor" /></span>}
      {duration && <span className="tp-duration">{duration}</span>}
    </div>
  );
}

/** The grid card's preview area for anything that isn't an image or a rendered PDF page. */
export default function CardPreview({ item }) {
  const t = getFileType(item.ext);
  if (t.category === 'video') return <VideoPreview item={item} />;
  return <DocumentPreview item={item} t={t} />;
}

function DocumentPreview({ item, t }) {
  const content = useCardContent(item);
  if (content === 'loading') return <div className="tp-page" aria-hidden="true" />;
  if (content?.kind === 'doc' && content.paras.length) return <DocPage paras={content.paras} />;
  if (content?.kind === 'code' && content.text.trim()) return <pre className="tp-code" aria-hidden="true">{content.text}</pre>;
  if (content?.kind === 'sheet' && content.rows.length) return <SheetPage rows={content.rows} />;
  if (content?.kind === 'slide' && (content.title || content.body)) return <SlidePage title={content.title} body={content.body} color={t.color} />;
  return (
    <div className="card-icon-thumb">
      <FileGlyph ext={item.ext} size={56} />
    </div>
  );
}
