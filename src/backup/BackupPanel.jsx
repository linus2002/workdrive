import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Upload, HardDrive, ShieldCheck, AlertTriangle, ArchiveRestore, X } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { storageInfo, requestPersistence, fileStore } from '../data/storage';
import { formatSize, formatDateTime } from '../utils/format';
import { saveBlob } from '../utils/exporters';
import { ProgressBar } from '../components/common';
import { Section, SettingRow } from '../views/SettingsView';
import { buildBackup, readBackup } from './backup';
import '../styles/data.css';

const WARN_AT = 0.8;

/** Export the workspace as a .zip, or replace it with one. */
function BackupSection({ onChanged }) {
  const { api } = useDrive();
  const { toast, openDialog } = useUI();
  const [progress, setProgress] = useState(null); // { label, pct } while exporting
  const [pending, setPending] = useState(null); // { file, manifest, state, files } awaiting confirmation
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const exportNow = async () => {
    if (progress) return false;
    setProgress({ label: 'Collecting files…', pct: 0 });
    try {
      const { blob, filename, manifest } = await buildBackup(api.get(), ({ phase, done, total }) => {
        if (phase === 'files') setProgress({ label: `Adding files… ${done} of ${total}`, pct: total ? (done / total) * 90 : 90 });
        else setProgress({ label: done ? 'Done' : 'Creating the .zip…', pct: done ? 100 : 95 });
      });
      saveBlob(blob, filename);
      toast(`Backup downloaded: ${manifest.counts.items} items, ${manifest.counts.files} stored file${manifest.counts.files === 1 ? '' : 's'} (${formatSize(blob.size)})`, { type: 'success' });
      api.logEvent('Workspace exported', 'Backup', `${manifest.counts.items} items · ${formatSize(blob.size)}`);
      return true;
    } catch (e) {
      toast(`The backup couldn’t be created: ${e?.message || 'unknown error'}`, { type: 'error' });
      return false;
    } finally {
      setProgress(null);
    }
  };

  const pick = async (file) => {
    if (!file) return;
    setError(''); setPending(null); setReading(true);
    try {
      const b = await readBackup(file);
      setPending({ file, ...b });
    } catch (e) {
      setError(e?.message || 'This file can’t be imported.');
    } finally {
      setReading(false);
    }
  };

  const replace = () => {
    const p = pending;
    openDialog('confirm', {
      title: 'Replace this workspace?',
      message: `Everything in this browser — files, folders, teams, settings and history — will be replaced by the backup from ${formatDateTime(p.manifest.exportedAt)}. This can’t be undone.`,
      confirmLabel: 'Replace workspace', danger: true,
      onConfirm: async () => {
        setImporting(true);
        try {
          await api.replaceWorkspace(p.state, p.files);
          api.logEvent('Workspace restored from backup', 'Backup', `Backup from ${formatDateTime(p.manifest.exportedAt)} · ${p.manifest.counts?.items ?? '?'} items`);
          setPending(null);
          toast('Workspace restored from the backup', { type: 'success' });
          onChanged?.();
        } catch (e) {
          toast(`The backup couldn’t be imported: ${e?.message || 'unknown error'}. Nothing was changed.`, { type: 'error', duration: 8000 });
        } finally {
          setImporting(false);
        }
      },
    });
  };

  const c = pending?.manifest.counts || {};
  return (
    <Section title="Backup & restore" desc="Everything is stored in this browser only. Download a backup to keep a copy or move your workspace to another browser.">
      <SettingRow title="Export workspace" desc="One .zip with all files (including older versions), folders, teams, sharing and settings.">
        <button className="btn btn-secondary btn-sm" onClick={exportNow} disabled={!!progress || importing}><Download size={15} /> Export workspace</button>
      </SettingRow>
      {progress && (
        <div className="backup-progress" role="status" aria-live="polite">
          <ProgressBar value={progress.pct} /><span className="muted small">{progress.label}</span>
        </div>
      )}
      <SettingRow title="Import workspace" desc="Replace everything in this browser with a backup made by this app.">
        <input ref={inputRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} aria-label="Backup file" />
        <button className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()} disabled={reading || importing}><Upload size={15} /> {reading ? 'Reading…' : 'Choose backup…'}</button>
      </SettingRow>
      {error && <div className="notice warn small backup-msg" role="alert"><AlertTriangle size={14} /> <span className="grow">{error}</span><button type="button" className="icon-btn sm" onClick={() => setError('')} aria-label="Dismiss"><X size={14} /></button></div>}
      {pending && (
        <div className="backup-summary" aria-label="Backup to import">
          <div className="backup-summary-head"><ArchiveRestore size={18} /><strong className="grow truncate">{pending.file.name}</strong></div>
          <dl className="backup-facts">
            <div><dt>Exported</dt><dd>{formatDateTime(pending.manifest.exportedAt)}</dd></div>
            <div><dt>Items</dt><dd>{c.items ?? Object.keys(pending.state.items).length}</dd></div>
            <div><dt>Stored files</dt><dd>{pending.files.length} ({formatSize(c.fileBytes ?? pending.files.reduce((n, [, b]) => n + b.size, 0))})</dd></div>
            <div><dt>Users / teams</dt><dd>{pending.state.users?.length || 0} / {pending.state.teams?.length || 0}</dd></div>
            <div><dt>Data version</dt><dd>{pending.state.seedVersion || 1}</dd></div>
          </dl>
          <div className="notice warn small"><AlertTriangle size={14} /> Importing replaces everything currently in this browser.</div>
          <div className="btn-row backup-actions">
            <button className="btn btn-secondary btn-sm" onClick={exportNow} disabled={!!progress || importing}><Download size={15} /> Download a backup of the current workspace first</button>
            <span className="grow" />
            <button className="btn btn-secondary btn-sm" onClick={() => setPending(null)} disabled={importing}>Cancel</button>
            <button className="btn btn-danger btn-sm" onClick={replace} disabled={importing || !!progress}>{importing ? 'Importing…' : 'Replace workspace'}</button>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Browser storage used / available and persistence. */
function StorageSection({ refreshKey }) {
  const { toast } = useUI();
  const [info, setInfo] = useState(null);
  const [files, setFiles] = useState(null);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState(null); // result of the last "Keep my data" request

  const refresh = useCallback(() => {
    storageInfo().then(setInfo);
    fileStore.usage().then(setFiles).catch(() => setFiles(null));
  }, []);
  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const keep = async () => {
    setAsking(true);
    const r = await requestPersistence();
    setAsking(false);
    setAnswer(r);
    refresh();
    if (r.granted) toast('Your browser will keep this workspace’s data', { type: 'success' });
  };

  const ratio = info?.usage != null && info?.quota ? info.usage / info.quota : null;
  const high = ratio != null && ratio > WARN_AT;
  return (
    <Section title="Browser storage" desc="Space this browser gives the workspace on this device.">
      {!info ? <div className="muted small">Checking…</div> : !info.supported ? (
        <div className="notice small">This browser doesn’t report how much storage is available.</div>
      ) : (
        <>
          <div className="big-meter"><ProgressBar value={(ratio || 0) * 100} tone={high ? 'danger' : ''} /><span>{ratio != null ? `${Math.round(ratio * 100)}%` : '—'}</span></div>
          <div className="muted small storage-line">
            <HardDrive size={13} /> {info.usage != null ? formatSize(info.usage) : '?'} used of {info.quota != null ? formatSize(info.quota) : '?'} available
            {files && <> · {files.count} stored file{files.count === 1 ? '' : 's'} ({formatSize(files.bytes)})</>}
          </div>
          {high && <div className="notice warn small" role="alert"><AlertTriangle size={14} /> Storage is over {Math.round(WARN_AT * 100)}% full. New uploads may fail and the browser may clear data. Export a backup, then empty Trash or remove large files.</div>}
        </>
      )}
      <SettingRow title="Keep my data" desc={info?.persisted
        ? 'Storage is persistent: the browser won’t clear this workspace to free up space.'
        : 'Storage is not yet persistent: the browser may clear this workspace if the device runs low on space.'}>
        {info?.persisted
          ? <span className="pill pill-green"><ShieldCheck size={13} /> Persistent</span>
          : <button className="btn btn-secondary btn-sm" onClick={keep} disabled={asking || info?.supported === false}><ShieldCheck size={15} /> {asking ? 'Asking…' : 'Keep my data'}</button>}
      </SettingRow>
      {answer && !answer.granted && (
        <div className="notice small backup-msg" role="status">
          {answer.supported
            ? 'The browser declined for now. Browsers usually allow this for sites you use often, bookmark or install as an app — it may be granted later. Your data is still saved; export a backup regularly to be safe.'
            : 'This browser can’t keep data persistently. Your data is still saved; export a backup regularly to be safe.'}
        </div>
      )}
    </Section>
  );
}

export default function BackupPanel() {
  const [n, setN] = useState(0);
  return (
    <>
      <BackupSection onChanged={() => setN((x) => x + 1)} />
      <StorageSection refreshKey={n} />
    </>
  );
}
