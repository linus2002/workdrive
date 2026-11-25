import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadPdfjs } from '../utils/pdfThumb';

const EXACT_PAGES = 60;
const MAX_MATCHES = 2000;

/**
 * Find-in-file, provided by the file preview: { query, index, setEngine(name|null), report({ count, pending }) }.
 * A viewer that searches by itself (PDF canvases) calls setEngine('pdf'); one that can't be searched calls
 * setEngine('none'); otherwise the preview searches the rendered text. Absent outside the preview.
 */
export const FindContext = createContext(null);

const mul = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

/** A page's text as one lower-cased string, plus where each pdf.js text item sits in it and on the page. */
function pageText(items, vp) {
  let text = '';
  const segs = [];
  for (const it of items) {
    if (it.str) {
      const m = mul(vp.transform, it.transform);
      const fh = Math.hypot(m[2], m[3]) || 10;
      segs.push({ start: text.length, len: it.str.length, str: it.str, x: m[4], y: m[5], w: it.width * vp.scale, fh });
      text += it.str;
    }
    if (it.hasEOL) text += ' ';
  }
  return { text: text.toLowerCase(), segs, W: vp.width, H: vp.height };
}

let measureCtx = null;
/** Width of `str` relative to the whole text item, estimated with a generic font (pdf.js only gives the item's width). */
function textFrac(str, upTo) {
  if (upTo <= 0) return 0;
  if (upTo >= str.length) return 1;
  try {
    measureCtx ||= document.createElement('canvas').getContext('2d');
    measureCtx.font = '100px Helvetica, Arial, sans-serif';
    const all = measureCtx.measureText(str).width;
    return all ? measureCtx.measureText(str.slice(0, upTo)).width / all : upTo / str.length;
  } catch {
    return upTo / str.length;
  }
}

/** Highlight rectangles (fractions of the page) covering characters [a, b) of a page's text. */
function rectsFor(t, a, b) {
  const out = [];
  for (const s of t.segs) {
    const s0 = Math.max(a, s.start), s1 = Math.min(b, s.start + s.len);
    if (s1 <= s0) continue;
    const f0 = textFrac(s.str, s0 - s.start), f1 = textFrac(s.str, s1 - s.start);
    out.push({ l: (s.x + s.w * f0) / t.W, t: (s.y - s.fh * 0.92) / t.H, w: (s.w * (f1 - f0)) / t.W, h: (s.fh * 1.18) / t.H });
  }
  return out;
}

/** Searches every page's text layer (pdf.js getTextContent) for the preview's find query. */
function usePdfFind(doc, wrapRef) {
  const find = useContext(FindContext);
  const findRef = useRef(find);
  findRef.current = find;
  const query = find?.query || '';
  const [matches, setMatches] = useState([]);
  const cache = useRef(new Map());
  useEffect(() => { cache.current = new Map(); }, [doc]);
  const has = !!find;
  useEffect(() => {
    if (!has) return undefined;
    findRef.current.setEngine('pdf');
    return () => findRef.current?.setEngine(null);
  }, [has]);
  useEffect(() => {
    const f = findRef.current;
    if (!f || !doc) return undefined;
    if (!query) { setMatches([]); f.report({ count: 0, pending: false }); return undefined; }
    let alive = true;
    const q = query.toLowerCase();
    f.report({ count: 0, pending: true });
    (async () => {
      const out = [];
      for (let p = 1; p <= doc.numPages && alive && out.length < MAX_MATCHES; p++) {
        let t = cache.current.get(p);
        if (!t) {
          const page = await doc.getPage(p); // eslint-disable-line no-await-in-loop
          const tc = await page.getTextContent(); // eslint-disable-line no-await-in-loop
          t = pageText(tc.items, page.getViewport({ scale: 1 }));
          cache.current.set(p, t);
        }
        for (let i = t.text.indexOf(q); i >= 0 && out.length < MAX_MATCHES; i = t.text.indexOf(q, i + q.length)) {
          out.push({ page: p, start: i, rects: rectsFor(t, i, i + q.length) });
        }
        if (alive && p % 8 === 0) { setMatches(out.slice()); findRef.current?.report({ count: out.length, pending: true }); }
      }
      if (alive) { setMatches(out); findRef.current?.report({ count: out.length, pending: false }); }
    })().catch(() => { if (alive) findRef.current?.report({ count: 0, pending: false }); });
    return () => { alive = false; };
  }, [doc, query]);

  const cur = matches.length && find ? matches[((find.index % matches.length) + matches.length) % matches.length] : null;
  const curKey = cur ? `${cur.page}:${cur.start}` : '';
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!cur || !wrap) return;
    const pageEl = wrap.querySelector(`[data-page="${cur.page}"]`);
    if (!pageEl) return;
    const pr = pageEl.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const r = cur.rects[0] || { l: 0, t: 0, w: 0, h: 0 };
    wrap.scrollTop += pr.top - wr.top + (r.t + r.h / 2) * pr.height - wrap.clientHeight / 2;
    if (wrap.scrollWidth > wrap.clientWidth) wrap.scrollLeft += pr.left - wr.left + (r.l + r.w / 2) * pr.width - wrap.clientWidth / 2;
  }, [curKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const byPage = useMemo(() => {
    const m = new Map();
    matches.forEach((x) => { if (!m.has(x.page)) m.set(x.page, []); m.get(x.page).push(x); });
    return m;
  }, [matches]);
  return { byPage, cur };
}

/** Load a pdf.js document from a Blob (or a Promise of one). Returns { doc, sizes, error }. */
export function usePdfDocument(source, key) {
  const [res, setRes] = useState({ doc: null, sizes: null, error: null });
  useEffect(() => {
    let alive = true;
    let doc = null;
    setRes({ doc: null, sizes: null, error: null });
    (async () => {
      try {
        const blob = await (typeof source === 'function' ? source() : source);
        if (!blob) throw new Error('This file has no contents to show.');
        const lib = await loadPdfjs();
        doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
        // Every page gets an entry. The first pages are measured; the rest start as placeholders sized like
        // page 1 (marked `estimated`) and are corrected when they scroll into view and render.
        const sizes = [];
        const measured = Math.min(doc.numPages, EXACT_PAGES);
        for (let i = 1; i <= measured; i++) {
          const vp = (await doc.getPage(i)).getViewport({ scale: 1 }); // eslint-disable-line no-await-in-loop
          sizes.push({ w: vp.width, h: vp.height });
        }
        for (let i = measured + 1; i <= doc.numPages; i++) sizes.push({ ...sizes[0], estimated: true });
        if (alive) setRes({ doc, sizes, error: null }); else doc.destroy();
      } catch (e) {
        if (alive) setRes({ doc: null, sizes: null, error: e?.message || 'Could not open this PDF.' });
      }
    })();
    return () => { alive = false; if (doc) doc.destroy(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return res;
}

function PdfPage({ doc, no, cssW, cssH, onMeasure, children }) {
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  // Pages are drawn when they come near the screen and released again when they're far away: a canvas holds
  // about 16 MB at phone pixel density, so keeping every page of a 300-page PDF crashed mobile browsers.
  const [visible, setVisible] = useState(no <= 2);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((es) => {
      const near = es.some((e) => e.isIntersecting);
      setVisible(near);
      if (!near && canvasRef.current) { canvasRef.current.width = 0; canvasRef.current.height = 0; }
    }, { rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !doc) return undefined;
    let task = null; let cancelled = false;
    (async () => {
      const page = await doc.getPage(no);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      onMeasure?.(no, base.width, base.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (cssW / base.width) * dpr });
      const c = canvasRef.current;
      if (!c) return;
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      task = page.render({ canvasContext: ctx, viewport: vp });
      await task.promise.catch(() => {});
    })();
    return () => { cancelled = true; task?.cancel?.(); };
  }, [visible, doc, no, Math.round(cssW)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pdf-page" ref={boxRef} style={{ width: cssW, height: cssH }} data-page={no}>
      <canvas ref={canvasRef} style={{ width: cssW, height: cssH }} aria-label={`Page ${no}`} />
      {children}
      <span className="pdf-page-no">{no}</span>
    </div>
  );
}

/**
 * Renders a PDF as a column of canvases (lazily, as pages scroll into view), with an overlay per page:
 * `overlay(pageNo, cssWidth, cssHeight)` draws markup, signature fields, etc. on top.
 */
export function PdfPages({ pdf, zoom = 1, overlay, maxWidth = 900, className = '', onPageClick }) {
  const { doc, sizes, error } = pdf;
  const wrapRef = useRef(null);
  const found = usePdfFind(doc, wrapRef);
  const [avail, setAvail] = useState(800);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const baseW = Math.max(280, Math.min(maxWidth, avail - 32));
  // Real sizes of pages that were only estimated, learned as they render.
  const [fixed, setFixed] = useState({});
  useEffect(() => { setFixed({}); }, [doc]);
  const onMeasure = (no, w, h) => {
    const s = sizes?.[no - 1];
    if (!s?.estimated || fixed[no]) return;
    if (Math.abs(s.w / s.h - w / h) > 0.001) setFixed((f) => ({ ...f, [no]: { w, h } }));
  };
  return (
    <div className={`viewer-scroll pdf-pages ${className}`} ref={wrapRef}>
      {error && <div className="viewer-center"><div className="banner warning">{error}</div></div>}
      {!error && !sizes && <div className="viewer-center"><span className="muted">Loading document…</span></div>}
      {sizes && sizes.map((s0, i) => {
        const s = fixed[i + 1] || s0;
        const w = baseW * zoom;
        const h = w * (s.h / s.w);
        return (
          <PdfPage key={i} doc={doc} no={i + 1} cssW={w} cssH={h} onMeasure={onMeasure}>
            {onPageClick && <div className="pdf-page-hit" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onPageClick(i + 1, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }} />}
            {overlay?.(i + 1, w, h)}
            {found.byPage.has(i + 1) && (
              <div className="pdf-find-layer" aria-hidden="true">
                {found.byPage.get(i + 1).flatMap((x) => x.rects.map((r, k) => (
                  <span key={`${x.start}-${k}`} className={`pdf-find-mark ${x === found.cur ? 'current' : ''}`}
                    style={{ left: `${r.l * 100}%`, top: `${r.t * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
                )))}
              </div>
            )}
          </PdfPage>
        );
      })}
    </div>
  );
}
