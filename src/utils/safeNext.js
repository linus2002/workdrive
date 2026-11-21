/** Only allow in-app paths as the post-login destination. */
export function safeNext(next) {
  // Browsers treat "\" like "/" and ignore tabs/newlines, so "/\evil.com" or "/<tab>/evil.com" would leave the app.
  if (!next || !next.startsWith('/') || /[\\\u0000-\u001f]/.test(next) || next.startsWith('//') || next.startsWith('/login')) return '/folders';
  try {
    const u = new URL(next, window.location.origin);
    if (u.origin !== window.location.origin) return '/folders';
    return u.pathname + u.search + u.hash;
  } catch { return '/folders'; }
}
