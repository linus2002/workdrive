import { useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FolderPlus, PenLine, FolderInput, Copy, AlertTriangle, Search, FileText, Sheet, Presentation, LayoutTemplate, Users, Home, Folder, Check, CornerUpRight } from 'lucide-react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { writableFolders, descendantIds, folderRoute, spaceRoute, uniqueName, lockedByOther } from '../../store/selectors';
import { splitName } from '../../utils/format';
import { Modal, FolderGlyph } from '../common';
import { TEMPLATES } from '../../data/mockData';
import { TemplatePreview } from '../../views/TemplatesView';

const INVALID = /[\\/:*?"<>|]/;

export function validateName(name) {
  const v = name.trim();
  if (!v) return 'Name cannot be empty';
  if (INVALID.test(v)) return 'Name cannot contain \\ / : * ? " < > |';
  if (v.length > 120) return 'Name is too long (max 120 characters)';
  return null;
}

/**
 * Generic confirmation. With `danger`, the Cancel button gets focus so Enter can't destroy anything by accident.
 * `confirmText`: the user must type this exact text (e.g. a team name) before the confirm button enables.
 */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, confirmText, confirmPrompt, onConfirm, onClose }) {
  const [typed, setTyped] = useState('');
  const needsText = typeof confirmText === 'string' && confirmText.length > 0;
  const ok = !needsText || typed.trim() === confirmText.trim();
  const go = () => { if (!ok) return; onConfirm?.(); onClose(); };
  return (
    <Modal title={title} onClose={onClose} width={420} icon={danger ? <AlertTriangle size={20} className="text-danger" /> : null}
      footer={<>
        <button className="btn btn-secondary" data-autofocus={danger && !needsText ? true : undefined} onClick={onClose}>{cancelLabel}</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} data-autofocus={!danger && !needsText ? true : undefined} disabled={!ok} onClick={go}>{confirmLabel}</button>
      </>}>
      {typeof message === 'string' ? <p className="dialog-text">{message}</p> : <div className="dialog-text">{message}</div>}
      {needsText && (
        <form className="form type-confirm" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <label className="field">
            <span className="field-label">{confirmPrompt || <>Type <strong>{confirmText}</strong> to confirm</>}</span>
            <input className="input" data-autofocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} aria-label={`Type ${confirmText} to confirm`} />
          </label>
        </form>
      )}
    </Modal>
  );
}

/** Folder <select> listing writable destinations. value = `${space}|${id||''}` */
export function FolderSelect({ value, onChange, id }) {
  const { state } = useDrive();
  const options = useMemo(() => writableFolders(state), [state]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const keyOf = (o) => `${o.space}|${o.id || ''}`;
  const current = options.find((o) => keyOf(o) === value) || options[0];
  const iconFor = (o, size = 16) => {
    const Icon = o.root ? (o.team ? Users : Home) : Folder;
    return <Icon size={size} strokeWidth={1.8} className="fsel-icon" />;
  };

  const show = () => {
    const r = btnRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const maxH = Math.min(280, Math.max(below, r.top - 12));
    setPos({ left: r.left, width: r.width, maxH, ...(below >= 160 || below >= r.top ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }) });
    setActive(Math.max(0, options.findIndex((o) => keyOf(o) === value)));
    setOpen(true);
  };
  const pick = (o) => { onChange(keyOf(o)); setOpen(false); btnRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!listRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('resize', onResize); };
  }, [open]);
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKey = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[active]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); }
  };

  return (
    <>
      <button
        ref={btnRef} id={id} type="button" className="select full fsel-btn"
        aria-haspopup="listbox" aria-expanded={open} data-popup-open={open || undefined}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}
      >
        {current && iconFor(current)}
        <span className="truncate">{current?.name}</span>
      </button>
      {open && pos && createPortal(
        <ul ref={listRef} className="fsel-list" role="listbox"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}>
          {options.map((o, i) => (
            <li key={keyOf(o)} data-idx={i} role="option" aria-selected={keyOf(o) === value}
              className={`fsel-opt ${i === active ? 'active' : ''} ${keyOf(o) === value ? 'selected' : ''} ${o.root ? 'root' : ''}`}
              style={{ paddingLeft: 10 + o.depth * 16 }}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
              {iconFor(o)}
              <span className="truncate grow">{o.name}</span>
              {keyOf(o) === value && <Check size={15} className="fsel-check" />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}
const parseDest = (v) => { const [space, id] = v.split('|'); return { space, parentId: id || null }; };

export function CreateFolderDialog({ parentId, space = 'my', onClose }) {
  const { api, state } = useDrive();
  const { toast } = useUI();
  const navigate = useNavigate();
  const [name, setName] = useState('Untitled folder');
  const [dest, setDest] = useState(`${space}|${parentId || ''}`);
  const [touched, setTouched] = useState(false);
  const [openAfter, setOpenAfter] = useState(false);
  const err = validateName(name);
  const inputRef = useRef(null);
  useEffect(() => { setTimeout(() => inputRef.current?.select(), 40); }, []);
  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (err) return;
    const d = parseDest(dest);
    const id = api.createFolder(name.trim(), d.parentId, d.space);
    toast(`Folder "${name.trim()}" created`, { type: 'success' });
    onClose();
    if (openAfter) navigate(folderRoute({ id, space: d.space }));
    else if (d.parentId !== (parentId || null) || d.space !== space) navigate(d.parentId ? folderRoute({ id: d.parentId, space: d.space }) : spaceRoute(d.space));
  };
  return (
    <Modal title="New folder" onClose={onClose} width={460} icon={<FolderPlus size={20} />}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" form="create-folder" type="submit" disabled={touched && !!err}>Create</button>
      </>}>
      <form id="create-folder" onSubmit={submit} className="form">
        <label className="field">
          <span className="field-label">Folder name</span>
          <input ref={inputRef} className={`input ${touched && err ? 'invalid' : ''}`} value={name} onChange={(e) => { setName(e.target.value); setTouched(true); }} maxLength={130} aria-invalid={touched && !!err} />
          {touched && err && <span className="field-error">{err}</span>}
        </label>
        <label className="field">
          <span className="field-label">Location</span>
          <FolderSelect value={dest} onChange={setDest} />
        </label>
        <label className="check-row">
          <input type="checkbox" className="cb" checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} /> Open folder after creating
        </label>
      </form>
    </Modal>
  );
}

export function RenameDialog({ id, onClose }) {
  const { api, state } = useDrive();
  const { toast } = useUI();
  const item = state.items[id];
  const [name, setName] = useState(item?.name || '');
  const ref = useRef(null);
  useEffect(() => {
    setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const [base, ext] = splitName(item.name);
      el.setSelectionRange(0, item.type === 'file' && ext ? base.length : item.name.length);
    }, 40);
  }, []); // eslint-disable-line
  if (!item) return null;
  const err = validateName(name);
  const [, oldExt] = splitName(item.name);
  const [, newExt] = splitName(name.trim());
  const extChanged = item.type === 'file' && oldExt !== newExt;
  const submit = (e) => {
    e.preventDefault();
    if (err) return;
    if (name.trim() !== item.name) {
      if (lockedByOther(state, item)) { toast('This item is locked by someone else and can’t be renamed', { type: 'error' }); return; }
      const finalName = uniqueName(state, name.trim(), item.parentId, item.space, id);
      api.renameItem(id, name.trim());
      toast(finalName === name.trim() ? `Renamed to "${finalName}"` : `Renamed to "${finalName}": an item named "${name.trim()}" already exists here`, { type: 'success' });
    }
    onClose();
  };
  return (
    <Modal title={`Rename ${item.type === 'folder' ? 'folder' : 'file'}`} onClose={onClose} width={440} icon={<PenLine size={20} />}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="submit" form="rename-form" disabled={!!err}>Rename</button>
      </>}>
      <form id="rename-form" onSubmit={submit} className="form">
        <label className="field">
          <span className="field-label">Name</span>
          <input ref={ref} className={`input ${err ? 'invalid' : ''}`} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!err} />
          {err && <span className="field-error">{err}</span>}
          {!err && extChanged && <span className="field-warn">Changing the file extension may make the file unusable.</span>}
        </label>
      </form>
    </Modal>
  );
}

export function MoveCopyDialog({ ids, mode = 'move', onClose }) {
  const { api, state } = useDrive();
  const { toast } = useUI();
  const navigate = useNavigate();
  const [m, setM] = useState(mode);
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState(null); // null = not creating; string = inline name field shown
  const items = ids.map((id) => state.items[id]).filter(Boolean);
  const blocked = useMemo(() => {
    const s = new Set();
    for (const it of items) if (it.type === 'folder') { s.add(it.id); descendantIds(state.items, it.id).forEach((d) => s.add(d)); }
    return s;
  }, [items, state.items]);
  const options = useMemo(() => writableFolders(state), [state]);
  const first = items[0];
  const [dest, setDest] = useState(first ? `${first.space === 'user' ? 'my' : first.space}|${first.parentId || ''}` : 'my|');
  const shown = filter ? options.filter((o) => o.name.toLowerCase().includes(filter.toLowerCase())) : options;
  const d = parseDest(dest);
  const sameAsCurrent = m === 'move' && items.every((i) => (i.parentId || null) === d.parentId && i.space === d.space);
  const label = items.length === 1 ? `"${items[0].name}"` : `${items.length} items`;
  const destName = options.find((o) => `${o.space}|${o.id || ''}` === dest)?.name;
  const intoItself = blocked.has(d.parentId);
  // Roving focus: one row is tabbable (the selected one, else the first enabled), arrows move between rows.
  const enabledKeys = shown.filter((o) => !blocked.has(o.id)).map((o) => `${o.space}|${o.id || ''}`);
  const rovingKey = enabledKeys.includes(dest) ? dest : enabledKeys[0];
  const onPickerKey = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || !enabledKeys.length) return;
    e.preventDefault();
    const cur = enabledKeys.indexOf(e.target?.dataset?.key ?? rovingKey);
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? enabledKeys.length - 1
      : e.key === 'ArrowDown' ? Math.min(enabledKeys.length - 1, cur + 1) : Math.max(0, cur - 1);
    const key = enabledKeys[i];
    setDest(key);
    e.currentTarget.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
  };

  const submit = () => {
    if (m === 'move') {
      const origin = ids.map((id) => ({ id, parentId: state.items[id]?.parentId || null, space: state.items[id]?.space }));
      const res = api.moveItems(ids, d.parentId, d.space);
      const why = [res.locked && `${res.locked} locked`, res.denied && `${res.denied} view-only`, res.held && `${res.held} on legal hold`].filter(Boolean).join(', ');
      const what = res.moved === ids.length ? label : `${res.moved} of ${ids.length} items`;
      toast(res.moved ? `Moved ${what} to "${destName}"${why ? ` · skipped ${why}` : ''}` : `Nothing was moved${why ? `: ${why}` : ''}`, {
        type: res.moved ? 'success' : 'warning',
        action: res.moved ? { label: 'Undo', onClick: () => {
          const groups = new Map();
          origin.forEach((o) => { const k = `${o.space}|${o.parentId || ''}`; if (!groups.has(k)) groups.set(k, { ...o, ids: [] }); groups.get(k).ids.push(o.id); });
          groups.forEach((g) => api.moveItems(g.ids, g.parentId, g.space));
        } } : null,
      });
    } else if (m === 'shortcut') {
      const created = api.createShortcuts(ids, d.parentId, d.space);
      toast(`Added ${created.length} shortcut${created.length === 1 ? '' : 's'} to "${destName}"`, { type: 'success', action: { label: 'Open', onClick: () => navigate(d.parentId ? folderRoute({ id: d.parentId, space: d.space }) : spaceRoute(d.space)) } });
    } else {
      const n = api.copyItems(ids, d.parentId, d.space);
      if (!n) toast(api.copyItems.lastError || 'Nothing was copied', { type: 'error' });
      else toast(`Copied ${n === ids.length ? label : `${n} of ${ids.length} items`} to "${destName}"${n < ids.length ? ' · the rest can’t be copied' : ''}`, { type: 'success', action: { label: 'Open', onClick: () => navigate(d.parentId ? folderRoute({ id: d.parentId, space: d.space }) : spaceRoute(d.space)) } });
    }
    onClose();
  };
  const VERB = { move: 'Move', copy: 'Copy', shortcut: 'Add shortcut to' };
  const allShortcuts = items.every((i) => i.type === 'shortcut');

  return (
    <Modal title={`${VERB[m]} ${label}`} onClose={onClose} width={520} icon={m === 'move' ? <FolderInput size={20} /> : m === 'shortcut' ? <CornerUpRight size={20} /> : <Copy size={20} />}
      footer={<>
        <button className="btn btn-secondary" onClick={() => setNewName('')} disabled={newName !== null}>
          <FolderPlus size={15} /> New folder
        </button>
        <span className="grow" />
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={sameAsCurrent || intoItself}>{m === 'move' ? 'Move here' : m === 'shortcut' ? 'Add shortcut here' : 'Copy here'}</button>
      </>}>
      <div className="seg full" role="radiogroup">
        <button role="radio" aria-checked={m === 'move'} className={m === 'move' ? 'active' : ''} onClick={() => setM('move')}>Move</button>
        <button role="radio" aria-checked={m === 'copy'} className={m === 'copy' ? 'active' : ''} onClick={() => setM('copy')}>Copy</button>
        {!allShortcuts && <button role="radio" aria-checked={m === 'shortcut'} className={m === 'shortcut' ? 'active' : ''} onClick={() => setM('shortcut')}>Shortcut</button>}
      </div>
      {m === 'shortcut' && <div className="field-hint">A shortcut points to the original: nothing is copied, and it always opens the latest version.</div>}
      <div className="input-icon">
        <Search size={15} />
        <input className="input" placeholder="Search folders" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="folder-picker" role="listbox" aria-label="Destination folder" onKeyDown={onPickerKey}>
        {shown.map((o) => {
          const key = `${o.space}|${o.id || ''}`;
          const disabled = blocked.has(o.id);
          return (
            <button key={key} role="option" aria-selected={dest === key} disabled={disabled} data-key={key}
              tabIndex={key === rovingKey ? 0 : -1} title={disabled ? 'You can’t move a folder into itself' : undefined}
              className={`picker-row ${dest === key ? 'selected' : ''} ${o.root ? 'root' : ''}`} style={{ paddingLeft: 10 + (filter ? 0 : o.depth * 18) }}
              onClick={() => setDest(key)} onDoubleClick={() => { setDest(key); }}>
              {o.root ? (o.team ? <Users size={16} className="muted" /> : <FolderGlyph size={18} />) : <FolderGlyph size={18} />}
              <span className="truncate">{filter ? o.path : o.name}</span>
            </button>
          );
        })}
        {shown.length === 0 && <div className="muted pad">No folders match “{filter}”.</div>}
      </div>
      {newName !== null && (
        <form className="inline-create" onSubmit={(e) => {
          e.preventDefault();
          const nm = newName.trim();
          if (validateName(nm)) return;
          const id = api.createFolder(nm, d.parentId, d.space);
          setDest(`${d.space}|${id}`);
          setNewName(null);
          setFilter('');
        }}>
          <FolderGlyph size={18} />
          <input className="input" autoFocus placeholder={`New folder in "${destName}"`} value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNewName(null); } }} aria-label="New folder name" maxLength={130} />
          <button className="btn btn-primary btn-sm" type="submit" disabled={!!validateName(newName.trim())}>Create</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setNewName(null)}>Cancel</button>
        </form>
      )}
      {sameAsCurrent && <div className="field-hint">Items are already in this folder. Choose another destination.</div>}
      {!sameAsCurrent && intoItself && <div className="field-hint">You can’t move a folder into itself. Choose another destination.</div>}
    </Modal>
  );
}

const KIND = {
  docx: { label: 'Document', icon: FileText, ext: 'docx', base: 'Untitled document' },
  xlsx: { label: 'Spreadsheet', icon: Sheet, ext: 'xlsx', base: 'Untitled spreadsheet' },
  pptx: { label: 'Presentation', icon: Presentation, ext: 'pptx', base: 'Untitled presentation' },
};

export function CreateDocDialog({ kind = 'docx', template, onClose }) {
  const { api } = useDrive();
  const ui = useUI();
  const navigate = useNavigate();
  const k = KIND[kind] || KIND.docx;
  const [name, setName] = useState(template ? template.name : k.base);
  // Default to the current folder when you can write there, otherwise My Folders.
  const [dest, setDest] = useState(ui.cwd.writable ? `${ui.cwd.space}|${ui.cwd.parentId || ''}` : 'my|');
  const err = validateName(name);
  const submit = (e) => {
    e.preventDefault();
    if (err) return;
    const d = parseDest(dest);
    const body = template?.content ?? (kind === 'docx' ? '' : null);
    const sheet = template?.sheet || (kind === 'xlsx' ? [['', '', '', ''], ['', '', '', ''], ['', '', '', '']] : null);
    const slides = template?.slides || (kind === 'pptx' ? [{ title: 'Click to add title', body: 'Click to add text' }] : null);
    const content = body;
    const size = (content?.length || 0) + JSON.stringify(sheet || slides || '').length + 4096;
    const created = api.createFile({ name: `${name.trim()}.${k.ext}`, ext: k.ext, parentId: d.parentId, space: d.space, content, sheet, slides, size });
    api.logEvent(template ? 'Created from template' : 'File created', created.name, template ? template.name : '');
    ui.toast(`${k.label} "${created.name}" created`, { type: 'success' });
    // Also close the template picker underneath, if this was opened from it.
    ui.closeAllDialogs();
    api.markOpened(created.id);
    // Go to the folder it was saved in (highlighted there), with the new file open on top.
    const folderPath = d.parentId ? folderRoute({ id: d.parentId, space: d.space }) : spaceRoute(d.space);
    setTimeout(() => navigate(`${folderPath}?highlight=${created.id}&preview=${created.id}`), 30);
  };
  return (
    <Modal title={template ? `New from “${template.name}”` : `New ${k.label}`} onClose={onClose} width={460} icon={<k.icon size={20} />}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="submit" form="create-doc" disabled={!!err}>Create & open</button>
      </>}>
      <form id="create-doc" className="form" onSubmit={submit}>
        {template && <div className="tpl-mini"><TemplatePreview t={template} /></div>}
        <label className="field">
          <span className="field-label">Name</span>
          <div className="input-suffix">
            <input className={`input ${err ? 'invalid' : ''}`} value={name} onChange={(e) => setName(e.target.value)} />
            <span>.{k.ext}</span>
          </div>
          {err && <span className="field-error">{err}</span>}
        </label>
        <label className="field">
          <span className="field-label">Save in</span>
          <FolderSelect value={dest} onChange={setDest} />
        </label>
      </form>
    </Modal>
  );
}

export function TemplatePickerDialog({ onClose }) {
  const { pushDialog } = useUI();
  return (
    <Modal title="Create from template" onClose={onClose} width={760} icon={<LayoutTemplate size={20} />}>
      <div className="tpl-grid compact">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="tpl-card" onClick={() => pushDialog('createDoc', { kind: t.ext, template: t })}>
            <TemplatePreview t={t} />
            <div className="tpl-info"><div className="min0"><div className="tpl-name">{t.name}</div><div className="tpl-desc">{t.category}</div></div></div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
