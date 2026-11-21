import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Table2, LineChart, Copy, Clock3, HardDrive } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useItemActions } from '../store/useItemActions';
import { locationOf } from '../store/selectors';
import { formatSize, formatDate } from '../utils/format';
import { getFileType } from '../utils/fileTypes';
import { FileIcon, Avatar, EmptyState } from '../components/common';
import { Section } from './SettingsView';

const DAY = 86400000;
const CATEGORY_LABEL = { document: 'Documents', spreadsheet: 'Spreadsheets', presentation: 'Presentations', pdf: 'PDFs', image: 'Images', video: 'Videos', archive: 'Archives', text: 'Text', other: 'Other' };

/** Everything the dashboard shows, derived from the current drive. */
function useStorageStats(state, staleDays) {
  return useMemo(() => {
    const all = Object.values(state.items).filter((i) => i.type === 'file');
    const live = all.filter((i) => !i.trashed);
    const used = live.reduce((s, i) => s + i.size, 0);
    const trash = all.filter((i) => i.trashed).reduce((s, i) => s + i.size, 0);
    const versions = all.reduce((s, i) => s + (i.versions || []).reduce((a, v) => a + (v.size || 0), 0), 0);

    // Growth: total size of today's files by the month they were added (12 months, cumulative).
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, k) => {
      const end = new Date(now.getFullYear(), now.getMonth() - (11 - k) + 1, 1).getTime() - 1;
      return { t: end, label: new Date(end).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), value: live.filter((i) => i.createdAt <= end).reduce((s, i) => s + i.size, 0) };
    });

    const byType = {};
    for (const i of live) { const c = getFileType(i.ext).category; byType[c] = (byType[c] || 0) + i.size; }
    const types = Object.entries(byType).map(([c, size]) => ({ id: c, label: CATEGORY_LABEL[c] || c, size })).sort((a, b) => b.size - a.size);

    const teams = state.teams.map((t) => ({ id: t.id, name: t.name, quota: t.quota, used: live.filter((i) => i.space === t.id).reduce((s, i) => s + i.size, 0) })).sort((a, b) => b.used / b.quota - a.used / a.quota);
    const personalUsed = live.filter((i) => i.space === 'my' || i.space === 'user').reduce((s, i) => s + i.size, 0);

    const largest = [...live].sort((a, b) => b.size - a.size).slice(0, 10);
    const cutoff = Date.now() - staleDays * DAY;
    const stale = live.filter((i) => Math.max(i.modifiedAt || 0, i.lastOpened || 0) < cutoff).sort((a, b) => b.size - a.size);

    // Duplicates: same size and same name once "(1)"-style copy suffixes are ignored.
    const groups = new Map();
    for (const i of live) {
      if (!i.size) continue;
      const key = `${i.name.toLowerCase().replace(/ \(\d+\)(?=\.[^.]+$|$)/, '')}|${i.size}`;
      groups.set(key, [...(groups.get(key) || []), i]);
    }
    const dupes = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1));

    return { used, trash, versions, count: live.length, months, types, teams, personalUsed, largest, stale, dupes };
  }, [state, staleDays]);
}

/* ------------------------------------------------------------------ */
/* Stat tiles                                                          */
/* ------------------------------------------------------------------ */
function StatTile({ label, value, sub }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Single-series area chart with crosshair tooltip + table view        */
/* ------------------------------------------------------------------ */
/**
 * Clean axis for byte values: pick a display unit (KB/MB/GB, 1024-based like formatSize) first, then a
 * round maximum in that unit that splits into five whole steps, e.g. 0 / 100 / 200 / … / 500 MB.
 */
const UNITS = [['B', 1], ['KB', 1024], ['MB', 1024 ** 2], ['GB', 1024 ** 3], ['TB', 1024 ** 4]];
function byteAxis(maxBytes) {
  const [name, size] = [...UNITS].reverse().find(([, u]) => maxBytes >= u) || UNITS[0];
  const v = Math.max(maxBytes / size, 1);
  const p = 10 ** Math.floor(Math.log10(v));
  const max = [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v);
  const step = max / 5;
  return { max: max * size, ticks: Array.from({ length: 6 }, (_, k) => k * step * size), label: (b) => `${(b / size).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${name}` };
}

function GrowthChart({ points }) {
  const wrap = useRef(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);

  const H = 220; const pad = { l: 60, r: 24, t: 14, b: 28 };
  const iw = w - pad.l - pad.r; const ih = H - pad.t - pad.b;
  const axis = byteAxis(Math.max(...points.map((p) => p.value)));
  const { max } = axis;
  const x = (i) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${pad.t + ih} L${x(0)},${pad.t + ih} Z`;
  const { ticks } = axis;
  const last = points[points.length - 1];
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - pad.l) / iw) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div><div className="chart-title">Storage used over time</div><div className="muted small">Total size of current files, by the month they were added</div></div>
        <button className="btn btn-secondary btn-sm" onClick={() => setTable(!table)} aria-pressed={table}>{table ? <><LineChart size={14} /> Chart</> : <><Table2 size={14} /> Table</>}</button>
      </div>
      {table ? (
        <table className="table compact"><thead><tr><th>Month</th><th className="num">Storage used</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.t}><td>{p.label}</td><td className="num">{formatSize(p.value)}</td></tr>)}</tbody></table>
      ) : (
        <div className="chart-wrap" ref={wrap}>
          <svg width={w} height={H} role="img" aria-label={`Storage used grew to ${formatSize(last.value)} by ${last.label}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="grid" />
                <text x={pad.l - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">{axis.label(t)}</text>
              </g>
            ))}
            {points.map((p, i) => (i % 2 === (points.length - 1) % 2
              ? <text key={p.t} x={x(i)} y={H - 8} className="tick" textAnchor={i === points.length - 1 ? 'end' : 'middle'}>{p.label}</text>
              : null))}
            <path d={area} className="area" />
            <path d={line} className="line" />
            <circle cx={x(points.length - 1)} cy={y(last.value)} r="4.5" className="dot" />
            <text x={x(points.length - 1) - 8} y={y(last.value) - 12} className="end-label" textAnchor="end">{formatSize(last.value)}</text>
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="crosshair" />
                <circle cx={x(hover)} cy={y(points[hover].value)} r="5" className="dot" />
              </g>
            )}
            <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
          </svg>
          {hover != null && (
            <div className="chart-tip" style={{ left: Math.min(x(hover) + 12, w - 150), top: Math.max(4, y(points[hover].value) - 54) }}>
              <div className="muted small">{points[hover].label}</div>
              <div className="strong">{formatSize(points[hover].value)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meter list (team usage vs each team's quota) and ranked bars        */
/* ------------------------------------------------------------------ */
function MeterList({ rows }) {
  return (
    <div className="meter-list">
      {rows.map((r) => {
        const pct = r.quota ? (r.used / r.quota) * 100 : 0;
        const tone = pct >= 90 ? 'danger' : pct >= 75 ? 'warning' : '';
        return (
          <div key={r.id} className="meter-row">
            <span className="meter-name truncate">{r.name}</span>
            <span className={`meter ${tone}`} title={`${r.name}: ${formatSize(r.used)} of ${formatSize(r.quota)} (${pct.toFixed(1)}%)`} role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.name} storage`}>
              <span style={{ width: `${Math.min(100, Math.max(pct, r.used ? 1.5 : 0))}%` }} />
            </span>
            <span className="meter-fig">{formatSize(r.used)} <span className="muted">/ {formatSize(r.quota)}</span></span>
          </div>
        );
      })}
    </div>
  );
}

function RankedBars({ rows, total }) {
  const max = Math.max(...rows.map((r) => r.size), 1);
  return (
    <div className="ranked-bars">
      {rows.map((r) => (
        <div key={r.id} className="rbar-row" title={`${r.label}: ${formatSize(r.size)} (${((r.size / total) * 100).toFixed(1)}% of storage used)`}>
          <span className="rbar-name">{r.label}</span>
          <span className="rbar-track">
            <span className="rbar" style={{ width: `${(r.size / max) * 100}%` }} />
            <span className="rbar-val" style={{ left: `calc(${(r.size / max) * 100}% + 8px)` }}>{formatSize(r.size)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function FileTable({ files, state, actions, extra }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>File</th><th className="hide-sm">Location</th><th className="hide-sm">Owner</th>{extra && <th className="hide-sm">{extra.head}</th>}<th className="num">Size</th></tr></thead>
        <tbody>
          {files.map((f) => {
            const owner = state.users.find((u) => u.id === f.ownerId);
            return (
              <tr key={f.id} className="clickable" onClick={() => actions.open(f, [f])}>
                <td><span className="cell-name-inline"><FileIcon item={f} size={22} /><button type="button" className="link-btn cell-link truncate" onClick={(e) => { e.stopPropagation(); actions.open(f, [f]); }} aria-label={`Open ${f.name}`}>{f.name}</button></span></td>
                <td className="hide-sm muted truncate-cell">{locationOf(state, f)}</td>
                <td className="hide-sm"><span className="cell-owner"><Avatar user={owner} size={22} /><span className="truncate">{owner?.name}</span></span></td>
                {extra && <td className="hide-sm muted nowrap">{extra.cell(f)}</td>}
                <td className="num nowrap">{formatSize(f.size)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function StorageAnalytics() {
  const { state } = useDrive();
  const actions = useItemActions();
  const [staleDays, setStaleDays] = useState(30);
  const s = useStorageStats(state, staleDays);
  const staleSize = s.stale.reduce((a, f) => a + f.size, 0);
  const dupeWaste = s.dupes.reduce((a, g) => a + g[0].size * (g.length - 1), 0);
  const pct = (s.used / state.org.quota) * 100;

  return (
    <>
      <div className="stat-row">
        <StatTile label="Storage used" value={formatSize(s.used)} sub={`${pct < 0.1 ? '<0.1' : pct.toFixed(1)}% of ${formatSize(state.org.quota)}`} />
        <StatTile label="Files" value={s.count.toLocaleString()} sub={`${state.teams.length} team folders`} />
        <StatTile label="In Trash" value={formatSize(s.trash)} sub={state.org.policies.trashRetentionDays ? `Cleared after ${state.org.policies.trashRetentionDays} days` : 'Kept until emptied'} />
        <StatTile label="Older versions" value={formatSize(s.versions)} sub={`Up to ${state.org.policies.maxVersions || 25} kept per file`} />
      </div>

      <GrowthChart points={s.months} />

      <div className="chart-grid">
        <div className="chart-card">
          <div className="chart-title">Team folders</div>
          <div className="muted small chart-desc">Usage against each team's quota, fullest first</div>
          <MeterList rows={[...s.teams, { id: 'personal', name: 'Personal spaces', used: s.personalUsed, quota: state.org.userQuota * state.users.length }]} />
        </div>
        <div className="chart-card">
          <div className="chart-title">By file type</div>
          <div className="muted small chart-desc">Share of storage used, largest first</div>
          <RankedBars rows={s.types} total={s.used || 1} />
        </div>
      </div>

      <Section title="Largest files" desc="The ten biggest files across the organization.">
        <FileTable files={s.largest} state={state} actions={actions} extra={{ head: 'Modified', cell: (f) => formatDate(f.modifiedAt) }} />
      </Section>

      <Section title="Stale files" desc={`Not opened or changed in ${staleDays} days · ${s.stale.length} files, ${formatSize(staleSize)}`}
        actions={<select className="select select-sm" value={staleDays} onChange={(e) => setStaleDays(Number(e.target.value))} aria-label="Stale after">
          {[30, 90, 180, 365].map((d) => <option key={d} value={d}>{d === 365 ? '1 year' : `${d} days`}</option>)}
        </select>}>
        {s.stale.length
          ? <FileTable files={s.stale.slice(0, 15)} state={state} actions={actions} extra={{ head: 'Last activity', cell: (f) => formatDate(Math.max(f.modifiedAt || 0, f.lastOpened || 0)) }} />
          : <EmptyState compact icon={Clock3} title="No stale files" text={`Every file was opened or changed in the last ${staleDays} days.`} />}
      </Section>

      <Section title="Possible duplicates" desc={s.dupes.length ? `${s.dupes.length} group${s.dupes.length === 1 ? '' : 's'} with the same name and size · ${formatSize(dupeWaste)} could be freed` : 'Files with the same name and size in different places.'}>
        {s.dupes.length ? (
          <div className="dupe-list">
            {s.dupes.slice(0, 10).map((g) => (
              <div key={g[0].id} className="dupe-group">
                <div className="dupe-head"><Copy size={14} className="muted" /> <strong className="truncate">{g[0].name.replace(/ \(\d+\)(?=\.[^.]+$|$)/, '')}</strong> <span className="muted small">· {g.length} copies · {formatSize(g[0].size)} each</span></div>
                {g.map((f) => (
                  <button key={f.id} className="dupe-row" onClick={() => actions.showInFolder(f)}>
                    <FileIcon item={f} size={18} /><span className="truncate grow">{locationOf(state, f)} / {f.name}</span><span className="muted small">{formatDate(f.modifiedAt)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : <EmptyState compact icon={HardDrive} title="No duplicates found" />}
      </Section>
      <p className="muted small">Figures are calculated from the files currently in WorkDrive, across {state.teams.length} team folders and {state.users.length} personal spaces. Usage over time counts today's files by when they were added, so deleted files don't appear in earlier months.</p>
    </>
  );
}
