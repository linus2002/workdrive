// File type metadata: label, brand color, category used for filters & previews
export const FILE_TYPES = {
  pdf: { label: 'PDF', color: '#E5484D', category: 'pdf', name: 'PDF Document' },
  doc: { label: 'DOC', color: '#2B6CE6', category: 'document', name: 'Word Document' },
  docx: { label: 'DOC', color: '#2B6CE6', category: 'document', name: 'Word Document' },
  xls: { label: 'XLS', color: '#16A34A', category: 'spreadsheet', name: 'Spreadsheet' },
  xlsx: { label: 'XLS', color: '#16A34A', category: 'spreadsheet', name: 'Spreadsheet' },
  csv: { label: 'CSV', color: '#16A34A', category: 'spreadsheet', name: 'CSV File' },
  ppt: { label: 'PPT', color: '#EA7A1A', category: 'presentation', name: 'Presentation' },
  pptx: { label: 'PPT', color: '#EA7A1A', category: 'presentation', name: 'Presentation' },
  jpg: { label: 'JPG', color: '#8B5CF6', category: 'image', name: 'JPEG Image' },
  jpeg: { label: 'JPG', color: '#8B5CF6', category: 'image', name: 'JPEG Image' },
  png: { label: 'PNG', color: '#8B5CF6', category: 'image', name: 'PNG Image' },
  gif: { label: 'GIF', color: '#8B5CF6', category: 'image', name: 'GIF Image' },
  webp: { label: 'IMG', color: '#8B5CF6', category: 'image', name: 'Image' },
  svg: { label: 'SVG', color: '#D946EF', category: 'image', name: 'SVG Image' },
  mp4: { label: 'MP4', color: '#0EA5A4', category: 'video', name: 'MP4 Video' },
  mov: { label: 'MOV', color: '#0EA5A4', category: 'video', name: 'Video' },
  webm: { label: 'VID', color: '#0EA5A4', category: 'video', name: 'Video' },
  mp3: { label: 'MP3', color: '#DB2777', category: 'audio', name: 'MP3 Audio' },
  wav: { label: 'WAV', color: '#DB2777', category: 'audio', name: 'WAV Audio' },
  ogg: { label: 'OGG', color: '#DB2777', category: 'audio', name: 'Audio' },
  m4a: { label: 'M4A', color: '#DB2777', category: 'audio', name: 'Audio' },
  aac: { label: 'AAC', color: '#DB2777', category: 'audio', name: 'Audio' },
  flac: { label: 'FLAC', color: '#DB2777', category: 'audio', name: 'FLAC Audio' },
  zip: { label: 'ZIP', color: '#A16207', category: 'archive', name: 'ZIP Archive' },
  rar: { label: 'RAR', color: '#A16207', category: 'archive', name: 'Archive' },
  txt: { label: 'TXT', color: '#64748B', category: 'text', name: 'Text File' },
  md: { label: 'MD', color: '#64748B', category: 'text', name: 'Markdown', lang: 'markdown' },
  markdown: { label: 'MD', color: '#64748B', category: 'text', name: 'Markdown', lang: 'markdown' },
  json: { label: 'JSON', color: '#64748B', category: 'text', name: 'JSON File', lang: 'json' },
  log: { label: 'LOG', color: '#64748B', category: 'text', name: 'Log File' },
  // Source code: text files with syntax highlighting in the preview.
  ...code(['js', 'mjs', 'cjs'], 'JS', '#CA8A04', 'JavaScript', 'js'),
  ...code(['jsx'], 'JSX', '#0891B2', 'JavaScript (React)', 'js'),
  ...code(['ts'], 'TS', '#2563EB', 'TypeScript', 'js'),
  ...code(['tsx'], 'TSX', '#2563EB', 'TypeScript (React)', 'js'),
  ...code(['py'], 'PY', '#3776AB', 'Python', 'py'),
  ...code(['java'], 'JAVA', '#B45309', 'Java', 'c'),
  ...code(['c', 'h'], 'C', '#475569', 'C', 'c'),
  ...code(['cpp', 'hpp', 'cc'], 'C++', '#475569', 'C++', 'c'),
  ...code(['cs'], 'C#', '#7C3AED', 'C#', 'c'),
  ...code(['go'], 'GO', '#0891B2', 'Go', 'c'),
  ...code(['rs'], 'RS', '#B45309', 'Rust', 'c'),
  ...code(['kt'], 'KT', '#7C3AED', 'Kotlin', 'c'),
  ...code(['swift'], 'SWFT', '#EA580C', 'Swift', 'c'),
  ...code(['php'], 'PHP', '#6366F1', 'PHP', 'c'),
  ...code(['rb'], 'RB', '#DC2626', 'Ruby', 'py'),
  ...code(['sh', 'bash', 'zsh'], 'SH', '#16A34A', 'Shell script', 'sh'),
  ...code(['sql'], 'SQL', '#0E7490', 'SQL', 'sql'),
  ...code(['css', 'scss'], 'CSS', '#2563EB', 'Stylesheet', 'css'),
  ...code(['html', 'htm', 'xml'], 'HTML', '#EA580C', 'Markup', 'html'),
  ...code(['yml', 'yaml'], 'YAML', '#64748B', 'YAML', 'yaml'),
  ...code(['toml', 'ini', 'env', 'conf'], 'CONF', '#64748B', 'Config file', 'yaml'),
};

function code(exts, label, color, name, lang) {
  return Object.fromEntries(exts.map((e) => [e, { label, color, category: 'text', name, lang }]));
}

/** Syntax-highlighting language for a text file ('markdown', 'json', 'js', 'py', ...) or null for plain text. */
export const langOf = (ext) => FILE_TYPES[(ext || '').toLowerCase()]?.lang || null;

export const getFileType = (ext) =>
  FILE_TYPES[(ext || '').toLowerCase()] || { label: (ext || 'FILE').toUpperCase().slice(0, 4), color: '#94A3B8', category: 'other', name: 'File' };

export const CATEGORY_FILTERS = [
  { id: 'all', label: 'All types' },
  { id: 'folder', label: 'Folders' },
  { id: 'document', label: 'Documents' },
  { id: 'spreadsheet', label: 'Spreadsheets' },
  { id: 'presentation', label: 'Presentations' },
  { id: 'pdf', label: 'PDFs' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'archive', label: 'Archives' },
  { id: 'text', label: 'Text files' },
];

export const itemCategory = (item) => (item.type === 'folder' ? 'folder' : getFileType(item.ext).category);

export const MIME = {
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', gif: 'image/gif', mp4: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  webp: 'image/webp', html: 'text/html', css: 'text/css', js: 'text/javascript', xml: 'application/xml',
  zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// Deterministic generated artwork for mock image thumbnails (no external assets)
const PALETTES = [
  ['#0EA5E9', '#6366F1', '#F8FAFC', '#1E293B'], ['#F97316', '#FACC15', '#FFF7ED', '#7C2D12'], ['#10B981', '#0EA5A4', '#ECFDF5', '#064E3B'],
  ['#EC4899', '#8B5CF6', '#FDF2F8', '#4C1D95'], ['#1686D9', '#38BDF8', '#EFF6FF', '#0C4A6E'], ['#84CC16', '#22C55E', '#F7FEE7', '#14532D'],
  ['#F43F5E', '#FB923C', '#FFF1F2', '#881337'],
];
export function genThumb(seed) {
  const s = Number(seed) || 1;
  const [a, b, c, d] = PALETTES[s % PALETTES.length];
  const cx = 60 + ((s * 37) % 180), h1 = 120 + ((s * 13) % 40), h2 = 140 + ((s * 7) % 30);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 200'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='320' height='200' fill='url(#g)'/><circle cx='${cx}' cy='60' r='26' fill='${c}' opacity='.85'/><path d='M0 ${h1} Q80 ${h1 - 50} 160 ${h1} T320 ${h1 - 10} V200 H0Z' fill='${d}' opacity='.35'/><path d='M0 ${h2} Q100 ${h2 - 40} 200 ${h2 + 5} T320 ${h2} V200 H0Z' fill='${d}' opacity='.55'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
