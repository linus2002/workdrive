// External collaborators ("guests"): who they are, what they can reach, and when that access ends.
import { isExternalUser } from '../dlp/dlp';
import { isTrashedDeep, locationOf, shareActive } from '../store/selectors';
import { toDateInput } from '../utils/format';
import { csvCell } from '../utils/csv';

export const DAY = 86400000;
export const EXPIRING_DAYS = 7;

/** Guests are people outside the organization's domain, or anyone given the Guest role. */
export const isGuest = (state, u) => !!u && u.id !== state.meId && (u.role === 'Guest' || isExternalUser(state, u));

export const domainOf = (email) => String(email || '').split('@')[1]?.toLowerCase() || '';

/** Why the admin's sharing policy doesn't allow giving this address access (null when it does). */
export function sharingPolicyBlock(state, email) {
  const policies = state.org.policies;
  const domain = domainOf(email);
  if (domain === String(state.org.domain || '').toLowerCase()) return null;
  if (!policies.externalSharing) return 'External sharing is disabled by your administrator';
  const allowed = String(policies.allowedDomains || '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (allowed.length && !allowed.includes(domain)) return `Sharing with @${domain} is not allowed by policy`;
  return null;
}

/** 'active' | 'expiring' | 'expired' | 'open' (no expiry) */
export function accessState(expires, now = Date.now()) {
  if (!expires) return 'open';
  if (expires <= now) return 'expired';
  if (expires - now <= EXPIRING_DAYS * DAY) return 'expiring';
  return 'active';
}

export const ACCESS_STATE = {
  active: { label: 'Active', pill: 'pill-green' },
  expiring: { label: 'Expiring soon', pill: 'pill-amber' },
  expired: { label: 'Expired', pill: 'pill-red' },
  open: { label: 'No expiry', pill: 'pill-gray' },
};

/**
 * Every resource a user was given directly: shared files/folders and team-folder memberships.
 * [{ key, kind: 'item'|'team', id, name, item?, team?, role, sharedBy, sharedAt, expires, state, trashed, location }]
 */
export function resourcesOf(state, userId, now = Date.now()) {
  const out = [];
  for (const it of Object.values(state.items)) {
    const s = (it.sharedWith || []).find((x) => x.userId === userId);
    if (!s) continue;
    // Shares on team-folder items don't grant access (team membership does), so only personal spaces count.
    if (it.space && it.space.startsWith('t')) continue;
    out.push({
      key: `i:${it.id}`, kind: 'item', id: it.id, name: it.name, item: it, role: s.role, sharedBy: s.sharedBy, sharedAt: s.sharedAt,
      expires: s.expires || null, state: accessState(s.expires, now), trashed: isTrashedDeep(state.items, it.id), location: locationOf(state, it),
    });
  }
  for (const t of state.teams) {
    const m = t.members.find((x) => x.userId === userId);
    if (!m) continue;
    out.push({
      key: `t:${t.id}`, kind: 'team', id: t.id, name: t.name, team: t, role: m.role.toLowerCase(), sharedBy: m.addedBy || t.ownerId, sharedAt: m.addedAt || t.createdAt,
      expires: m.expires || null, state: accessState(m.expires, now), trashed: false, location: 'Team folder',
    });
  }
  return out.sort((a, b) => (a.expires || Infinity) - (b.expires || Infinity) || a.name.localeCompare(b.name));
}

/** Most recent thing we know a guest did (link visits by email, audit entries, sign-in). */
export function lastSeen(state, u) {
  let at = u.lastActive || 0;
  const email = u.email.toLowerCase();
  for (const it of Object.values(state.items)) for (const e of it.linkLog || []) if (e.who?.email?.toLowerCase() === email && e.at > at) at = e.at;
  for (const a of state.audit) if (a.actorId === u.id && a.at > at) at = a.at;
  return at || null;
}

/** One row per guest for the admin view. */
export function guestRows(state, now = Date.now()) {
  return state.users.filter((u) => isGuest(state, u)).map((u) => {
    const resources = resourcesOf(state, u.id, now);
    const live = resources.filter((r) => shareActive(r, now) && !r.trashed);
    const upcoming = live.filter((r) => r.expires).map((r) => r.expires).sort((a, b) => a - b);
    const overall = !resources.length ? 'none'
      : !live.length ? 'expired'
        : live.some((r) => !r.expires) ? 'open'
          : upcoming[0] - now <= EXPIRING_DAYS * DAY ? 'expiring' : 'active';
    return {
      user: u, domain: domainOf(u.email), resources, live: live.length, nextExpiry: upcoming[0] || null,
      expiring: live.filter((r) => r.state === 'expiring').length, expired: resources.filter((r) => r.state === 'expired').length,
      noExpiry: live.filter((r) => !r.expires).length, state: overall, lastSeen: lastSeen(state, u),
    };
  });
}

/** Default expiration for new guest access, from the admin policy (0 = never). */
export const defaultGuestExpiry = (state, now = Date.now()) => {
  const days = state.org.policies.guestAccessDays ?? 30;
  return days ? new Date(now + days * DAY).setHours(23, 59, 59, 0) : null;
};

/** Spreadsheet of every guest's access, for audits. */
export function guestsCsv(state, rows) {
  const q = csvCell; // formula-safe (see utils/csv)
  const lines = [['Guest', 'Email', 'Domain', 'Account', 'Resource', 'Type', 'Location', 'Access', 'Shared by', 'Shared on', 'Expires', 'Status']];
  for (const r of rows) {
    if (!r.resources.length) lines.push([r.user.name, r.user.email, r.domain, r.user.status, '', '', '', '', '', '', '', 'No access']);
    for (const x of r.resources) {
      lines.push([
        r.user.name, r.user.email, r.domain, r.user.status, x.name, x.kind === 'team' ? 'Team folder' : x.item.type, x.location, x.role,
        state.users.find((u) => u.id === x.sharedBy)?.name || '', x.sharedAt ? toDateInput(x.sharedAt) : '',
        x.expires ? toDateInput(x.expires) : 'Never', x.trashed ? 'In trash' : ACCESS_STATE[x.state].label,
      ]);
    }
  }
  return lines.map((l) => l.map(q).join(',')).join('\n');
}
