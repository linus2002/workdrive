import { useId, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle, Users, CornerUpRight } from 'lucide-react';
import { getFileType, genThumb } from '../../utils/fileTypes';
import { initials, escapeRegExp, toDateInput, fromDateInput } from '../../utils/format';
import { blobRegistry, useDrive } from '../../store/DriveStore';
import { shortcutTarget } from '../../store/selectors';
import { useUI, useDialogLayer } from '../../store/UIContext';

/* ---------------- Avatar ---------------- */
// White initials need a background dark enough for 4.5:1 contrast; light user colours are darkened.
const avatarCache = new Map();
function lum(r, g, b) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function avatarBg(color) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return color || '#64748B';
  if (avatarCache.has(color)) return avatarCache.get(color);
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let k = 0; k < 12 && 1.05 / (lum(r, g, b) + 0.05) < 4.6; k++) { r *= 0.9; g *= 0.9; b *= 0.9; }
  const out = `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
  avatarCache.set(color, out);
  return out;
}

export function Avatar({ user, size = 28, title }) {
  if (!user) return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: '#64748B' }}>?</span>;
  return (
    <span className="avatar" title={title ?? user.name} style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.33)), background: avatarBg(user.color) }}>
      {initials(user.name)}
    </span>
  );
}

export function AvatarStack({ users, max = 4, size = 24 }) {
  const shown = users.slice(0, max);
  return (
    <span className="avatar-stack">
      {shown.map((u) => <Avatar key={u.id} user={u} size={size} />)}
      {users.length > max && <span className="avatar avatar-more" style={{ width: size, height: size, fontSize: size * 0.38 }}>+{users.length - max}</span>}
    </span>
  );
}

/* ---------------- File / folder icons ---------------- */
export function FolderGlyph({ size = 32, color = '#F5B840', shared = false, team = false }) {
  return (
    <span className="folder-glyph" style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 32" width={size} height={size * 0.8} aria-hidden="true">
        <path d="M2 5a3 3 0 0 1 3-3h9.2a3 3 0 0 1 2.3 1.1L19 6h16a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill={color} />
        <path d="M2 10a3 3 0 0 1 3-3h30a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill={color} style={{ filter: 'brightness(1.12)' }} />
      </svg>
      {(shared || team) && (
        <span className="folder-badge" role="img" aria-label={team ? 'Team folder' : 'Shared folder'} title={team ? 'Team folder' : 'Shared folder'}><Users size={Math.max(8, size * 0.28)} strokeWidth={2.5} aria-hidden="true" /></span>
      )}
    </span>
  );
}

export function FileGlyph({ ext, size = 32 }) {
  const t = getFileType(ext);
  return (
    <svg className="file-glyph" viewBox="0 0 32 40" width={size * 0.8} height={size} aria-hidden="true">
      <path d="M4 1h17l10 10v25a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3z" fill="var(--file-bg)" stroke="var(--file-stroke)" />
      <path d="M21 1v7a3 3 0 0 0 3 3h7" fill="none" stroke="var(--file-stroke)" />
      <rect x="0" y="22" width={t.label.length > 3 ? 26 : 22} height="11" rx="2" fill={t.color} />
      <text x={t.label.length > 3 ? 13 : 11} y="30.2" textAnchor="middle" fontSize="7.4" fontWeight="700" fill="#fff" fontFamily="Poppins, sans-serif">{t.label}</text>
    </svg>
  );
}

export function thumbUrl(item) {
  if (!item || item.type !== 'file') return null;
  const cat = getFileType(item.ext).category;
  if (cat !== 'image') return null;
  if (item.dataUrl) return item.dataUrl;
  const reg = blobRegistry.get(item.id);
  if (reg) return reg.url;
  if (item.thumb?.startsWith('gen:')) return genThumb(item.thumb.slice(4));
  return null;
}

/** A shortcut shows its target's icon with a small arrow; a broken one shows a faded icon. */
function ShortcutIcon({ item, size, thumbs }) {
  const { state } = useDrive();
  const target = shortcutTarget(state, item);
  return (
    <span className={`shortcut-icon ${target ? '' : 'broken'}`} style={{ width: size, height: size }}>
      {target ? <FileIcon item={target} size={size} thumbs={thumbs} /> : <FileGlyph ext="" size={size} />}
      <span className="shortcut-badge" style={{ width: Math.max(12, size * 0.42), height: Math.max(12, size * 0.42) }}><CornerUpRight size={Math.max(8, size * 0.3)} strokeWidth={2.6} /></span>
    </span>
  );
}

export function FileIcon({ item, size = 32, thumbs = false, teamColor }) {
  if (item.type === 'shortcut') return <ShortcutIcon item={item} size={size} thumbs={thumbs} />;
  if (item.type === 'folder') {
    return <FolderGlyph size={size} shared={item.sharedWith?.length > 0} color={item.color || teamColor || '#F5B840'} />;
  }
  const url = thumbs ? thumbUrl(item) : null;
  if (url) return <img className="file-thumb-sm" src={url} alt="" style={{ width: size, height: size }} draggable={false} />;
  return <FileGlyph ext={item.ext} size={size} />;
}

/* ---------------- Highlight ---------------- */
export function Highlight({ text, query }) {
  if (!query?.trim()) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(query.trim())})`, 'ig'));
  return parts.map((p, i) => (p.toLowerCase() === query.trim().toLowerCase() ? <mark key={i}>{p}</mark> : p));
}

/* ---------------- Modal ---------------- */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const openModals = []; // mount order = stacking order (also covers modals rendered outside DialogHost)
const textValue = (el) => (el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : el.value);

/**
 * dismissible=false: Escape and backdrop clicks don't close it (only the buttons do).
 * A backdrop click is also ignored when it started inside the dialog (e.g. selecting text and releasing outside)
 * or when a text field was changed since the dialog opened, so typed input isn't lost by a stray click.
 */
export function Modal({ title, subtitle, onClose, children, footer, width = 480, className = '', icon, dismissible = true }) {
  const titleId = useId();
  const ref = useRef(null);
  const backdropRef = useRef(null);
  const layer = useDialogLayer();
  const openedAt = useRef(Date.now());
  const downOnBackdrop = useRef(false);
  const snapshot = useRef(null);
  const token = useRef({});
  // Keep the latest callbacks/flags in refs so a parent re-render (new onClose identity) never re-runs the focus logic.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;
  const layerTop = useRef(layer.top);
  layerTop.current = layer.top;
  const isTop = () => layerTop.current && openModals[openModals.length - 1] === token.current;

  const takeSnapshot = () => {
    const m = new Map();
    ref.current?.querySelectorAll('input, textarea').forEach((el) => m.set(el, textValue(el)));
    snapshot.current = m;
  };
  const isDirty = () => {
    const snap = snapshot.current;
    if (!snap || !ref.current) return false;
    return [...ref.current.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea')]
      .some((el) => (snap.has(el) ? snap.get(el) !== textValue(el) : el.value.trim() !== '' && el.value !== el.defaultValue));
  };

  const onBackdropDown = (e) => { downOnBackdrop.current = e.target === e.currentTarget; };
  const onBackdropClick = (e) => {
    const started = downOnBackdrop.current;
    downOnBackdrop.current = false;
    if (!started || e.target !== e.currentTarget) return; // press started inside the dialog
    if (!isTop() || !dismissRef.current) return;
    if (e.detail > 1 || Date.now() - openedAt.current < 400) return; // tail of the click that opened it
    if (isDirty()) { ref.current?.classList.remove('modal-nudge'); void ref.current?.offsetWidth; ref.current?.classList.add('modal-nudge'); return; }
    onCloseRef.current?.();
  };

  useEffect(() => {
    const me = token.current;
    openModals.push(me);
    const prev = document.activeElement;
    const onKey = (e) => {
      if (!isTop()) return;
      if (e.key === 'Escape') {
        if (document.querySelector('[data-popup-open]') || document.querySelector('.context-menu') || ref.current?.querySelector('.popover')) return;
        e.stopPropagation();
        if (dismissRef.current) onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const active = document.activeElement;
      if (active && !ref.current.contains(active) && active.closest?.('.context-menu, .fsel-list, .popover')) return; // a popup of this dialog
      const els = [...ref.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === active);
      if (!els.length) { e.preventDefault(); ref.current.focus(); return; }
      const first = els[0];
      const last = els[els.length - 1];
      const inside = ref.current.contains(active);
      if (e.shiftKey && (!inside || active === first || active === ref.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    const t = setTimeout(() => {
      takeSnapshot();
      if (!isTop() || !ref.current) return;
      if (ref.current.contains(document.activeElement)) return; // something inside already took focus
      const el = ref.current.querySelector('[data-autofocus], input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button.btn-primary:not([disabled])');
      (el || ref.current).focus();
    }, 30);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      clearTimeout(t);
      const i = openModals.indexOf(me);
      if (i >= 0) openModals.splice(i, 1);
      // Return focus to whatever opened the dialog (if it's still on the page).
      // Deferred: the dialog underneath (if any) is still inert until its own effect runs.
      setTimeout(() => { if (prev && prev !== document.body && document.contains(prev)) prev.focus?.({ preventScroll: true }); }, 0);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A dialog covered by another one (e.g. a confirmation) is inert until it's on top again.
  useEffect(() => {
    const el = backdropRef.current;
    if (!el) return;
    el.inert = !layer.top;
    if (layer.top) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', 'true');
  }, [layer.top]);

  return createPortal(
    <div className={`modal-backdrop ${layer.top ? '' : 'modal-under'}`} onMouseDown={onBackdropDown} onClick={onBackdropClick} ref={backdropRef}>
      <div className={`modal ${className}`} style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="modal-header">
          {icon && <span className="modal-icon">{icon}</span>}
          <div className="modal-titles">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Popover hook ---------------- */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Escape inside the popover hands focus back to its trigger (the first button of the anchor).
      const inside = ref.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) ref.current?.querySelector('button')?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return { open, setOpen, toggle, ref };
}

/* ---------------- Menu list ---------------- */
/**
 * items: { label, icon?, onClick, disabled?, hint?, danger?, active?, check?, shortcut? } | { divider } | { header }.
 * Disabled entries stay focusable (aria-disabled) so their `hint` (why it's unavailable) can be read and seen.
 */
export function MenuList({ items, onClose }) {
  const ref = useRef(null);
  const navBtns = () => [...(ref.current?.querySelectorAll('button.menu-item') || [])];
  useEffect(() => {
    const first = navBtns().find((b) => b.getAttribute('aria-disabled') !== 'true') || navBtns()[0];
    first?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (e) => {
    const btns = navBtns();
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); btns[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1].focus(); }
    else if (e.key === 'Tab') { onClose?.(); }
  };
  const cleaned = items.filter(Boolean).filter((it, i, arr) => !(it.divider && (i === 0 || arr[i - 1]?.divider || i === arr.length - 1)));
  return (
    <div className="menu" role="menu" ref={ref} onKeyDown={onKeyDown}>
      {cleaned.map((it, i) => it.divider ? <div key={i} className="menu-divider" role="separator" /> : it.header ? (
        <div key={i} className="menu-header" role="presentation">{it.header}</div>
      ) : (
        <button key={i} type="button" role={it.check !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.check !== undefined ? !!it.check : undefined}
          className={`menu-item ${it.danger ? 'danger' : ''} ${it.active ? 'active' : ''} ${it.disabled ? 'is-disabled' : ''} ${it.hint ? 'has-hint' : ''}`}
          aria-disabled={it.disabled ? 'true' : undefined} title={it.hint || undefined}
          aria-describedby={it.hint ? `mh-${i}` : undefined}
          onClick={(e) => { e.stopPropagation(); if (it.disabled) return; onClose?.(); it.onClick?.(); }}>
          {it.icon && <it.icon size={16} className="menu-icon" />}
          <span className="menu-label">
            {it.label}
            {it.hint && <span className="menu-hint" id={`mh-${i}`}>{it.hint}</span>}
          </span>
          {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
          {it.check && <span className="menu-check" aria-hidden="true">✓</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Context menu host ---------------- */
export function ContextMenuHost() {
  const { menu, hideMenu } = useUI();
  const ref = useRef(null);
  const trigger = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    // Remember what had focus (the row / ⋮ button) so Escape can return there.
    if (!ref.current.contains(document.activeElement)) trigger.current = document.activeElement;
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 8);
    const fitsBelow = menu.y + r.height <= window.innerHeight - 8;
    const y = fitsBelow ? menu.y : Math.max(8, Math.min(menu.y - r.height, window.innerHeight - r.height - 8));
    setPos({ x: Math.max(8, x), y });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) hideMenu(); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      hideMenu();
      const t = trigger.current;
      if (t && t !== document.body && document.contains(t)) t.focus?.({ preventScroll: true });
    };
    // Close when the *user* scrolls (wheel/touch) outside the menu. Plain 'scroll' events also fire when a panel
    // re-renders and the browser adjusts its scroll position, which used to close the menu the moment it opened.
    const userScroll = (e) => { if (ref.current && !ref.current.contains(e.target)) hideMenu(); };
    const t = setTimeout(() => { document.addEventListener('mousedown', close); document.addEventListener('contextmenu', close); }, 0);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', hideMenu);
    window.addEventListener('wheel', userScroll, { capture: true, passive: true });
    window.addEventListener('touchmove', userScroll, { capture: true, passive: true });
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', hideMenu);
      window.removeEventListener('wheel', userScroll, { capture: true });
      window.removeEventListener('touchmove', userScroll, { capture: true });
    };
  }, [menu, hideMenu]);
  if (!menu) return null;
  return createPortal(
    <div className="context-menu pop-in" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={menu.items} onClose={hideMenu} />
    </div>,
    document.body,
  );
}

/* ---------------- Toasts ---------------- */
const TOAST_ICON = { success: CheckCircle2, error: AlertCircle, info: Info, warning: AlertTriangle };
export function Toasts() {
  const { toasts, dismissToast, pauseToast, resumeToast } = useUI();
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.type] || Info;
        const urgent = t.type === 'error';
        return (
          // Hover or keyboard focus keeps a toast on screen (so its Undo can be reached); leaving resumes the timer.
          <div key={t.id} className={`toast toast-${t.type}`} role={urgent ? 'alert' : 'status'} aria-live={urgent ? 'assertive' : 'polite'} aria-atomic="true"
            onMouseEnter={() => pauseToast(t.id)} onMouseLeave={() => resumeToast(t.id)}
            onFocus={() => pauseToast(t.id)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) resumeToast(t.id); }}>
            <Icon size={18} className="toast-icon" aria-hidden="true" />
            <span className="toast-msg">{t.message}</span>
            {t.action && <button type="button" className="toast-action" onClick={() => { t.action.onClick(); dismissToast(t.id); }}>{t.action.label}</button>}
            <button type="button" className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Misc ---------------- */
export function EmptyState({ icon: Icon, title, text, action, compact }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      {Icon && <div className="empty-icon"><Icon size={compact ? 28 : 40} strokeWidth={1.4} /></div>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

/**
 * A date field that saves as you go (no Save button), but only a complete date from today on. Browsers report
 * every digit while a year is typed (0002, 0020, 0202, 2027): those partial, past dates are never saved.
 * value: timestamp | null; onCommit(timestamp) runs for each valid date picked.
 */
export function CommitDateInput({ value, onCommit, className = 'input input-date', ...rest }) {
  const [text, setText] = useState(toDateInput(value));
  const [error, setError] = useState('');
  useEffect(() => { setText(toDateInput(value)); }, [value]);
  const valid = (str) => { const ts = fromDateInput(str); return ts && ts >= Date.now() ? ts : null; };
  return (
    <span className="date-commit">
      <input type="date" className={className} value={text} min={toDateInput(Date.now())} aria-invalid={!!error || undefined}
        onChange={(e) => { setText(e.target.value); setError(''); const ts = valid(e.target.value); if (ts && ts !== value) onCommit(ts); }}
        onBlur={() => { if (text && !valid(text)) { setError('Choose today or a later date'); setText(toDateInput(value)); } }} {...rest} />
      {error && <span className="field-error" role="alert">{error}</span>}
    </span>
  );
}

export function Switch({ checked, onChange, label, id, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} id={id} disabled={disabled}
      className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  );
}

export function SkeletonRows({ rows = 8, grid = false }) {
  if (grid) {
    return (
      <div className="file-grid">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="file-card skeleton-card"><div className="skel skel-thumb" /><div className="skel skel-line" /><div className="skel skel-line short" /></div>
        ))}
      </div>
    );
  }
  return (
    <div className="skeleton-list">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skel skel-box" /><div className="skel skel-line" style={{ width: `${30 + ((i * 17) % 30)}%` }} />
          <div className="skel skel-line short" /><div className="skel skel-line short" />
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ value, tone, label = 'Progress' }) {
  return (
    <div className={`progress ${tone || ''}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function RoleSelect({ value, onChange, roles = ['viewer', 'commenter', 'editor'], small, disabled, label = 'Access level' }) {
  const labels = { viewer: 'Viewer', commenter: 'Commenter', editor: 'Editor', Admin: 'Admin', Organizer: 'Organizer', Editor: 'Editor', Viewer: 'Viewer', Member: 'Member' };
  return (
    <select className={`select ${small ? 'select-sm' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label}>
      {roles.map((r) => <option key={r} value={r}>{labels[r] || r}</option>)}
    </select>
  );
}
