import { useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { TEMPLATES } from '../data/mockData';
import { useUI } from '../store/UIContext';
import PageHeader from '../components/layout/PageHeader';
import { FileGlyph } from '../components/common';

const CATS = ['All', 'Documents', 'Spreadsheets', 'Presentations'];

export function TemplatePreview({ t }) {
  return (
    <div className={`tpl-preview tpl-${t.ext}`}>
      {t.ext === 'xlsx' ? (
        <div className="tpl-sheet">
          {(t.sheet || []).slice(0, 5).map((r, i) => (
            <div key={i} className={`tpl-sheet-row ${i === 0 ? 'head' : ''}`}>{r.slice(0, 4).map((c, j) => <span key={j}>{c}</span>)}</div>
          ))}
        </div>
      ) : t.ext === 'pptx' ? (
        <div className="tpl-slide"><strong>{t.slides?.[0]?.title}</strong><span>{t.slides?.[0]?.body}</span></div>
      ) : (
        <div className="tpl-doc"><strong>{t.content.split('\n')[0]}</strong>{t.content.split('\n').slice(1, 9).filter(Boolean).map((l, i) => <span key={i}>{l}</span>)}</div>
      )}
    </div>
  );
}

export default function TemplatesView() {
  const { openDialog } = useUI();
  const [cat, setCat] = useState('All');
  const list = TEMPLATES.filter((t) => cat === 'All' || t.category === cat);
  return (
    <div className="page">
      <PageHeader title="Templates" subtitle="Start new documents, spreadsheets and presentations from a ready-made layout.">
        <div className="tabs" role="tablist">
          {CATS.map((c) => <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c}</button>)}
        </div>
      </PageHeader>
      <div className="page-scroll">
        <div className="tpl-grid">
          <button className="tpl-card blank" onClick={() => openDialog('createDoc', { kind: 'docx' })}>
            <div className="tpl-preview blank"><LayoutTemplate size={32} strokeWidth={1.4} /></div>
            <div className="tpl-info"><div className="tpl-name">Blank document</div><div className="tpl-desc">Start from scratch</div></div>
          </button>
          {list.map((t) => (
            <button key={t.id} className="tpl-card" onClick={() => openDialog('createDoc', { kind: t.ext, template: t })}>
              <TemplatePreview t={t} />
              <div className="tpl-info">
                <FileGlyph ext={t.ext} size={22} />
                <div className="min0"><div className="tpl-name">{t.name}</div><div className="tpl-desc">{t.description}</div></div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
