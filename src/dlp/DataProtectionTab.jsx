import { useMemo, useState } from 'react';
import { ShieldAlert, Globe2, UserX, Building2, ShieldCheck } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { useItemActions } from '../store/useItemActions';
import { locationOf } from '../store/selectors';
import { formatDateTime } from '../utils/format';
import { useSearchIndex, indexStatus } from '../search/searchIndex';
import { DETECTORS, SEVERITY, findingsFor, topSeverity, exposureOf, summarize } from './dlp';
import { Switch, EmptyState, FileIcon } from '../components/common';
import { Section, SettingRow } from '../views/SettingsView';

const ACTIONS = [
  ['monitor', 'Monitor only', 'Flag files and report them; never interrupt sharing.'],
  ['warn', 'Warn', 'Ask people to confirm before sharing sensitive files publicly or externally. Overrides are logged.'],
  ['block', 'Block', 'Refuse public links and external sharing for sensitive files. Existing public links stop working for outsiders.'],
];
const pillTone = (sev) => (SEVERITY[sev].tone === 'red' ? 'pill-red' : SEVERITY[sev].tone === 'amber' ? 'pill-amber' : 'pill-gray');

/** Admin Console → Data protection: policy, detectors, and a report of files holding sensitive data. */
export default function DataProtectionTab() {
  const { state, api } = useDrive();
  const ui = useUI();
  const actions = useItemActions();
  const indexVersion = useSearchIndex();
  const p = state.org.policies.dlp || {};
  const [exposedOnly, setExposedOnly] = useState(false);
  const set = (patch, msg) => { api.updateOrg({ policies: { dlp: { ...p, ...patch } } }); if (msg) ui.toast(msg, { type: 'success' }); };

  const rows = useMemo(() => Object.values(state.items)
    .filter((i) => i.type === 'file' && !i.trashed)
    .map((i) => ({ item: i, findings: findingsFor(state, i) }))
    .filter((r) => r.findings.length)
    .map((r) => ({ ...r, sev: topSeverity(r.findings), exp: exposureOf(state, r.item) }))
    .sort((a, b) => SEVERITY[b.sev].rank - SEVERITY[a.sev].rank || Number(b.exp.publicLink) - Number(a.exp.publicLink)), [state, indexVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const minRank = SEVERITY[p.minSeverity || 'medium'].rank;
  const policyRows = rows.filter((r) => SEVERITY[r.sev].rank >= minRank);
  const isExposed = (r) => r.exp.publicLink || r.exp.external.length > 0;
  const shown = exposedOnly ? rows.filter(isExposed) : rows;
  const fileCount = (id) => rows.filter((r) => r.findings.some((f) => f.id === id)).length;
  const events = state.audit.filter((a) => /DLP|Sensitive data/.test(a.action)).slice(0, 8);

  return (
    <>
      <div className="stat-row">
        <div className="stat-tile"><div className="stat-label">Files with sensitive data</div><div className="stat-value">{policyRows.length}</div><div className="stat-sub">{SEVERITY[p.minSeverity || 'medium'].label} severity or higher</div></div>
        <div className="stat-tile"><div className="stat-label">High severity</div><div className="stat-value">{rows.filter((r) => r.sev === 'high').length}</div><div className="stat-sub">cards, IDs, bank details, secrets</div></div>
        <div className="stat-tile"><div className="stat-label">Public links on them</div><div className="stat-value">{policyRows.filter((r) => r.exp.publicLink).length}</div><div className="stat-sub">anyone with the link</div></div>
        <div className="stat-tile"><div className="stat-label">Shared externally</div><div className="stat-value">{policyRows.filter((r) => r.exp.external.length).length}</div><div className="stat-sub">people outside {state.org.domain}</div></div>
      </div>

      <Section title="Data loss prevention" desc="Scans the text of every file (including text read from images by OCR) for sensitive information and controls how those files can be shared.">
        <SettingRow title="Scan files for sensitive data" desc={indexStatus().pending ? `Scanning… ${indexStatus().pending} file(s) waiting to be read.` : 'Uses the search index, so new and changed files are checked automatically.'}>
          <Switch checked={!!p.enabled} onChange={(v) => set({ enabled: v }, v ? 'Data loss prevention turned on' : 'Data loss prevention turned off')} label="Data loss prevention" />
        </SettingRow>
        {p.enabled && (
          <>
            <div className="dlp-actions" role="radiogroup" aria-label="When sensitive files are shared">
              {ACTIONS.map(([v, label, desc]) => (
                <button key={v} role="radio" aria-checked={p.action === v} className={`dlp-action ${p.action === v ? 'on' : ''}`} onClick={() => set({ action: v }, `Policy set to “${label}”`)}>
                  <strong>{label}</strong><span className="muted small">{desc}</span>
                </button>
              ))}
            </div>
            <SettingRow title="Applies to files with" desc="Lower-severity findings (like a list of email addresses) are still reported but don't trigger the policy.">
              <select className="select" value={p.minSeverity || 'medium'} onChange={(e) => set({ minSeverity: e.target.value }, 'Severity threshold saved')} aria-label="Minimum severity">
                <option value="high">High severity only</option><option value="medium">Medium or high</option><option value="low">Any finding</option>
              </select>
            </SettingRow>
            <SettingRow title="Check public links" desc="“Anyone with the link” shares."><Switch checked={!!p.publicLinks} onChange={(v) => set({ publicLinks: v })} label="Check public links" /></SettingRow>
            <SettingRow title="Check external sharing" desc={`Sharing with people whose email isn't @${state.org.domain}.`}><Switch checked={!!p.external} onChange={(v) => set({ external: v })} label="Check external sharing" /></SettingRow>
          </>
        )}
      </Section>

      {p.enabled && (
        <Section title="What to look for" desc="Pattern detectors. Card numbers and IBANs are checksum-validated to avoid false alarms; list detectors need at least 5 entries.">
          <div className="detector-list">
            {DETECTORS.map((d) => (
              <div key={d.id} className="detector-row">
                <span className={`pill ${pillTone(d.severity)}`}>{SEVERITY[d.severity].label}</span>
                <span className="grow">{d.name}</span>
                <span className="muted small">{fileCount(d.id) ? `${fileCount(d.id)} file${fileCount(d.id) === 1 ? '' : 's'}` : ''}</span>
                <Switch checked={p.detectors?.[d.id] !== false} onChange={(v) => set({ detectors: { ...(p.detectors || {}), [d.id]: v } })} label={d.name} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {p.enabled && (
        <Section title="Files with sensitive data" desc="Highest risk first. Fix exposure here, or open a file to review its findings."
          actions={<label className="check-row"><input type="checkbox" className="cb" checked={exposedOnly} onChange={(e) => setExposedOnly(e.target.checked)} /> Exposed outside {state.org.name} only</label>}>
          {!shown.length ? <EmptyState compact icon={ShieldCheck} title={exposedOnly ? 'Nothing sensitive is exposed' : 'No sensitive data found'} text={indexStatus().pending ? 'Some files are still being scanned.' : ''} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>File</th><th>Found</th><th className="hide-sm">Exposure</th><th /></tr></thead>
                <tbody>
                  {shown.map(({ item, findings, sev, exp }) => (
                    <tr key={item.id}>
                      <td><button className="dlp-file" onClick={() => actions.open(item, [item])}><FileIcon item={item} size={22} /><span className="min0"><span className="truncate block">{item.name}</span><span className="muted small truncate block">{locationOf(state, item)}</span></span></button></td>
                      <td><span className={`pill ${pillTone(sev)}`}>{SEVERITY[sev].label}</span> <span className="small">{summarize(findings, 2)}</span></td>
                      <td className="hide-sm small">
                        {exp.publicLink && <span className="expo bad"><Globe2 size={13} /> Public link</span>}
                        {exp.external.length > 0 && <span className="expo bad"><UserX size={13} /> {exp.external.length} external</span>}
                        {!isExposed({ exp }) && <span className="expo"><Building2 size={13} /> Internal only</span>}
                      </td>
                      <td className="row-actions">
                        {exp.publicLink && <button className="btn btn-secondary btn-sm" onClick={() => { api.setLink(item.id, { ...item.link, access: 'org' }); api.logEvent('Public link limited (DLP)', item.name, 'Limited to organization from Data protection', { itemId: item.id }); ui.toast(`“${item.name}” is now limited to ${state.org.name}`, { type: 'success' }); }}>Limit link</button>}
                        {exp.external.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => ui.openDialog('share', { id: item.id })}>Review sharing</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {events.length > 0 && (
        <Section title="Recent data protection events">
          <ul className="dlp-events">
            {events.map((a) => <li key={a.id}><ShieldAlert size={13} /> <span className="grow"><strong>{state.users.find((u) => u.id === a.actorId)?.name || 'Someone'}</strong> · {a.action} · {a.target}{a.details ? <span className="muted"> · {a.details}</span> : null}</span><span className="muted small nowrap">{formatDateTime(a.at)}</span></li>)}
          </ul>
        </Section>
      )}
    </>
  );
}
