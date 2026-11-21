import { ScanText } from 'lucide-react';
import { snippet, useSearchIndex } from './searchIndex';

const SOURCE = { ocr: 'Text in image', pdf: 'In PDF', document: 'In document', spreadsheet: 'In sheet', slides: 'In slides', text: 'In file', archive: 'In archive' };

/** A short excerpt of the file's text around the search words, with the words highlighted. */
/** radius: characters of context before the match (keep it small where the column is narrow). */
export default function Snippet({ id, q, name = '', radius = 70 }) {
  useSearchIndex();
  if (!q.trim()) return null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.every((w) => name.toLowerCase().includes(w))) return null; // the name already explains the match
  const s = snippet(id, q, radius);
  if (!s) return null;
  return (
    <span className="snippet" title={s.parts.map((p) => p.text).join('')}>
      <span className={`snip-src ${s.source === 'ocr' ? 'ocr' : ''}`}>{s.source === 'ocr' && <ScanText size={11} />}{SOURCE[s.source] || 'In file'}</span>
      {s.parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </span>
  );
}
