// Deterministic sample content for files that have no stored body (preview + download).
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function sampleSheet(item) {
  if (item.sheet) return item.sheet;
  const h = hash(item.name);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const cats = ['Product', 'Services', 'Licenses', 'Support', 'Training', 'Hardware', 'Consulting', 'Partners'];
  const rows = [['Category', ...months.slice(0, 6), 'Total']];
  cats.forEach((c, i) => {
    const vals = months.slice(0, 6).map((_, m) => String(1000 + ((h >> (i + m)) % 9000)));
    rows.push([c, ...vals, String(vals.reduce((s, v) => s + Number(v), 0))]);
  });
  return rows;
}

export function sampleSlides(item) {
  if (item.slides) return item.slides;
  const base = item.name.replace(/\.[^.]+$/, '');
  return [
    { title: base, body: 'Getmeds · ' + new Date(item.modifiedAt).getFullYear() },
    { title: 'Agenda', body: '• Where we are\n• What we learned\n• What comes next' },
    { title: 'Highlights', body: '• Revenue up 14% YoY\n• Customer retention at 93%\n• Two new regional partners' },
    { title: 'Next Steps', body: '• Finalize Q1 priorities\n• Align budgets with team leads\n• Review in four weeks' },
  ];
}

export function sampleText(item) {
  if (item.content) return item.content;
  const base = item.name.replace(/\.[^.]+$/, '');
  return `${base}\n\nThis is sample content generated for the prototype file "${item.name}".\n\nIn a production deployment, the original document body would be streamed from storage and rendered here. Uploaded files show their real contents.`;
}

export function sampleArchive(item) {
  const base = item.name.replace(/\.[^.]+$/, '');
  return [
    { name: `${base}/README.txt`, size: 1240 },
    { name: `${base}/assets/logo-primary.svg`, size: 8420 },
    { name: `${base}/assets/logo-mono.svg`, size: 7310 },
    { name: `${base}/assets/icon-512.png`, size: 48200 },
    { name: `${base}/docs/usage.pdf`, size: 210400 },
  ]; // fileBlob() builds a real ZIP with exactly these entries, so extracting a sample gives the same files

}
