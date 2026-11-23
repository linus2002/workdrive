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
