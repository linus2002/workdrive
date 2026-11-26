import { useState } from 'react';
import { LifeBuoy, Keyboard, BookOpen, MessageCircle, ChevronDown } from 'lucide-react';
import { useUI } from '../../store/UIContext';
import { useDrive, useMe } from '../../store/DriveStore';
import { Modal } from '../common';
import { SHORTCUT_GROUPS } from './ProductivityDialogs';

// The most useful ones; the full list lives in the shortcuts sheet (press ?).
const SHORTCUTS = SHORTCUT_GROUPS.flatMap(([, rows]) => rows).filter(([k]) => ['?', '/', 'N', 'U', 'G then M', 'Enter', 'Space', 'F2', 'Delete', 'I', 'Ctrl + A', 'Esc'].includes(k)).slice(0, 12);
const FAQ = [
  ['How do I share a folder with my team?', 'Right-click the folder (or use its ⋮ menu) and choose Share, or use a team folder so everyone on the team gets access automatically.'],
  ['What happens to deleted files?', 'They move to Trash and can be restored until they are removed permanently or the retention period ends.'],
  ['Can I upload an entire folder?', 'Yes — use New → Upload folder, or drag a folder into the Upload dialog.'],
  ['Who can see my files in My Folders?', 'Only you, unless you share them. Shared items show a people icon.'],
];

export function HelpDialog({ onClose }) {
  const { toast, pushDialog } = useUI();
  const [tab, setTab] = useState('shortcuts');
  const [open, setOpen] = useState(0);
  const [msg, setMsg] = useState('');
  const [topic, setTopic] = useState('Uploading & syncing');
  const { state } = useDrive();
  const me = useMe();
  // Requests go to the support address the admin set (Admin Console → Organization), through your email app.
  const supportEmail = state.org.supportEmail || `it@${state.org.domain}`;
  const sendRequest = (e) => {
    e.preventDefault();
    const body = `${msg.trim()}

—
From: ${me?.name || ''} <${me?.email || ''}>
Page: ${window.location.pathname}
Browser: ${navigator.userAgent}`;
    window.location.href = `mailto:${supportEmail}?subject=${encodeURIComponent(`[WorkDrive] ${topic}`)}&body=${encodeURIComponent(body)}`;
    toast(`Your email app is opening with the request to ${supportEmail}. Send it from there.`, { type: 'info', duration: 7000 });
    setMsg('');
    onClose();
  };
  return (
    <Modal title="Help & support" onClose={onClose} width={600} icon={<LifeBuoy size={20} />}>
      <div className="tabs" role="tablist" aria-label="Help sections" onKeyDown={(e) => {
        const order = ['shortcuts', 'faq', 'contact'];
        const i = order.indexOf(tab);
        const next = e.key === 'ArrowRight' ? order[(i + 1) % 3] : e.key === 'ArrowLeft' ? order[(i + 2) % 3] : null;
        if (!next) return;
        e.preventDefault();
        setTab(next);
        setTimeout(() => document.getElementById(`help-tab-${next}`)?.focus(), 0);
      }}>
        <button role="tab" id="help-tab-shortcuts" aria-selected={tab === 'shortcuts'} aria-controls="help-panel" tabIndex={tab === 'shortcuts' ? 0 : -1} className={tab === 'shortcuts' ? 'active' : ''} onClick={() => setTab('shortcuts')}><Keyboard size={14} /> Shortcuts</button>
        <button role="tab" id="help-tab-faq" aria-selected={tab === 'faq'} aria-controls="help-panel" tabIndex={tab === 'faq' ? 0 : -1} className={tab === 'faq' ? 'active' : ''} onClick={() => setTab('faq')}><BookOpen size={14} /> FAQ</button>
        <button role="tab" id="help-tab-contact" aria-selected={tab === 'contact'} aria-controls="help-panel" tabIndex={tab === 'contact' ? 0 : -1} className={tab === 'contact' ? 'active' : ''} onClick={() => setTab('contact')}><MessageCircle size={14} /> Contact support</button>
      </div>
      <div role="tabpanel" id="help-panel" aria-labelledby={`help-tab-${tab}`}>
      {tab === 'shortcuts' && (
        <>
          <div className="shortcut-grid">
            {SHORTCUTS.map(([k, d]) => <div key={k} className="shortcut"><kbd>{k}</kbd><span>{d}</span></div>)}
          </div>
          <div className="btn-row end"><button className="btn btn-secondary btn-sm" onClick={() => pushDialog('shortcuts')}><Keyboard size={14} /> All shortcuts</button></div>
        </>
      )}
      {tab === 'faq' && (
        <div className="faq">
          {FAQ.map(([q, a], i) => (
            <div key={i} className={`faq-item ${open === i ? 'open' : ''}`}>
              <button onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>{q}<ChevronDown size={16} /></button>
              {open === i && <p>{a}</p>}
            </div>
          ))}
        </div>
      )}
      {tab === 'contact' && (
        <form className="form" onSubmit={sendRequest}>
          <p className="muted small">Your request goes to <strong>{supportEmail}</strong> from your email app.</p>
          <label className="field"><span className="field-label">Topic</span>
            <select className="select full" value={topic} onChange={(e) => setTopic(e.target.value)}><option>Uploading & syncing</option><option>Sharing & permissions</option><option>Sign-in & account</option><option>Something else</option></select>
          </label>
          <label className="field"><span className="field-label">How can we help?</span>
            <textarea className="input textarea" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Describe the issue…" required />
          </label>
          <div className="btn-row end">
            {msg.trim().length < 5 && <span className="muted small grow" id="help-send-hint">Write at least 5 characters</span>}
            <button className="btn btn-primary" disabled={msg.trim().length < 5} aria-describedby={msg.trim().length < 5 ? 'help-send-hint' : undefined}>Open in email app</button>
          </div>
        </form>
      )}
      </div>
    </Modal>
  );
}

