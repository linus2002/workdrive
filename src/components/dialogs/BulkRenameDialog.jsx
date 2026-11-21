import { useMemo, useState } from 'react';
import { PenLine, ArrowRight, AlertTriangle } from 'lucide-react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { lockedByOther, canEdit, accessOf } from '../../store/selectors';
import { splitName } from '../../utils/format';
import { Modal, FileIcon } from '../common';
import { validateName } from './FileDialogs';

const MODES = [['replace', 'Find & replace'], ['add', 'Add text'], ['number', 'Number'], ['case', 'Change case']];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s_\-(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

/** Rename several selected items in one go, with a live before/after preview. */
export function BulkRenameDialog({ ids, onClose }) {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const items = ids.map((id) => state.items[id]).filter(Boolean);
  const [mode, setMode] = useState('replace');
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [addText, setAddText] = useState('');
  const [where, setWhere] = useState('suffix');
  const [base, setBase] = useState(() => splitName(items[0]?.name || 'File')[0].replace(/[\s_-]*\d+$/, '') || 'File');
  const [start, setStart] = useState(1);
  const [pad, setPad] = useState(2);
  const [sep, setSep] = useState(' ');
  const [caseMode, setCaseMode] = useState('title');
  const [keepExt, setKeepExt] = useState(true);

  const rows = useMemo(() => {
    const out = items.map((it, i) => {
      const hasExt = it.type === 'file' && keepExt;
      const [stem, ext] = hasExt ? splitName(it.name) : [it.name, ''];
      let next = stem;
      if (mode === 'replace' && find) next = stem.replace(new RegExp(escapeRe(find), matchCase ? 'g' : 'gi'), repl);
      if (mode === 'add' && addText) next = where === 'prefix' ? addText + stem : stem + addText;
      if (mode === 'number') next = `${base}${sep}${String(Number(start) + i).padStart(Number(pad), '0')}`;
      if (mode === 'case') next = caseMode === 'lower' ? stem.toLowerCase() : caseMode === 'upper' ? stem.toUpperCase() : caseMode === 'sentence' ? stem.charAt(0).toUpperCase() + stem.slice(1).toLowerCase() : titleCase(stem);
      const name = (ext ? `${next}.${ext}` : next).trim();
      const blocked = lockedByOther(state, it) ? 'Locked by another user' : !canEdit(accessOf(state, it)) ? 'View only' : null;
      return { it, name, error: blocked || validateName(name), changed: name !== it.name };
    });
    // Names must stay unique within each folder: among the new names, and against items not being renamed.
    const key = (it, name) => `${it.space}|${it.parentId || ''}|${name.toLowerCase()}`;
    const renaming = new Set(items.map((i) => i.id));
    const taken = new Set(Object.values(state.items).filter((i) => !i.trashed && !renaming.has(i.id)).map((i) => key(i, i.name)));
    const seen = new Map();
    for (const r of out) {
      if (r.error) continue;
      const k = key(r.it, r.name);
      if (taken.has(k) || seen.has(k)) r.warn = 'Name taken: a number will be added';
      seen.set(k, true);
    }
    return out;
  }, [items, mode, find, repl, matchCase, addText, where, base, start, pad, sep, caseMode, keepExt, state]);

  const ready = rows.filter((r) => r.changed && !r.error);
  const apply = () => {
    const n = api.bulkRename(ready.map((r) => ({ id: r.it.id, name: r.name })));
    toast(n ? `Renamed ${n} item${n === 1 ? '' : 's'}` : 'Nothing to rename', { type: n ? 'success' : 'info' });
    onClose();
  };

  return (
    <Modal title={`Rename ${items.length} items`} onClose={onClose} width={640} icon={<PenLine size={20} />}
      footer={<>
        <span className="muted small grow">{ready.length} of {items.length} will change</span>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={apply} disabled={!ready.length}>Rename {ready.length || ''}</button>
      </>}>
      <div className="seg full" role="tablist" aria-label="Rename method">
        {MODES.map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'active' : ''} onClick={() => setMode(k)}>{l}</button>)}
      </div>

      <div className="bulk-opts">
        {mode === 'replace' && (
          <>
            <label className="field"><span className="field-label">Find</span><input className="input" value={find} onChange={(e) => setFind(e.target.value)} autoFocus data-autofocus /></label>
            <label className="field"><span className="field-label">Replace with</span><input className="input" value={repl} onChange={(e) => setRepl(e.target.value)} placeholder="(leave empty to remove)" /></label>
            <label className="check-row span2"><input type="checkbox" className="cb" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
          </>
        )}
        {mode === 'add' && (
          <>
            <label className="field"><span className="field-label">Text to add</span><input className="input" value={addText} onChange={(e) => setAddText(e.target.value)} placeholder="e.g. _final or 2026-" data-autofocus /></label>
            <label className="field"><span className="field-label">Position</span>
              <select className="select full" value={where} onChange={(e) => setWhere(e.target.value)}><option value="prefix">Before the name</option><option value="suffix">After the name</option></select>
            </label>
          </>
        )}
        {mode === 'number' && (
          <>
            <label className="field"><span className="field-label">Name</span><input className="input" value={base} onChange={(e) => setBase(e.target.value)} data-autofocus /></label>
            <div className="form-grid three">
              <label className="field"><span className="field-label">Start at</span><input className="input" type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))} /></label>
              <label className="field"><span className="field-label">Digits</span>
                <select className="select full" value={pad} onChange={(e) => setPad(Number(e.target.value))}>{[1, 2, 3, 4].map((d) => <option key={d} value={d}>{String(1).padStart(d, '0')}</option>)}</select>
              </label>
              <label className="field"><span className="field-label">Separator</span>
                <select className="select full" value={sep} onChange={(e) => setSep(e.target.value)}><option value=" ">Space</option><option value="-">Dash -</option><option value="_">Underscore _</option><option value="">None</option></select>
              </label>
            </div>
            <span className="muted small span2">Numbered in the order shown below (the current sort order).</span>
          </>
        )}
        {mode === 'case' && (
          <label className="field"><span className="field-label">Case</span>
            <select className="select full" value={caseMode} onChange={(e) => setCaseMode(e.target.value)}>
              <option value="title">Title Case</option><option value="sentence">Sentence case</option><option value="lower">lowercase</option><option value="upper">UPPERCASE</option>
            </select>
          </label>
        )}
        <label className="check-row span2"><input type="checkbox" className="cb" checked={keepExt} onChange={(e) => setKeepExt(e.target.checked)} /> Keep file extensions</label>
      </div>

      <div className="bulk-preview" role="table" aria-label="Rename preview">
        {rows.map((r) => (
          <div key={r.it.id} role="row" className={`bulk-row ${r.error ? 'bad' : ''} ${!r.changed ? 'same' : ''}`}>
            <FileIcon item={r.it} size={20} />
            <span className="truncate old" role="cell" title={r.it.name}>{r.it.name}</span>
            <ArrowRight size={14} className="muted" />
            <span className="truncate new" role="cell" title={r.name}>{r.changed ? r.name : <span className="muted">No change</span>}</span>
            {(r.error || r.warn) && <span className={`bulk-note ${r.error ? 'err' : ''}`} title={r.error || r.warn}><AlertTriangle size={13} /> {r.error || r.warn}</span>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
