// Line and word diffs for comparing file versions.
// diffLines returns side-by-side rows: { type: 'same'|'add'|'del'|'mod', left: {no, text, segs}|null, right: {...}|null }

const MAX_CELLS = 4_000_000; // LCS table cap; beyond it the changed middle is shown as a block replace

/** LCS-based edit script between two arrays: [['=',a,b] | ['-',a] | ['+',b]] */
function editScript(A, B, eq = (x, y) => x === y) {
  let start = 0;
  while (start < A.length && start < B.length && eq(A[start], B[start])) start++;
  let endA = A.length; let endB = B.length;
  while (endA > start && endB > start && eq(A[endA - 1], B[endB - 1])) { endA--; endB--; }
  const ops = [];
  for (let i = 0; i < start; i++) ops.push(['=', i, i]);
  const n = endA - start; const m = endB - start;
  if (n * m > MAX_CELLS) {
    for (let i = start; i < endA; i++) ops.push(['-', i]);
    for (let j = start; j < endB; j++) ops.push(['+', j]);
  } else if (n || m) {
    // dp[i][j] = LCS length of A[start+i..endA) and B[start+j..endB)
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = eq(A[start + i], B[start + j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0; let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && eq(A[start + i], B[start + j])) { ops.push(['=', start + i, start + j]); i++; j++; }
      else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) { ops.push(['+', start + j]); j++; }
      else { ops.push(['-', start + i]); i++; }
    }
  }
  for (let k = 0; k < A.length - endA; k++) ops.push(['=', endA + k, endB + k]);
  return ops;
}

const tokens = (s) => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];

/** Word-level highlight for a changed line pair. */
export function diffWords(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (A.length * B.length > 250_000) return { left: [{ t: a, ch: true }], right: [{ t: b, ch: true }] };
  const left = []; const right = [];
  const push = (arr, t, ch) => { const last = arr[arr.length - 1]; if (last && last.ch === ch) last.t += t; else arr.push({ t, ch }); };
  for (const op of editScript(A, B)) {
    if (op[0] === '=') { push(left, A[op[1]], false); push(right, B[op[2]], false); }
    else if (op[0] === '-') push(left, A[op[1]], true);
    else push(right, B[op[1]], true);
  }
  return { left, right };
}

const similar = (a, b) => {
  if (!a.trim() || !b.trim()) return false;
  const A = new Set(tokens(a.toLowerCase()).filter((t) => t.trim()));
  const B = tokens(b.toLowerCase()).filter((t) => t.trim());
  if (!A.size || !B.length) return false;
  const common = B.filter((t) => A.has(t)).length;
  return common / Math.max(A.size, B.length) >= 0.4;
};

/** Split text into lines: '' is zero lines, and a trailing newline doesn't add an empty last line. */
function splitLines(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!s) return { lines: [], eol: true };
  const lines = s.split('\n');
  const eol = lines[lines.length - 1] === '';
  if (eol) lines.pop();
  return { lines, eol };
}

export function diffLines(aText, bText) {
  const sa = splitLines(aText); const sb = splitLines(bText);
  const A = sa.lines; const B = sb.lines;
  const ops = editScript(A, B);
  const rows = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k][0] === '=') {
      const [, i, j] = ops[k];
      rows.push({ type: 'same', left: { no: i + 1, text: A[i] }, right: { no: j + 1, text: B[j] } });
      k++;
      continue;
    }
    // A run of deletions/additions: pair similar lines as modifications.
    const dels = []; const adds = [];
    while (k < ops.length && ops[k][0] !== '=') { if (ops[k][0] === '-') dels.push(ops[k][1]); else adds.push(ops[k][1]); k++; }
    const n = Math.max(dels.length, adds.length);
    for (let x = 0; x < n; x++) {
      const i = dels[x]; const j = adds[x];
      if (i != null && j != null && similar(A[i], B[j])) {
        const w = diffWords(A[i], B[j]);
        rows.push({ type: 'mod', left: { no: i + 1, text: A[i], segs: w.left }, right: { no: j + 1, text: B[j], segs: w.right } });
      } else {
        if (i != null) rows.push({ type: 'del', left: { no: i + 1, text: A[i] }, right: null });
        if (j != null) rows.push({ type: 'add', left: null, right: { no: j + 1, text: B[j] } });
      }
    }
  }
  const stats = { added: rows.filter((r) => r.type === 'add').length, removed: rows.filter((r) => r.type === 'del').length, changed: rows.filter((r) => r.type === 'mod').length };
  // Only the final newline differs: say so instead of showing a phantom blank line.
  const eolNote = sa.eol !== sb.eol && (A.length || B.length)
    ? (sa.eol ? 'The newer side has no newline at end of file.' : 'The older side has no newline at end of file.')
    : '';
  return { rows, stats, eolNote };
}

/** Collapse long runs of unchanged rows, keeping `context` lines around each change. */
export function foldRows(rows, context = 3) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => { if (r.type !== 'same') for (let d = -context; d <= context; d++) if (rows[i + d]) keep[i + d] = true; });
  const out = [];
  let hidden = 0;
  rows.forEach((r, i) => {
    if (keep[i]) { if (hidden) { out.push({ type: 'fold', count: hidden }); hidden = 0; } out.push(r); } else hidden++;
  });
  if (hidden) out.push({ type: 'fold', count: hidden });
  return out;
}

/** Cell-by-cell comparison of two spreadsheets. */
export function diffSheets(a, b) {
  const rows = Math.max(a.length, b.length);
  let cols = 0;
  for (const r of a) if (r.length > cols) cols = r.length;
  for (const r of b) if (r.length > cols) cols = r.length;
  const cells = [];
  let changed = 0; let added = 0; let removed = 0;
  for (let r = 0; r < rows; r++) {
    const line = [];
    for (let c = 0; c < cols; c++) {
      const x = a[r]?.[c] ?? ''; const y = b[r]?.[c] ?? '';
      let type = 'same';
      if (x !== y) { type = !x ? 'add' : !y ? 'del' : 'mod'; if (type === 'add') added++; else if (type === 'del') removed++; else changed++; }
      line.push({ old: x, value: y, type });
    }
    cells.push(line);
  }
  return { cells, cols, stats: { added, removed, changed } };
}
