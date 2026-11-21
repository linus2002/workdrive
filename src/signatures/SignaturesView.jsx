import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PenTool, Search } from 'lucide-react';
import { useDrive, useMe } from '../store/DriveStore';
import PageHeader from '../components/layout/PageHeader';
import { EmptyState, Toasts } from '../components/common';
import { displayStatus, isOpen, signWaitingForMe } from './signing';
import { SignRequestCard } from './SignUI';
import { SignDocument } from './SignDocument';

const TABS = [
  ['waiting', 'Waiting for me'],
  ['sent', 'Sent by me'],
  ['completed', 'Completed'],
  ['closed', 'Declined & expired'],
  ['all', 'All'],
];

export default function SignaturesView() {
  const { state } = useDrive();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const all = (state.signRequests || []).filter((r) => state.items[r.itemId] || r.status === 'signed');
  const involved = all.filter((r) => r.createdBy === state.meId || r.signers.some((s) => s.userId === state.meId));
  const waiting = signWaitingForMe(state);
  const sent = involved.filter((r) => r.createdBy === state.meId && isOpen(r) && displayStatus(r) !== 'expired');
  const completed = involved.filter((r) => r.status === 'signed').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const closed = involved.filter((r) => ['declined', 'cancelled', 'expired'].includes(displayStatus(r)));
  const lists = { waiting, sent, completed, closed, all: involved };
  // An explicit ?tab= always wins (even an empty "Waiting for me"); only with no tab do we pick one.
  const tab = lists[params.get('tab')] ? params.get('tab') : (waiting.length ? 'waiting' : 'sent');
  const list = lists[tab]
    .filter((r) => !q || `${r.title} ${state.items[r.itemId]?.name || ''} ${r.signers.map((s) => `${s.name} ${s.email}`).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (tab === 'completed' ? 0 : b.createdAt - a.createdAt));
  const counts = { waiting: waiting.length, sent: sent.length };

  return (
    <div className="page">
      <PageHeader title="Signatures" subtitle={waiting.length ? `${waiting.length} document${waiting.length === 1 ? '' : 's'} waiting for your signature` : 'Send PDFs for signing and track every request'}
        actions={<div className="input-icon search-sm"><Search size={15} /><input className="input" placeholder="Search requests" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search signature requests" /></div>} />
      <div className="page-scroll">
        <div className="tabs page-tabs" role="tablist" aria-label="Signature requests">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setParams({ tab: id }, { replace: true })}>
              {label}{counts[id] ? <span className="tab-count">{counts[id]}</span> : null}
            </button>
          ))}
        </div>
        {!list.length ? (
          <EmptyState icon={PenTool}
            title={q ? 'No matching requests' : tab === 'waiting' ? 'Nothing to sign' : tab === 'sent' ? 'No open requests' : tab === 'completed' ? 'No completed documents yet' : 'Nothing here'}
            text={tab === 'sent' || tab === 'waiting' ? 'To send a PDF for signing, open its ⋮ menu (or right-click it) and choose “Request signature”, or use “Request signature” in its details panel.' : ''} />
        ) : (
          <div className="approval-list">{list.map((r) => <SignRequestCard key={r.id} r={r} />)}</div>
        )}
      </div>
    </div>
  );
}

/** /sign/:requestId/:signerId — the page a signer opens from their link (works signed out). */
export function PublicSignView() {
  const { requestId, signerId } = useParams();
  const { state } = useDrive();
  const me = useMe();
  return (
    <div className="public-sign">
      <SignDocument requestId={requestId} signerId={signerId} />
      <div className="public-sign-foot muted small">
        {state.org.name} WorkDrive e-signature{me && !state.signedOut ? ` · You're signed in as ${me.name}` : ''}
      </div>
      <Toasts />
    </div>
  );
}
