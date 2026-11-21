import { useRef, useState } from 'react';
import { UploadCloud, FileUp, FolderUp, X, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, RotateCw, Ban, Loader2, Copy } from 'lucide-react';
import { useUI } from '../../store/UIContext';
import { useDrive } from '../../store/DriveStore';
import { useUploads, MAX_FILE_SIZE } from '../../store/UploadContext';
import { formatSize, formatDate, splitName } from '../../utils/format';
import { readDrop } from '../../utils/dropFiles';
import { Modal, FileGlyph, ProgressBar } from '../common';
import { FolderSelect } from './FileDialogs';

export function UploadDialog({ onClose, initialFiles = [] }) {
  const ui = useUI();
  const uploads = useUploads();
  const [files, setFiles] = useState(initialFiles);
  const [emptyDirs, setEmptyDirs] = useState(initialFiles.emptyDirs || []);
  const [over, setOver] = useState(false);
  const [dest, setDest] = useState(ui.cwd.writable ? `${ui.cwd.space}|${ui.cwd.parentId || ''}` : 'my|');
  const fileRef = useRef(null);
  const folderRef = useRef(null);

  const pathOf = (f) => f.webkitRelativePath || f.relativePath || '';
  const add = (list) => {
    setFiles((f) => [...f, ...[...list].filter((n) => !f.some((x) => x.name === n.name && x.size === n.size && pathOf(x) === pathOf(n)))]);
    if (list.emptyDirs?.length) setEmptyDirs((d) => [...new Set([...d, ...list.emptyDirs])]);
  };
  const total = files.reduce((s, f) => s + f.size, 0);
  const tooBig = files.filter((f) => f.size > MAX_FILE_SIZE).length;

  const start = () => {
    const [space, id] = dest.split('|');
    onClose(); // close first: the duplicate dialog (if needed) replaces this one
    uploads.upload(Object.assign([...files], { emptyDirs }), id || null, space);
  };

  return (
    <Modal title="Upload files" onClose={onClose} width={560} icon={<UploadCloud size={20} />}
      footer={<>
        <span className="muted small grow">{files.length ? `${files.length} file${files.length > 1 ? 's' : ''} · ${formatSize(total)}${emptyDirs.length ? ` · ${emptyDirs.length} empty folder${emptyDirs.length > 1 ? 's' : ''}` : ''}` : `Max ${formatSize(MAX_FILE_SIZE)} per file`}</span>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={(!files.length || tooBig === files.length) && !emptyDirs.length} onClick={start}>Upload{files.length - tooBig ? ` ${files.length - tooBig}` : ''}</button>
      </>}>
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); readDrop(e.dataTransfer).then(add); }}
      >
        <UploadCloud size={36} strokeWidth={1.4} className="dz-icon" />
        <div className="dz-title">Drag and drop files here</div>
        <div className="muted small">or</div>
        <div className="btn-row center">
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}><FileUp size={15} /> Browse files</button>
          <button className="btn btn-secondary" onClick={() => folderRef.current?.click()}><FolderUp size={15} /> Browse folder</button>
        </div>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { add([...e.target.files]); e.target.value = ''; }} />
        <input ref={folderRef} type="file" multiple hidden webkitdirectory="" directory="" onChange={(e) => { add([...e.target.files]); e.target.value = ''; }} />
      </div>

      {files.length > 0 && (
        <ul className="pending-files">
          {files.map((f, i) => (
            <li key={i} className={f.size > MAX_FILE_SIZE ? 'bad' : ''}>
              <FileGlyph ext={splitName(f.name)[1]} size={24} />
              <div className="min0 grow">
                <div className="truncate">{pathOf(f) || f.name}</div>
                <div className="muted small">{formatSize(f.size)}{f.size > MAX_FILE_SIZE && ' · exceeds file size limit'}</div>
              </div>
              <button className="icon-btn sm" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><X size={15} /></button>
            </li>
          ))}
        </ul>
      )}
      {tooBig > 0 && <div className="field-warn">{tooBig} file{tooBig > 1 ? 's exceed' : ' exceeds'} the {formatSize(MAX_FILE_SIZE)} limit and will fail.</div>}

      <label className="field">
        <span className="field-label">Upload to</span>
        <FolderSelect value={dest} onChange={setDest} />
      </label>
    </Modal>
  );
}

/** Shown before uploading when some names already exist in the destination. */
export function UploadConflictDialog({ files, parentId, space, conflicts, onClose }) {
  const uploads = useUploads();
  const { state } = useDrive();
  const [choice, setChoice] = useState(() => Object.fromEntries(conflicts.map((c) => [c.index, 'keep'])));
  const setAll = (v) => setChoice(Object.fromEntries(conflicts.map((c) => [c.index, v === 'replace' && !c.canReplace ? 'keep' : v])));
  const counts = Object.values(choice).reduce((a, v) => ({ ...a, [v]: (a[v] || 0) + 1 }), {});
  const sending = files.length - (counts.skip || 0);
  const go = () => {
    uploads.upload(files, parentId, space, {
      decisions: choice,
      replaceIds: Object.fromEntries(conflicts.map((c) => [c.index, c.existingId])),
    });
    onClose();
  };
  const OPTIONS = [['replace', 'Replace'], ['keep', 'Keep both'], ['skip', 'Skip']];
  return (
    <Modal title={conflicts.length === 1 ? 'A file with this name already exists' : `${conflicts.length} files already exist`} onClose={onClose} width={620} icon={<Copy size={20} />}
      footer={<>
        <span className="muted small grow">{sending ? `${sending} of ${files.length} file${files.length === 1 ? '' : 's'} will upload` : 'Nothing will upload'}</span>
        <button className="btn btn-secondary" onClick={onClose}>Cancel upload</button>
        <button className="btn btn-primary" onClick={go} disabled={!sending && !(files.emptyDirs || []).length}>Continue</button>
      </>}>
      <p className="muted small conflict-help"><strong>Replace</strong> keeps the existing file (its comments, sharing and labels) and saves your upload as a new version. <strong>Keep both</strong> uploads a copy with a number added to its name.</p>
      {conflicts.length > 1 && (
        <div className="conflict-all">
          <span className="small strong">Apply to all:</span>
          {OPTIONS.map(([v, l]) => <button key={v} className="btn btn-secondary btn-sm" onClick={() => setAll(v)}>{l}</button>)}
        </div>
      )}
      <ul className="conflict-list">
        {conflicts.map((c) => {
          const existing = state.items[c.existingId];
          const file = files[c.index];
          return (
            <li key={c.index}>
              <FileGlyph ext={splitName(c.name)[1]} size={26} />
              <div className="min0 grow">
                <div className="truncate strong" title={c.path}>{c.path}</div>
                <div className="muted small truncate">
                  {c.reason || `Existing: ${formatSize(existing?.size)} · modified ${formatDate(existing?.modifiedAt)} · New: ${formatSize(file.size)}`}
                </div>
              </div>
              <div className="seg seg-sm" role="radiogroup" aria-label={`What to do with ${c.name}`}>
                {OPTIONS.map(([v, l]) => (
                  <button key={v} role="radio" aria-checked={choice[c.index] === v} className={choice[c.index] === v ? 'active' : ''}
                    disabled={v === 'replace' && !c.canReplace} title={v === 'replace' && !c.canReplace ? c.reason : undefined}
                    onClick={() => setChoice((s) => ({ ...s, [c.index]: v }))}>{l}</button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

const STATUS = {
  queued: { label: 'Waiting…', icon: Loader2 },
  uploading: { label: 'Uploading', icon: Loader2 },
  done: { label: 'Uploaded', icon: CheckCircle2 },
  error: { label: 'Failed', icon: AlertCircle },
  cancelled: { label: 'Cancelled', icon: Ban },
};

export function UploadPanel() {
  const u = useUploads();
  const { openPreview, openDialog } = useUI();
  if (!u.panelOpen || !u.queue.length) return null;
  const active = u.queue.filter((x) => x.status === 'uploading' || x.status === 'queued');
  const done = u.queue.filter((x) => x.status === 'done').length;
  const failed = u.queue.filter((x) => x.status === 'error').length;
  const pct = active.length ? active.reduce((s, x) => s + x.progress, 0) / active.length : 100;
  const title = active.length ? `Uploading ${active.length} item${active.length > 1 ? 's' : ''}` : `${done} upload${done === 1 ? '' : 's'} complete${failed ? `, ${failed} failed` : ''}`;
  return (
    <section className="upload-panel slide-up" aria-label="Upload progress">
      <header className="up-head">
        {active.length ? <Loader2 size={16} className="spin text-primary" /> : failed ? <AlertCircle size={16} className="text-danger" /> : <CheckCircle2 size={16} className="text-success" />}
        <strong className="grow">{title}</strong>
        {active.length > 0 && <button className="link-btn" onClick={u.cancelAll}>Cancel all</button>}
        <button className="icon-btn sm" onClick={() => u.setMinimized(!u.minimized)} aria-label={u.minimized ? 'Expand' : 'Minimize'}>{u.minimized ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
        <button className="icon-btn sm" aria-label="Close upload panel" onClick={() => {
          if (!active.length) { u.closePanel(); return; }
          openDialog('confirm', {
            title: `Cancel ${active.length} upload${active.length > 1 ? 's' : ''}?`,
            message: 'Files that haven’t finished uploading will be cancelled. To keep them going, minimize the panel instead.',
            confirmLabel: 'Cancel uploads', cancelLabel: 'Keep uploading', danger: true, onConfirm: () => u.closePanel({ cancel: true }),
          });
        }}><X size={16} /></button>
      </header>
      {active.length > 0 && <ProgressBar value={pct} />}
      {!u.minimized && (
        <ul className="up-list">
          {u.queue.map((x) => {
            const S = STATUS[x.status];
            return (
              <li key={x.id} className={`up-item ${x.status}`}>
                <FileGlyph ext={splitName(x.name)[1]} size={26} />
                <div className="min0 grow">
                  <button className="up-name truncate" disabled={x.status !== 'done'} onClick={() => x.itemId && openPreview(x.itemId, [x.itemId])}>{x.finalName || x.name}</button>
                  {x.status === 'uploading' ? (
                    <div className="up-progress"><ProgressBar value={x.progress} /><span>{x.progress}%</span></div>
                  ) : (
                    <div className={`up-status ${x.status}`}>{x.error || S.label} · {formatSize(x.size)}</div>
                  )}
                </div>
                {x.status === 'uploading' || x.status === 'queued' ? (
                  <button className="icon-btn sm" onClick={() => u.cancel(x.id)} aria-label={`Cancel ${x.name}`} data-tip="Cancel"><X size={15} /></button>
                ) : x.status === 'cancelled' || (x.status === 'error' && x.retryable) ? (
                  <button className="icon-btn sm" onClick={() => u.retry(x.id)} aria-label={`Retry ${x.name}`} data-tip="Retry"><RotateCw size={15} /></button>
                ) : (
                  <S.icon size={17} className={x.status === 'done' ? 'text-success' : 'text-danger'} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
