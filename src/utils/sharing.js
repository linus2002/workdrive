// Helpers for shared links and file requests.
import { hasSecret } from '../data/storage/secrets';

/** Effective state of an item's shared link at this moment. */
/**
 * reason when not ok: 'off' | 'public-off' (admin turned off public links) | 'expired'
 * | 'needs-password' (policy requires a password on public links and none is set yet).
 */
export function linkStatus(state, item, now = Date.now()) {
  const link = item?.link;
  if (!link?.enabled) return { ok: false, reason: 'off' };
  const policies = state.org.policies;
  const isPublic = link.access === 'anyone';
  if (isPublic && !policies.publicLinks) return { ok: false, reason: 'public-off', link };
  if (link.expires && link.expires < now) return { ok: false, reason: 'expired', link };
  const pwdPolicy = isPublic && !!policies.linkPasswordRequired;
  if (pwdPolicy && !hasSecret(link)) return { ok: false, reason: 'needs-password', link };
  const limitReached = !!link.maxDownloads && (link.downloads || 0) >= link.maxDownloads;
  const remaining = link.maxDownloads ? Math.max(0, link.maxDownloads - (link.downloads || 0)) : null;
  const watermark = !!link.watermark || (isPublic && !!policies.watermarkPublicLinks);
  const canDownload = link.allowDownload !== false && !limitReached && !(policies.downloadRestriction && link.role === 'viewer');
  // Visitors must enter the password when one is set (always, for public links under the password policy).
  const passwordProtected = hasSecret(link) && (!!link.password || pwdPolicy);
  return { ok: true, link, limitReached, remaining, watermark, canDownload, passwordProtected };
}

/** 'active' | 'expired' | 'closed'. Pass `state` so an admin turning off file requests closes every link. */
export function requestStatus(req, now = Date.now(), state = null) {
  if (!req.enabled) return 'closed';
  if (state && state.org?.policies && state.org.policies.fileRequests === false) return 'closed';
  if (req.expires && req.expires < now) return 'expired';
  return 'active';
}

export const requestUrl = (id) => `${window.location.origin}/request/${id}`;
export const linkUrl = (id) => `${window.location.origin}/link/${id}`;

/** "Chrome on Windows"-style label for the current browser. */
export function deviceLabel(ua = navigator.userAgent) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

/** A stable placeholder IP for this browser session (there is no server to see the real one). */
export function sessionIp() {
  try {
    let ip = sessionStorage.getItem('workvault-drive:ip');
    if (!ip) { ip = `198.51.100.${10 + Math.floor(Math.random() * 230)}`; sessionStorage.setItem('workvault-drive:ip', ip); }
    return ip;
  } catch { return '198.51.100.1'; }
}

export const LINK_EVENTS = {
  viewed: { label: 'Viewed', tone: 'blue' },
  downloaded: { label: 'Downloaded', tone: 'green' },
  'password-failed': { label: 'Wrong password', tone: 'amber' },
  'blocked-expired': { label: 'Blocked · link expired', tone: 'gray' },
  'blocked-limit': { label: 'Blocked · download limit', tone: 'gray' },
  'blocked-dlp': { label: 'Blocked · sensitive data policy', tone: 'amber' },
};
