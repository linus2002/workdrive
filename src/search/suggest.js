// Rule-based suggestions from a file's text: labels to add and custom fields to fill in.
// No AI involved: each rule is a keyword/pattern check, and every suggestion says which words triggered it.

const LABEL_RULES = [
  { match: (l) => l.id === 'lb-confidential' || /confidential/i.test(l.name), re: /\b(confidential|non-disclosure|nda|salar(?:y|ies)|password|personal data|bank account)\b/i },
  { match: (l) => l.id === 'lb-draft' || /^draft$/i.test(l.name), re: /\b(draft|work in progress|wip|tbd|to be decided|not final)\b/i },
  { match: (l) => l.id === 'lb-urgent' || /urgent/i.test(l.name), re: /\b(urgent|asap|immediately|final notice|overdue)\b/i },
  { match: (l) => l.id === 'lb-review' || /review/i.test(l.name), re: /\b(please review|for (?:your )?review|needs? review|feedback (?:requested|needed)|todo)\b/i },
  { match: (l) => l.id === 'lb-approved' || /^approved$/i.test(l.name), re: /\b(approved by|countersigned|signed electronically)\b/i },
];

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const DATE_RE = new RegExp(`(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{2,4}|(?:${MONTHS})[a-z]*\\.? \\d{1,2},? \\d{4}|\\d{1,2} (?:${MONTHS})[a-z]*\\.? \\d{4})`, 'i');

/** "Nov 25, 2026" / "11/25/2026" / "2026-11-25" → "2026-11-25" (the date input format). */
function isoDate(s) {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  const d = m ? new Date(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), Number(m[1]) - 1, Number(m[2])) : new Date(s.replace(/\./g, ''));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const amount = (s) => (s ? Number(s.replace(/,/g, '')) : '');
const firstLine = (text) => (text.split('\n').map((l) => l.trim()).find((l) => /[a-z]{3}/i.test(l) && l.length <= 60) || '');
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Fill a template's fields from the text, by what each field is called. */
function fillFields(tpl, text, kind) {
  const values = {};
  for (const f of tpl.fields) {
    const n = f.name.toLowerCase();
    let v = '';
    if (kind === 'invoice') {
      if (/invoice|receipt|ref|no\.?|number/.test(n) && f.type === 'text') v = text.match(/\b(INV[-\s]?\d{3,}|(?:invoice|receipt)\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9-]{3,}))/i)?.slice(1).reverse().find(Boolean) || '';
      else if (/vendor|supplier|from|merchant/.test(n)) v = text.match(/\b(?:from|vendor|supplier|billed by)\s*[:-]\s*(.+)/i)?.[1]?.trim() || titleCase(firstLine(text));
      else if (/amount|total/.test(n) && f.type === 'number') v = amount(text.match(/\b(?:amount due|total due|balance due|grand total|total)\s*[:-]?\s*(?:php|usd|eur|[$€£₱])?\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1]);
      else if (/due|date/.test(n) && f.type === 'date') v = isoDate((text.match(new RegExp(`\\b(?:due(?: date)?|date)\\s*[:\\-]?\\s*${DATE_RE.source}`, 'i')) || text.match(DATE_RE))?.[1]);
      else if (f.type === 'select' && /status/.test(n)) v = (/\b(paid in full|payment received|paid)\b/i.test(text) && f.options?.includes('Paid')) ? 'Paid' : '';
    } else if (kind === 'contract') {
      if (/party|counterparty|client|vendor/.test(n)) {
        const m = text.match(/between\s+(.+?)\s+and\s+(.+?)(?:[.,\n]|$)/i);
        v = m ? m[2].replace(/^the\s+/i, '').trim() : '';
      } else if (/start|effective/.test(n) && f.type === 'date') v = isoDate(text.match(new RegExp(`\\b(?:effective|start)(?: date)?\\s*[:\\-]?\\s*${DATE_RE.source}`, 'i'))?.[1]);
      else if (/end|expir/.test(n) && f.type === 'date') v = isoDate(text.match(new RegExp(`\\b(?:end|expir\\w*)(?: date)?\\s*[:\\-]?\\s*${DATE_RE.source}`, 'i'))?.[1]);
      else if (/value|amount/.test(n) && f.type === 'number') v = amount(text.match(/\b(?:contract value|total value|fee)\s*[:-]?\s*(?:php|usd|[$€£₱])?\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1]);
      else if (f.type === 'select' && /status/.test(n)) v = /\b(signed|executed)\b/i.test(text) && f.options?.includes('Signed') ? 'Signed' : '';
    }
    if (v !== '' && v != null && !(f.type === 'number' && Number.isNaN(v))) values[f.id] = v;
  }
  return values;
}

/**
 * Suggestions for one item from its extracted text.
 * Returns { labels: [{ label, why }], template: { tpl, values, why } | null }; already-applied or dismissed ones are left out.
 */
export function suggestFor(state, item, text) {
  const out = { labels: [], template: null };
  if (!text || !item) return out;
  const dismissed = new Set(item.dismissedSuggestions || []);
  const sample = `${item.name}\n${text}`;
  for (const rule of LABEL_RULES) {
    const label = (state.org.labels || []).find(rule.match);
    if (!label || (item.labels || []).includes(label.id) || dismissed.has(`label:${label.id}`)) continue;
    const hit = sample.match(rule.re);
    if (hit) out.labels.push({ label, why: `mentions “${hit[0]}”` });
  }
  if (!item.meta && item.type === 'file') {
    const templates = state.org.dataTemplates || [];
    const inv = /\b(invoice|receipt|amount due|total due|bill to|balance due)\b/i.exec(sample);
    const con = /\b(agreement|contract|hereinafter|the parties|terms and conditions)\b/i.exec(sample);
    const pick = inv ? ['invoice', templates.find((t) => t.id === 'dt-invoice' || /invoice/i.test(t.name)), inv[0]]
      : con ? ['contract', templates.find((t) => t.id === 'dt-contract' || /contract/i.test(t.name)), con[0]] : null;
    if (pick?.[1] && !dismissed.has(`tpl:${pick[1].id}`)) {
      const values = fillFields(pick[1], text, pick[0]);
      if (Object.keys(values).length) out.template = { tpl: pick[1], values, why: `looks like ${pick[0] === 'invoice' ? 'an invoice or receipt' : 'a contract'} (“${pick[2]}”)` };
    }
  }
  return out;
}
