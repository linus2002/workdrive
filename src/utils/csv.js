/** Parse CSV text into rows of cells (quoted fields, "" escapes, CRLF). Trailing blank line is dropped. */
export const parseCsv = (text) => text.replace(/\r/g, '').split('\n').filter((l, i, a) => l || i < a.length - 1).map((l) => {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
});

/**
 * One CSV cell for files people open in Excel/Sheets. Text starting with = + - @ (or tab / CR) would run as a
 * formula there (a file name like =HYPERLINK(...) uploaded by an outsider), so it gets a leading apostrophe.
 */
export const csvCell = (v) => {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
};
/** Rows of values → CSV text (Windows line endings, which Excel expects). */
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
