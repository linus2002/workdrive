import { useMemo, useState } from 'react';
import { Tag, Palette, ListPlus, Plus, Trash2, Check, Search, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDrive, useMe } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { uid } from '../../utils/format';
import { Modal, FolderGlyph } from '../common';

export const PALETTE = ['#DC2626', '#EA580C', '#D97706', '#A16207', '#16A34A', '#0D9488', '#0EA5E9', '#1686D9', '#6366F1', '#7C3AED', '#DB2777', '#64748B'];

const COLOUR_NAMES = {
  '#DC2626': 'Red', '#EA580C': 'Orange', '#D97706': 'Amber', '#A16207': 'Brown', '#16A34A': 'Green', '#0D9488': 'Teal',
  '#0EA5E9': 'Sky blue', '#1686D9': 'Blue', '#6366F1': 'Indigo', '#7C3AED': 'Violet', '#DB2777': 'Pink', '#64748B': 'Slate',
  '#D946EF': 'Fuchsia', '#0EA5A4': 'Teal', '#EA7A1A': 'Orange', '#E5484D': 'Red',
};
/** Human name for a palette colour, for screen readers (falls back to the hex value). */
export const colourName = (hex) => COLOUR_NAMES[String(hex || '').toUpperCase()] || hex;

/** Small coloured label pill. */
export function LabelChip({ label, onClick, onRemove, small }) {
  const cls = `label-chip ${small ? 'sm' : ''} ${onClick ? 'clickable' : ''}`;
  const click = onClick ? (e) => { e.stopPropagation(); onClick(label); } : undefined;
  if (onRemove) {
    // A button can't contain another button: use a plain wrapper with two real buttons inside.
    return (
      <span className={cls} style={{ '--lc': label.color }} title={label.name}>
        <span className="label-dot" />
        {onClick
          ? <button type="button" className="label-chip-main truncate" onClick={click}>{label.name}</button>
          : <span className="truncate">{label.name}</span>}
        <button type="button" className="label-x" aria-label={`Remove label ${label.name}`} onClick={(e) => { e.stopPropagation(); onRemove(label); }}>×</button>
      </span>
    );
  }
  const Tagname = onClick ? 'button' : 'span';
  return (
    <Tagname type={onClick ? 'button' : undefined} className={cls} style={{ '--lc': label.color }} onClick={click} title={label.name}>
      <span className="label-dot" />
      <span className="truncate">{label.name}</span>
    </Tagname>
  );
}

/* ------------------------------------------------------------------ */
/* Apply labels to one or more items                                   */
/* ------------------------------------------------------------------ */
export function LabelsDialog({ ids, onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const navigate = useNavigate();
  const me = useMe();
  const isAdmin = me?.role === 'Admin';
  const items = ids.map((id) => state.items[id]).filter(Boolean);
  const [q, setQ] = useState('');
  const [newColor, setNewColor] = useState(PALETTE[7]);
  const labels = state.org.labels || [];
  const shown = labels.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = labels.some((l) => l.name.toLowerCase() === q.trim().toLowerCase());

  const stateOf = (l) => {
    const n = items.filter((i) => i.labels?.includes(l.id)).length;
    return n === 0 ? 'none' : n === items.length ? 'all' : 'some';
  };
  const toggle = (l) => api.setLabel(ids, l.id, stateOf(l) !== 'all');
  const create = () => {
    const name = q.trim();
    if (!name || exact) return;
    const id = api.createLabel({ name, color: newColor });
    api.setLabel(ids, id, true);
    setQ('');
    ui.toast(`Label "${name}" created`, { type: 'success' });
  };

  return (
    <Modal title="Labels" subtitle={items.length === 1 ? items[0].name : `${items.length} items selected`} onClose={onClose} width={440} icon={<Tag size={20} />}
      footer={<>
        {isAdmin && <button className="btn btn-ghost mr-auto" onClick={() => { onClose(); navigate('/admin/organize'); }}><Settings2 size={15} /> Manage labels</button>}
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </>}>
      <div className="input-icon"><Search size={15} />
        <input className="input" placeholder={isAdmin ? 'Search or create a label' : 'Search labels'} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (shown.length === 1 && !isAdmin) toggle(shown[0]); else if (isAdmin && !exact) create(); else if (shown[0]) toggle(shown[0]); } }} data-autofocus />
      </div>
      <ul className="label-pick" role="listbox" aria-multiselectable="true">
        {shown.map((l) => {
          const st = stateOf(l);
          return (
            <li key={l.id}>
              <button role="option" aria-selected={st === 'all'} className="label-pick-row" onClick={() => toggle(l)}>
                <span className={`pick-box ${st}`}>{st === 'all' ? <Check size={12} /> : st === 'some' ? '–' : null}</span>
                <span className="label-dot lg" style={{ background: l.color }} />
                <span className="grow truncate">{l.name}</span>
              </button>
            </li>
          );
        })}
        {!shown.length && !q.trim() && <li className="muted small pad">No labels yet.</li>}
      </ul>
      {isAdmin && q.trim() && !exact && (
        <div className="label-create">
          <div className="color-row tight">{PALETTE.map((c) => <button type="button" key={c} className={`color-dot sm ${newColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setNewColor(c)} aria-label={colourName(c)} aria-pressed={newColor === c} />)}</div>
          <button className="btn btn-secondary btn-block" onClick={create}><Plus size={15} /> Create label “{q.trim()}”</button>
        </div>
      )}
      {!isAdmin && q.trim() && !shown.length && <p className="muted small">No label named “{q.trim()}”. Ask an admin to create it.</p>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Folder colour                                                       */
/* ------------------------------------------------------------------ */
export function FolderColorDialog({ ids, onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const folders = ids.map((id) => state.items[id]).filter((i) => i?.type === 'folder');
  const current = folders.length && folders.every((f) => f.color === folders[0].color) ? folders[0].color : undefined;
  const apply = (color) => {
    api.setFolderColor(folders.map((f) => f.id), color);
    ui.toast(color ? 'Folder colour updated' : 'Folder colour reset', { type: 'success' });
    onClose();
  };
  return (
    <Modal title="Folder colour" subtitle={folders.length === 1 ? folders[0].name : `${folders.length} folders`} onClose={onClose} width={400} icon={<Palette size={20} />}>
      <div className="folder-colors">
        <button className={`folder-color ${current === null ? 'on' : ''}`} onClick={() => apply(null)} aria-label="Default colour" aria-pressed={current === null}><FolderGlyph size={34} /><span>Default</span></button>
        {PALETTE.map((c) => (
          <button key={c} className={`folder-color ${current === c ? 'on' : ''}`} onClick={() => apply(c)} aria-label={colourName(c)} aria-pressed={current === c}><FolderGlyph size={34} color={c} /></button>
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Custom fields on one item                                           */
/* ------------------------------------------------------------------ */
export function FieldInput({ field, value, onChange, id }) {
  if (field.type === 'select') {
    return (
      <select id={id} className="select full" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input id={id} className="input" type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} step={field.type === 'number' ? 'any' : undefined}
      value={value ?? ''} onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
  );
}

export function MetadataDialog({ id, suggested, onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const item = state.items[id];
  const templates = state.org.dataTemplates || [];
  // `suggested` pre-fills values found in the file's text (the user reviews them before saving).
  const [tplId, setTplId] = useState(item?.meta?.templateId || suggested?.templateId || templates[0]?.id || '');
  const [values, setValues] = useState(item?.meta?.values || suggested?.values || {});
  const tpl = templates.find((t) => t.id === tplId);
  if (!item) return null;
  const save = (e) => {
    e?.preventDefault();
    if (!tpl) return;
    const clean = Object.fromEntries(tpl.fields.map((f) => [f.id, values[f.id] ?? '']));
    api.setMetadata(item.id, tpl.id, clean);
    ui.toast('Custom fields saved', { type: 'success' });
    onClose();
  };
  const remove = () => {
    const prev = item.meta;
    api.setMetadata(item.id, null);
    ui.toast('Custom fields removed', { type: 'success', action: prev ? { label: 'Undo', onClick: () => api.setMetadata(item.id, prev.templateId, prev.values || {}) } : null });
    onClose();
  };
  return (
    <Modal title="Custom fields" subtitle={item.name} onClose={onClose} width={480} icon={<ListPlus size={20} />}
      footer={<>
        {item.meta && <button className="btn btn-ghost danger mr-auto" onClick={remove}><Trash2 size={15} /> Remove</button>}
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="submit" form="meta-form" disabled={!tpl}>Save</button>
      </>}>
      {!templates.length ? (
        <p className="muted">No data templates exist yet. An admin can create them in Admin Console → Labels & fields.</p>
      ) : (
        <form id="meta-form" className="form" onSubmit={save}>
          <label className="field"><span className="field-label">Data template</span>
            <select className="select full" value={tplId} onChange={(e) => { setTplId(e.target.value); if (e.target.value !== item.meta?.templateId) setValues({}); else setValues(item.meta.values); }}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {tpl?.description && <span className="muted small">{tpl.description}</span>}
          </label>
          {tpl && (
            <div className="form-grid">
              {tpl.fields.map((f) => (
                <label key={f.id} className="field" htmlFor={`mf-${f.id}`}><span className="field-label">{f.name}</span>
                  <FieldInput id={`mf-${f.id}`} field={f} value={values[f.id]} onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))} />
                </label>
              ))}
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Admin: create / edit a label                                        */
/* ------------------------------------------------------------------ */
export function LabelEditDialog({ labelId, onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const label = labelId ? state.org.labels.find((l) => l.id === labelId) : null;
  const [name, setName] = useState(label?.name || '');
  const [color, setColor] = useState(label?.color || PALETTE[7]);
  const dup = state.org.labels.some((l) => l.id !== labelId && l.name.toLowerCase() === name.trim().toLowerCase());
  const err = !name.trim() ? 'Enter a name' : dup ? 'A label with this name already exists' : null;
  const submit = (e) => {
    e.preventDefault();
    if (err) return;
    if (label) api.updateLabel(label.id, { name: name.trim(), color }); else api.createLabel({ name, color });
    ui.toast(label ? 'Label updated' : 'Label created', { type: 'success' });
    onClose();
  };
  return (
    <Modal title={label ? 'Edit label' : 'New label'} onClose={onClose} width={420} icon={<Tag size={20} />}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="label-form" disabled={!!err}>{label ? 'Save' : 'Create'}</button></>}>
      <form id="label-form" className="form" onSubmit={submit}>
        <label className="field"><span className="field-label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} /></label>
        <div className="field"><span className="field-label">Colour</span>
          <div className="color-row">{PALETTE.map((c) => <button type="button" key={c} className={`color-dot ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={colourName(c)} aria-pressed={color === c} />)}</div>
        </div>
        <div className="field"><span className="field-label">Preview</span><div><LabelChip label={{ name: name.trim() || 'Label', color }} /></div></div>
        {err && name && <span className="field-error">{err}</span>}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Admin: create / edit a data template                                */
/* ------------------------------------------------------------------ */
const FIELD_TYPES = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Dropdown']];

export function DataTemplateDialog({ templateId, onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const existing = templateId ? state.org.dataTemplates.find((t) => t.id === templateId) : null;
  const [name, setName] = useState(existing?.name || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [fields, setFields] = useState(() => (existing?.fields || [{ id: uid('f'), name: '', type: 'text' }]).map((f) => ({ ...f, optionsText: (f.options || []).join(', ') })));
  const inUse = useMemo(() => Object.values(state.items).filter((i) => i.meta?.templateId === templateId).length, [state.items, templateId]);

  const patch = (i, p) => setFields((fs) => fs.map((f, k) => (k === i ? { ...f, ...p } : f)));
  const named = fields.filter((f) => f.name.trim());
  const dupName = state.org.dataTemplates.some((t) => t.id !== templateId && t.name.toLowerCase() === name.trim().toLowerCase());
  const badSelect = named.some((f) => f.type === 'select' && !f.optionsText.split(',').map((x) => x.trim()).filter(Boolean).length);
  const err = !name.trim() ? 'Enter a template name' : dupName ? 'A template with this name already exists' : !named.length ? 'Add at least one field' : badSelect ? 'Dropdown fields need at least one option' : null;

  const submit = (e) => {
    e.preventDefault();
    if (err) return;
    const tpl = {
      id: existing?.id || uid('dt'), name: name.trim(), description: description.trim(),
      fields: named.map(({ optionsText, ...f }) => ({ ...f, name: f.name.trim(), ...(f.type === 'select' ? { options: optionsText.split(',').map((x) => x.trim()).filter(Boolean) } : { options: undefined }) })),
    };
    api.saveDataTemplate(tpl);
    ui.toast(existing ? 'Data template updated' : 'Data template created', { type: 'success' });
    onClose();
  };

  return (
    <Modal title={existing ? 'Edit data template' : 'New data template'} subtitle={existing && inUse ? `Used on ${inUse} file${inUse === 1 ? '' : 's'}` : 'A set of custom fields people can fill in on files'} onClose={onClose} width={620} icon={<ListPlus size={20} />}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="tpl-form" disabled={!!err}>{existing ? 'Save' : 'Create'}</button></>}>
      <form id="tpl-form" className="form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span className="field-label">Template name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Purchase order" /></label>
          <label className="field"><span className="field-label">Description</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></label>
        </div>
        <div className="field">
          <span className="field-label">Fields</span>
          <div className="tpl-fields">
            {fields.map((f, i) => (
              <div key={f.id} className="tpl-field">
                <input className="input" value={f.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Field name" aria-label={`Field ${i + 1} name`} />
                <select className="select" value={f.type} onChange={(e) => patch(i, { type: e.target.value })} aria-label={`Field ${i + 1} type`}>
                  {FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button type="button" className="icon-btn" onClick={() => setFields((fs) => fs.filter((_, k) => k !== i))} aria-label={`Remove field ${i + 1}`} disabled={fields.length === 1}><Trash2 size={15} /></button>
                {f.type === 'select' && <input className="input tpl-options" value={f.optionsText} onChange={(e) => patch(i, { optionsText: e.target.value })} placeholder="Options, comma-separated (e.g. Open, Closed)" aria-label={`Field ${i + 1} options`} />}
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-secondary btn-sm self-start" onClick={() => setFields((fs) => [...fs, { id: uid('f'), name: '', type: 'text', optionsText: '' }])}><Plus size={14} /> Add field</button>
        </div>
        {err && (name || named.length > 0) && <span className="field-error">{err}</span>}
      </form>
    </Modal>
  );
}
