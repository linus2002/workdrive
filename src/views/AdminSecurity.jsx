import { useMemo, useState } from 'react';
import { ShieldCheck, Plus, Search, Laptop, Smartphone, LogOut, FolderClosed, Users, X, Play, RefreshCw, History, AlertOctagon } from 'lucide-react';
import { useDrive, currentSessionId } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { locationOf, isTrashedDeep } from '../store/selectors';
import { formatDate, formatDateTime } from '../utils/format';
import { Avatar, Modal, EmptyState, FileIcon, Switch } from '../components/common';
import { getEntry, indexStatus, clearIndex, useSearchIndex } from '../search/searchIndex';
import { Section, SettingRow } from './SettingsView';

/* ------------------------------------------------------------------ */
/* Data retention + legal holds                                        */
/* ------------------------------------------------------------------ */
export function RetentionTab() {
  const { state, api } = useDrive();
  const ui = useUI();
  const p = state.org.policies;
  const [creating, setCreating] = useState(false);
  const folderOptions = useMemo(() => Object.values(state.items).filter((i) => i.type === 'folder' && !isTrashedDeep(state.items, i.id))
    .map((i) => ({ id: i.id, path: locationOf(state, i) + ' / ' + i.name })).sort((a, b) => a.path.localeCompare(b.path)), [state]);
  const [restoreTarget, setRestoreTarget] = useState(() => (state.teams.some((t) => t.id === 't2') ? 'space:t2' : `space:${state.teams[0]?.id}`));
  const { due, held } = api.retentionCandidates();
  const lastRun = state.audit.find((a) => a.action === 'Retention cleanup');
  const holds = state.org.legalHolds || [];

  const changeTrash = (days) => {
    const preview = api.retentionCandidates(days);
    const apply = () => {
      api.updateOrg({ policies: { trashRetentionDays: days } });
      ui.toast(days ? `Trash items are now deleted after ${days} days` : 'Trash items are kept until deleted by hand', { type: 'success' });
    };
    if (days && preview.due.length) {
      ui.openDialog('confirm', {
        title: `Delete ${preview.due.length} item${preview.due.length === 1 ? '' : 's'} from Trash?`,
        message: `${preview.due.length} item${preview.due.length === 1 ? ' has' : 's have'} been in Trash longer than ${days} days and will be permanently deleted at the next cleanup${preview.held.length ? `. ${preview.held.length} on legal hold will be kept` : ''}.`,
        confirmLabel: 'Change policy', danger: true, onConfirm: apply,
      });
    } else apply();
  };
  const runNow = () => {
    const c = api.retentionCandidates();
    const n = c.due.length;
    if (!n) { ui.toast('Nothing to clean up', { type: 'info' }); return; }
    ui.openDialog('confirm', {
      title: `Permanently delete ${n} item${n === 1 ? '' : 's'}?`,
      message: `${n} item${n === 1 ? ' has' : 's have'} been in Trash longer than the retention period and will be permanently deleted for everyone. This can't be undone.${c.held.length ? ` ${c.held.length} on legal hold will be kept.` : ''}`,
      confirmLabel: 'Delete permanently', danger: true,
      onConfirm: () => {
        const r = api.runRetention({ manual: true });
        ui.toast(r.deleted ? `Cleanup deleted ${r.deleted} item${r.deleted === 1 ? '' : 's'} from Trash` : 'Nothing to clean up', { type: r.deleted ? 'success' : 'info' });
      },
    });
  };
  const release = (h) => ui.openDialog('confirm', {
    title: `Release “${h.name}”?`, message: 'Covered items can be permanently deleted again (by people, or by Trash retention).',
    confirmLabel: 'Release hold', danger: true, onConfirm: () => { api.releaseLegalHold(h.id); ui.toast('Legal hold released', { type: 'success' }); },
  });

  return (
    <>
      <Section title="Trash retention" desc="How long deleted items stay in Trash before they are removed for good.">
        <SettingRow title="Permanently delete Trash items after" desc="Applies to everyone's Trash. Items on legal hold are never removed.">
          <select className="select" value={p.trashRetentionDays || 0} onChange={(e) => changeTrash(Number(e.target.value))} aria-label="Trash retention">
            {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d === 365 ? '1 year' : `${d} days`}</option>)}
            <option value={0}>Never (keep until deleted)</option>
          </select>
        </SettingRow>
        <SettingRow title="Cleanup" desc={`${due.length ? `${due.length} item${due.length === 1 ? ' is' : 's are'} past the retention period` : 'Nothing is past the retention period'}${held.length ? ` · ${held.length} kept for legal hold` : ''}. Runs automatically while WorkDrive is open${lastRun ? `; last run ${formatDateTime(lastRun.at)} (${lastRun.target})` : ''}.`}>
          <button className="btn btn-secondary btn-sm" onClick={runNow} disabled={!due.length} title={!due.length ? 'Nothing is past the retention period' : undefined}><Play size={14} /> Run cleanup now</button>
        </SettingRow>
      </Section>

      <Section title="Version history" desc="Older versions use storage too.">
        <SettingRow title="Keep versions per file" desc="When a file gets more, the oldest are removed on its next save. Files on legal hold keep every version.">
          <select className="select" value={p.maxVersions || 25} onChange={(e) => { api.updateOrg({ policies: { maxVersions: Number(e.target.value) } }); ui.toast('Version policy updated', { type: 'success' }); }} aria-label="Versions per file">
            {[5, 10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} versions</option>)}
          </select>
        </SettingRow>
      </Section>

      <Section title="Recovery" desc={`Roll a team folder or folder back to how it was at a point in time, for example after accidental bulk changes or ransomware. Every rename, move, deletion and edit is recorded for ${180} days.`}>
        <SettingRow title="Restore a folder to a date" desc="Choose what to restore; you'll pick the time and review every change before anything happens.">
          <div className="inline-form">
            <select className="select" value={restoreTarget} onChange={(e) => setRestoreTarget(e.target.value)} aria-label="Folder to restore">
              <optgroup label="Team folders">{state.teams.map((t) => <option key={t.id} value={`space:${t.id}`}>{t.name}</option>)}</optgroup>
              <optgroup label="Folders">{folderOptions.map((f) => <option key={f.id} value={`folder:${f.id}`}>{f.path}</option>)}</optgroup>
            </select>
            <button className="btn btn-secondary btn-sm" onClick={() => { const [k, id] = restoreTarget.split(':'); ui.openDialog('restoreFolder', k === 'space' ? { space: id } : { folderId: id }); }}><History size={14} /> Restore…</button>
          </div>
        </SettingRow>
        <SettingRow title="Recovery drill (demo)" desc="Simulates a ransomware-style incident on the sample Product & Engineering files (two renamed to .locked with scrambled contents, one deleted, a ransom note added) so you can practise restoring. Your other files aren't touched.">
          <button className="btn btn-secondary btn-sm" onClick={() => {
            if (api.simulateIncident()) ui.toast('Drill started: check Product & Engineering, then restore it to before the incident', { type: 'success', duration: 7000, action: { label: 'Restore now', onClick: () => ui.openDialog('restoreFolder', { space: 't2' }) } });
            else ui.toast('The sample Product & Engineering files are missing or already affected. Restore the folder first, or reset the demo data.', { type: 'error', duration: 7000 });
          }}><AlertOctagon size={14} /> Run drill</button>
        </SettingRow>
      </Section>

      <Section title="Legal holds" desc="Preserve files for litigation, audits or investigations: held items can still be moved to Trash, but nothing (people, retention, version limits) can permanently delete them."
        actions={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={15} /> New legal hold</button>}>
        {!holds.length ? <EmptyState compact icon={ShieldCheck} title="No legal holds" text="Place a hold on folders, files or whole team spaces." /> : (
          <div className="hold-list">
            {holds.map((h) => {
              const by = state.users.find((u) => u.id === h.createdBy);
              return (
                <div key={h.id} className={`hold-card ${h.active ? '' : 'released'}`}>
                  <div className="hold-head">
                    <ShieldCheck size={18} className="hold-icon" />
                    <div className="grow min0"><strong className="truncate block">{h.name}</strong><span className="muted small">Placed by {by?.name || 'an admin'} · {formatDate(h.createdAt)}{h.releasedAt ? ` · released ${formatDate(h.releasedAt)}` : ''}</span></div>
                    <span className={`pill ${h.active ? 'pill-green' : 'pill-gray'}`}>{h.active ? 'Active' : 'Released'}</span>
                    {h.active && <button className="btn btn-secondary btn-sm" onClick={() => release(h)}>Release</button>}
                  </div>
                  {h.note && <p className="muted small">{h.note}</p>}
                  <div className="chip-row">
                    {h.spaces.map((sid) => <span key={sid} className="chip"><Users size={13} /> {state.teams.find((t) => t.id === sid)?.name || 'Team'} (whole team)</span>)}
                    {h.itemIds.map((id) => {
                      const it = state.items[id];
                      return <span key={id} className="chip" title={it ? locationOf(state, it) : ''}>{it ? <FileIcon item={it} size={14} /> : null} {it ? it.name : 'Deleted item'}</span>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
      {creating && <LegalHoldDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function LegalHoldDialog({ onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]); // [{ kind: 'space'|'item', id }]
  const options = useMemo(() => {
    const teams = state.teams.map((t) => ({ kind: 'space', id: t.id, label: `${t.name} (entire team folder)`, sub: 'Team folder', team: t }));
    const items = Object.values(state.items).filter((i) => i.type !== 'shortcut' && !isTrashedDeep(state.items, i.id))
      .map((i) => ({ kind: 'item', id: i.id, label: i.name, sub: locationOf(state, i), item: i }))
      .sort((a, b) => (a.item.type === b.item.type ? a.label.localeCompare(b.label) : a.item.type === 'folder' ? -1 : 1));
    return [...teams, ...items];
  }, [state]);
  const has = (o) => picked.some((x) => x.kind === o.kind && x.id === o.id);
  const shown = options.filter((o) => !has(o) && (!q || `${o.label} ${o.sub}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 40);
  const err = !name.trim() ? 'Name the hold (e.g. the matter or case)' : !picked.length ? 'Choose at least one folder, file or team' : null;
  const submit = () => {
    if (err) return;
    api.createLegalHold({ name, note, itemIds: picked.filter((x) => x.kind === 'item').map((x) => x.id), spaces: picked.filter((x) => x.kind === 'space').map((x) => x.id) });
    ui.toast(`Legal hold “${name.trim()}” is active`, { type: 'success' });
    onClose();
  };
  const labelOf = (x) => options.find((o) => o.kind === x.kind && o.id === x.id)?.label;
  return (
    <Modal title="New legal hold" onClose={onClose} width={580} icon={<ShieldCheck size={20} />}
      footer={<><span className="muted small grow">{name || picked.length ? err || '' : ''}</span><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={!!err}>Place hold</button></>}>
      <div className="form">
        <label className="field"><span className="field-label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vendor dispute 2026" data-autofocus /></label>
        <label className="field"><span className="field-label">Reason <span className="muted">(optional)</span></span><textarea className="input textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="field">
          <span className="field-label">What to preserve</span>
          {picked.length > 0 && (
            <div className="chip-row">{picked.map((x) => <span key={x.kind + x.id} className="token">{x.kind === 'space' ? <Users size={13} /> : <FolderClosed size={13} />}{labelOf(x)}<button type="button" onClick={() => setPicked(picked.filter((y) => !(y.kind === x.kind && y.id === x.id)))} aria-label={`Remove ${labelOf(x)}`}><X size={12} /></button></span>)}</div>
          )}
          <div className="input-icon"><Search size={15} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search folders, files or teams" aria-label="Search what to preserve" /></div>
          <div className="pick-people hold-pick">
            {shown.map((o) => (
              <button type="button" key={o.kind + o.id} className="suggest-row" onClick={() => { setPicked([...picked, { kind: o.kind, id: o.id }]); setQ(''); }}>
                {o.kind === 'space' ? <span className="notif-sys"><Users size={15} /></span> : <FileIcon item={o.item} size={22} />}
                <span className="min0 grow"><span className="truncate block">{o.label}</span><span className="muted small truncate block">{o.sub}</span></span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Search & OCR                                                        */
/* ------------------------------------------------------------------ */
export function SearchTab() {
  const { state, api } = useDrive();
  const ui = useUI();
  useSearchIndex();
  const p = state.org.policies;
  const files = Object.values(state.items).filter((i) => i.type === 'file' && !i.trashed);
  const entries = files.map((f) => getEntry(f.id)).filter(Boolean);
  const withText = entries.filter((e) => e.text).length;
  const ocrd = entries.filter((e) => e.source === 'ocr' && e.text).length;
  const errors = entries.filter((e) => e.source === 'error');
  const st = indexStatus();
  const current = st.current ? state.items[st.current] : null;
  const set = (patch, msg) => { api.updateOrg({ policies: patch }); ui.toast(msg, { type: 'success' }); };

  return (
    <>
      <div className="stat-row">
        <div className="stat-tile"><div className="stat-label">Files with searchable text</div><div className="stat-value">{withText}</div><div className="stat-sub">of {files.length} files</div></div>
        <div className="stat-tile"><div className="stat-label">Read with OCR</div><div className="stat-value">{ocrd}</div><div className="stat-sub">images & scanned PDFs</div></div>
        <div className="stat-tile"><div className="stat-label">Waiting to index</div><div className="stat-value">{st.pending}</div><div className="stat-sub">{current ? `Now: ${current.name}` : 'Up to date'}</div></div>
        <div className="stat-tile"><div className="stat-label">Couldn't read</div><div className="stat-value">{errors.length}</div><div className="stat-sub">{errors.length ? 'Rebuild to retry' : 'No problems'}</div></div>
      </div>
      <Section title="Search inside files" desc="WorkDrive reads the text inside documents, PDFs, spreadsheets, slides and ZIP listings so search can find words in them, not just in file names.">
        <SettingRow title="Read text in images and scanned PDFs (OCR)" desc="Runs in each person's browser; files are not sent anywhere. The first time, the browser downloads the text-recognition engine (about 10 MB).">
          <Switch checked={p.ocr !== false} onChange={(v) => set({ ocr: v }, v ? 'OCR turned on: images will be read in the background' : 'OCR turned off')} label="OCR" />
        </SettingRow>
        <SettingRow title="Rebuild the search index" desc="Re-reads every file. Use it if results look out of date or some files couldn't be read.">
          <button className="btn btn-secondary btn-sm" onClick={() => { clearIndex(); ui.toast('Rebuilding the search index in the background', { type: 'success' }); }}><RefreshCw size={14} /> Rebuild</button>
        </SettingRow>
      </Section>
      <Section title="Label & field suggestions" desc="Keyword and pattern rules on a file's text (for example “non-disclosure” → Confidential, or an invoice number and total → Invoice fields). This is rule-based, not AI.">
        <SettingRow title="Suggestions" desc={p.smartLabels === 'auto' ? 'New uploads get suggested labels and fields applied automatically; every change is in the audit log.' : p.smartLabels === 'off' ? 'No suggestions are shown.' : 'People with edit access see suggestions in a file’s details and choose whether to apply them.'}>
          <select className="select" value={p.smartLabels || 'suggest'} onChange={(e) => set({ smartLabels: e.target.value }, 'Suggestion setting saved')} aria-label="Suggestions mode">
            <option value="off">Off</option>
            <option value="suggest">Suggest only</option>
            <option value="auto">Apply automatically to new uploads</option>
          </select>
        </SettingRow>
      </Section>
      {errors.length > 0 && (
        <Section title="Files that couldn't be read">
          {errors.slice(0, 10).map((e) => { const f = files.find((x) => getEntry(x.id) === e); return f ? <div key={f.id} className="muted small">{f.name}: {e.error}</div> : null; })}
        </Section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Sessions & devices (organization-wide)                              */
/* ------------------------------------------------------------------ */
export function SessionsTab() {
  const { state, api } = useDrive();
  const ui = useUI();
  const [who, setWho] = useState('all');
  const sid = currentSessionId();
  const live = (state.sessions || []).filter((s) => !s.endedAt);
  const rows = live.filter((s) => who === 'all' || s.userId === who).sort((a, b) => b.lastActive - a.lastActive);
  const usersOnline = new Set(live.map((s) => s.userId)).size;
  const recentHour = live.filter((s) => Date.now() - s.lastActive < 3600000).length;
  const person = state.users.find((u) => u.id === who);

  const end = (s) => {
    if (s.id === sid) { api.signOut(); return; }
    const u = state.users.find((x) => x.id === s.userId);
    api.endSession(s.id, 'Signed out by an administrator');
    ui.toast(`Signed ${u?.name || 'user'} out of ${s.device}`, { type: 'success' });
  };
  const endAll = () => ui.openDialog('confirm', {
    title: `Sign ${person.name} out everywhere?`, message: `All ${rows.length} of their sessions end now${who === state.meId ? ', except this one' : ''}. They'll need to sign in again.`,
    confirmLabel: 'Sign out everywhere', danger: true,
    onConfirm: () => { const n = api.endUserSessions(who, who === state.meId ? sid : null); ui.toast(`Ended ${n} session${n === 1 ? '' : 's'}`, { type: 'success' }); },
  });

  return (
    <>
      <div className="stat-row">
        <div className="stat-tile"><div className="stat-label">Active sessions</div><div className="stat-value">{live.length}</div></div>
        <div className="stat-tile"><div className="stat-label">People signed in</div><div className="stat-value">{usersOnline}</div><div className="stat-sub">of {state.users.length} users</div></div>
        <div className="stat-tile"><div className="stat-label">Active in the last hour</div><div className="stat-value">{recentHour}</div></div>
        <div className="stat-tile"><div className="stat-label">Idle timeout</div><div className="stat-value">{state.org.policies.sessionTimeout >= 60 ? `${state.org.policies.sessionTimeout / 60} h` : `${state.org.policies.sessionTimeout} min`}</div><div className="stat-sub">Set in Permission policies</div></div>
      </div>
      <Section title="Active sessions" desc="Every device currently signed in to your organization."
        actions={<div className="btn-row">
          <select className="select select-sm" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by person">
            <option value="all">Everyone</option>
            {state.users.filter((u) => live.some((s) => s.userId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {person && rows.length > 0 && <button className="btn btn-danger-outline btn-sm" onClick={endAll}><LogOut size={14} /> Sign out everywhere</button>}
        </div>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Person</th><th>Device</th><th className="hide-sm">Location / IP</th><th className="hide-sm">Signed in</th><th>Last active</th><th /></tr></thead>
            <tbody>
              {rows.map((s) => {
                const u = state.users.find((x) => x.id === s.userId);
                const Icon = /iOS|Android/.test(s.device) ? Smartphone : Laptop;
                return (
                  <tr key={s.id}>
                    <td><span className="cell-owner"><Avatar user={u} size={26} /><span className="truncate">{u?.name || 'Removed user'}</span></span></td>
                    <td className="nowrap"><Icon size={14} className="muted" /> {s.device} {s.id === sid && <span className="pill pill-green">This device</span>}</td>
                    <td className="hide-sm muted">{s.location}<span className="block small mono">{s.ip}</span></td>
                    <td className="hide-sm muted nowrap">{formatDate(s.startedAt)}</td>
                    <td className="muted nowrap">{Date.now() - s.lastActive < 5 * 60000 ? 'Now' : formatDate(s.lastActive)}</td>
                    <td className="row-actions"><button className="btn btn-secondary btn-sm" onClick={() => end(s)}><LogOut size={13} /> Sign out</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <EmptyState compact icon={Laptop} title="No active sessions" />}
        </div>
      </Section>
    </>
  );
}
