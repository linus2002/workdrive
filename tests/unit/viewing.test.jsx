import { describe, it, expect } from 'vitest';
import { diffLines, diffSheets, foldRows } from '../../src/viewing/diff.js';
import { highlightLines } from '../../src/viewing/highlight.js';
import Markdown from '../../src/viewing/Markdown.jsx';
import { imagesToPdf } from '../../src/viewing/pdfWriter.js';
import { render } from './helpers.jsx';

describe('diff', () => {
  const d = diffLines('a\nb\nc\nThe quick brown fox\ne', 'a\nc\nThe quick red fox\ne\nf');
  it('counts removed, added and changed lines', () => {
    expect(d.stats).toMatchObject({ removed: 1, added: 1, changed: 1 });
  });
  it('highlights the changed words inside a modified line', () => {
    const mod = d.rows.find((r) => r.type === 'mod');
    expect(mod).toBeTruthy();
    expect(mod.left.segs.some((s) => s.ch && s.t === 'brown')).toBe(true);
    expect(mod.right.segs.some((s) => s.ch && s.t === 'red')).toBe(true);
  });
  it('identical text has only unchanged rows', () => {
    expect(diffLines('x\ny', 'x\ny').rows.every((r) => r.type === 'same')).toBe(true);
  });
  it('folds long unchanged runs around a change', () => {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const b2 = [...big];
    b2[100] = 'changed line';
    expect(foldRows(diffLines(big.join('\n'), b2.join('\n')).rows).filter((r) => r.type === 'fold')).toHaveLength(2);
  });
  it('diffs spreadsheets by cell', () => {
    const sd = diffSheets([['a', '1'], ['b', '2']], [['a', '1'], ['b', '3'], ['c', '']]);
    expect(sd.stats).toMatchObject({ changed: 1, added: 1 });
  });
});

describe('syntax highlighting', () => {
  it('javascript keywords, comments and numbers', () => {
    const hl = highlightLines('const x = "hi"; // note\nfunction f(a) { return 42; }', 'js');
    expect(hl).toHaveLength(2);
    expect(hl[0].some(([t, s]) => t === 'kw' && s === 'const')).toBe(true);
    expect(hl[0].some(([t]) => t === 'com')).toBe(true);
    expect(hl[1].some(([t, s]) => t === 'num' && s === '42')).toBe(true);
  });
  it('json property names', () => {
    expect(highlightLines('{"a": [1, true]}', 'json')[0].some(([t]) => t === 'prop')).toBe(true);
  });
  it('shell variables', () => {
    expect(highlightLines("echo $HOME # c\nit's", 'sh')[0].some(([t, s]) => t === 'var' && s === '$HOME')).toBe(true);
  });
  it('an unterminated string stays on its own line', () => {
    expect(highlightLines("x = 'unterminated\ny = 2", 'py')[1].some(([t]) => t === 'num')).toBe(true);
  });
});

describe('Markdown', () => {
  const source = '# Title\n\nSome **bold** and `code` [link](https://x.y) [bad](javascript:alert(1)) <script>alert(1)</script>\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\n\n> quote';
  const html = render(<Markdown source={source} />);
  it('renders headings, emphasis and links', () => {
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://x.y"');
  });
  it('is XSS-safe (no javascript: links, no raw script tags)', () => {
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script>');
  });
  it('renders task lists, tables, highlighted code and quotes', () => {
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<table');
    expect(html).toContain('tk-kw');
    expect(html).toContain('<blockquote');
  });
  it('odd input does not hang or throw', () => {
    expect(render(<Markdown source={'~~~\nunclosed\n\n###### \n|'} />).length).toBeGreaterThan(0);
  });
});

describe('PDF writer', () => {
  it('writes a PDF that pdf.js parses back with the right pages, sizes and title', async () => {
    const jpeg = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));
    const blob = imagesToPdf([{ jpeg, pxW: 1, pxH: 1, ptW: 612, ptH: 792 }, { jpeg, pxW: 1, pxH: 1, ptW: 300, ptH: 400 }], { title: 'Test' });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    expect(doc.numPages).toBe(2);
    const p2 = await doc.getPage(2);
    expect(Math.round(p2.view[2])).toBe(300);
    expect(Math.round(p2.view[3])).toBe(400);
    const meta = await doc.getMetadata();
    expect(meta.info.Title).toBe('Test');
    await doc.destroy();
  });
});
