import { ShieldAlert, Globe2, UserX, Undo2 } from 'lucide-react';
import { useDrive, useMe } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { accessOf, canManage, canEdit } from '../store/selectors';
import { useSearchIndex } from '../search/searchIndex';
import { findingsFor, exposureOf, SEVERITY, topSeverity, detectorById } from './dlp';

/** Details-panel section: sensitive data found in this file and how exposed it currently is. */
export default function SensitivePanel({ item }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const me = useMe();
  useSearchIndex();
  if (item.type !== 'file' || item.trashed || !state.org.policies.dlp?.enabled) return null;
  const findings = findingsFor(state, item);
  const ignored = item.dlpIgnore || [];
  if (!findings.length && !ignored.length) return null;
  const access = accessOf(state, item);
  const canReview = me?.role === 'Admin' || canManage(access) || item.ownerId === state.meId; // who may mark false positives
  const canShare = canEdit(access);
  const exp = exposureOf(state, item);
  const sev = topSeverity(findings);

  return (
    <div className={`details-section dlp-panel ${sev ? `sev-${sev}` : ''}`}>
      <div className="details-section-head"><span><ShieldAlert size={14} /> Sensitive data</span></div>
      {findings.length > 0 && (
        <ul className="dlp-findings">
          {findings.map((f) => (
            <li key={f.id}>
              <span className={`pill pill-${SEVERITY[f.severity].tone === 'red' ? 'red' : SEVERITY[f.severity].tone === 'amber' ? 'amber' : 'gray'}`}>{SEVERITY[f.severity].label}</span>
              <span className="grow min0"><strong>{f.count} {f.count === 1 ? detectorById[f.id].one : detectorById[f.id].many}</strong><span className="muted small block mono">{f.samples.join('  ')}</span></span>
              {canReview && <button className="link-btn" onClick={() => { api.setDlpIgnore(item.id, f.id, true, detectorById[f.id].name); ui.toast(`Marked “${detectorById[f.id].name}” as not sensitive for this file`, { type: 'success' }); }}>Not sensitive</button>}
            </li>
          ))}
        </ul>
      )}
      {findings.length > 0 && (exp.publicLink || exp.external.length > 0) ? (
        <div className="dlp-exposure">
          {exp.publicLink && (
            <div className="dlp-expo-row"><Globe2 size={14} /> <span className="grow">Anyone with the link can open it.</span>
              {canShare && <button className="btn btn-secondary btn-sm" onClick={() => { api.setLink(item.id, { ...item.link, access: 'org' }); ui.toast('Link limited to your organization', { type: 'success' }); }}>Limit to {state.org.name}</button>}
            </div>
          )}
          {exp.external.length > 0 && (
            <div className="dlp-expo-row"><UserX size={14} /> <span className="grow">Shared outside the organization with {exp.external.map((u) => u.name).join(', ')}.</span>
              {canShare && <button className="btn btn-secondary btn-sm" onClick={() => ui.openDialog('share', { id: item.id })}>Review sharing</button>}
            </div>
          )}
        </div>
      ) : findings.length > 0 && <div className="muted small">Not shared outside {state.org.name}.</div>}
      {ignored.length > 0 && (
        <div className="muted small dlp-ignored">
          Marked not sensitive: {ignored.map((id) => detectorById[id]?.name || id).join(', ')}
          {canReview && <button className="link-btn" onClick={() => ignored.forEach((id) => api.setDlpIgnore(item.id, id, false, detectorById[id]?.name))}><Undo2 size={12} /> Undo</button>}
        </div>
      )}
    </div>
  );
}
