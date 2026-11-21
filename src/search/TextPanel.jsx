import { Fragment, useState } from 'react';
import { ScanText, FileText, Copy, Loader2, AlertTriangle, Plus, X, Sparkles, ListPlus } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { canModify, formatFieldValue } from '../store/selectors';
import { getFileType } from '../utils/fileTypes';
import { getEntry, indexStatus, useSearchIndex } from './searchIndex';
import { indexKey } from './Indexer';
import { suggestFor } from './suggest';
import { LabelChip } from '../components/dialogs/OrganizeDialogs';

const SOURCE = { ocr: 'Read from the image (OCR)', pdf: 'PDF text', document: 'Document text', spreadsheet: 'Spreadsheet cells', slides: 'Slide text', text: 'File text', archive: 'Files inside the archive' };

/** Details-panel section: what text was found in the file, and label/field suggestions from it. */
export default function TextPanel({ item }) {
  const { state, api } = useDrive();
  const ui = useUI();
  useSearchIndex();
  const [full, setFull] = useState(false);
  if (item.type !== 'file' || item.trashed) return null;
  const ocrOn = state.org.policies.ocr !== false;
  const entry = getEntry(item.id);
  const fresh = entry && entry.key === indexKey(item, ocrOn);
  const working = !fresh && (indexStatus().current === item.id || indexStatus().pending > 0);
  const cat = getFileType(item.ext).category;
  const text = fresh ? entry.text : '';
  const mode = state.org.policies.smartLabels || 'suggest';
  const sug = fresh && mode !== 'off' && canModify(state, item) ? suggestFor(state, item, text) : { labels: [], template: null };
  if (!fresh && !working && cat === 'video') return null;

  const copy = async () => { try { await navigator.clipboard.writeText(text); ui.toast('Text copied', { type: 'success' }); } catch { ui.toast('Copy failed', { type: 'error' }); } };
  const shown = full ? text : text.slice(0, 420);

  return (
    <div className="details-section text-panel">
      <div className="details-section-head">
        <span>Text in this file</span>
        {text && <button className="link-btn" onClick={copy}><Copy size={13} /> Copy</button>}
      </div>
      {working && <div className="muted small index-state"><Loader2 size={13} className="spin" /> {OCR_HINT(cat, ocrOn)}</div>}
      {fresh && entry.source === 'error' && <div className="muted small index-state"><AlertTriangle size={13} /> Couldn't read this file's text ({entry.error}).</div>}
      {fresh && entry.skipped && <div className="muted small">Text recognition (OCR) is turned off by your administrator.</div>}
      {fresh && !entry.skipped && entry.source !== 'error' && (
        text ? (
          <>
            <div className="index-source">{entry.source === 'ocr' ? <ScanText size={13} /> : <FileText size={13} />} {SOURCE[entry.source] || 'Text'}{entry.confidence ? ` · ${entry.confidence}% confidence` : ''} · searchable</div>
            <pre className="text-preview">{shown}{!full && text.length > 420 ? '…' : ''}</pre>
            {text.length > 420 && <button className="link-btn" onClick={() => setFull(!full)}>{full ? 'Show less' : `Show all (${text.length.toLocaleString()} characters)`}</button>}
          </>
        ) : <div className="muted small">{entry.source === 'none' ? 'This file type has no text that can be searched.' : 'No text was found in this file.'}</div>
      )}

      {(sug.labels.length > 0 || sug.template) && (
        <div className="suggest-box">
          <div className="suggest-head"><Sparkles size={13} /> Suggestions</div>
          <div className="muted small suggest-note">Found by keyword rules in the file's text (not AI). Check before applying.</div>
          {sug.labels.map(({ label, why }) => (
            <div key={label.id} className="sugg-row">
              <LabelChip label={label} small />
              <span className="muted small grow">{why}</span>
              <button className="icon-btn xs" onClick={() => { api.applySuggestions(item.id, { labelIds: [label.id] }); ui.toast(`Label “${label.name}” added`, { type: 'success' }); }} aria-label={`Add label ${label.name}`} data-tip="Add"><Plus size={14} /></button>
              <button className="icon-btn xs" onClick={() => api.dismissSuggestion(item.id, `label:${label.id}`)} aria-label={`Dismiss ${label.name}`} data-tip="Dismiss"><X size={14} /></button>
            </div>
          ))}
          {sug.template && (
            <div className="suggest-tpl">
              <div className="small"><ListPlus size={13} /> <strong>{sug.template.tpl.name}</strong> fields <span className="muted">· {sug.template.why}</span></div>
              <dl className="info-list compact">
                {sug.template.tpl.fields.filter((f) => sug.template.values[f.id] !== undefined).map((f) => (
                  <Fragment key={f.id}><dt>{f.name}</dt><dd>{formatFieldValue(f, sug.template.values[f.id])}</dd></Fragment>
                ))}
              </dl>
              <div className="btn-row">
                <button className="btn btn-primary btn-sm" onClick={() => { api.applySuggestions(item.id, { meta: { templateId: sug.template.tpl.id, values: sug.template.values } }); ui.toast(`${sug.template.tpl.name} fields filled in`, { type: 'success' }); }}>Apply fields</button>
                <button className="btn btn-secondary btn-sm" onClick={() => ui.openDialog('metadata', { id: item.id, suggested: { templateId: sug.template.tpl.id, values: sug.template.values } })}>Review…</button>
                <button className="btn btn-ghost btn-sm" onClick={() => api.dismissSuggestion(item.id, `tpl:${sug.template.tpl.id}`)}>Dismiss</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OCR_HINT(cat, ocrOn) {
  if ((cat === 'image' || cat === 'pdf') && ocrOn) return 'Reading text… (images and scans can take a few seconds)';
  return 'Indexing…';
}
