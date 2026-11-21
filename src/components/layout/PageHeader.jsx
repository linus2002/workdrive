import { Link } from 'react-router-dom';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { usePopover, MenuList } from '../common';
import { useNavigate } from 'react-router-dom';
import { useDropTarget } from '../files/dnd';
import { useT } from '../../i18n';

function Crumb({ c, last }) {
  const drop = useDropTarget(c.folderId ?? null, c.space || 'my', !!c.droppable && !last);
  // Long names are truncated with an ellipsis (CSS); the full name is in the tooltip.
  const title = typeof c.label === 'string' ? c.label : undefined;
  if (last) return <span className="crumb current" aria-current="page" title={title}>{c.label}</span>;
  return <Link to={c.to} className={`crumb ${drop.over ? 'drop-over' : ''}`} title={title} {...drop.props}>{c.label}</Link>;
}

/** crumbs: [{ label, to, folderId?, space?, droppable? }] */
export function Breadcrumbs({ crumbs }) {
  const pop = usePopover();
  const navigate = useNavigate();
  const t = useT();
  if (!crumbs?.length) return null;
  let display = crumbs;
  let hidden = [];
  if (crumbs.length > 4) {
    hidden = crumbs.slice(1, crumbs.length - 2);
    display = [crumbs[0], { ellipsis: true }, ...crumbs.slice(-2)];
  }
  return (
    <nav className="breadcrumbs" aria-label={t('Breadcrumb')}>
      {display.map((c, i) => (
        <span key={i} className="crumb-wrap">
          {i > 0 && <ChevronRight size={14} className="crumb-sep" />}
          {c.ellipsis ? (
            <span className="popover-anchor" ref={pop.ref}>
              <button className="crumb icon-crumb" onClick={pop.toggle} aria-label={t('Show hidden path')} aria-haspopup="menu" aria-expanded={pop.open}><MoreHorizontal size={16} /></button>
              {pop.open && <div className="popover pop-in align-left"><MenuList items={hidden.map((h) => ({ label: h.label, onClick: () => navigate(h.to) }))} onClose={() => pop.setOpen(false)} /></div>}
            </span>
          ) : <Crumb c={c} last={i === display.length - 1} />}
        </span>
      ))}
    </nav>
  );
}

export default function PageHeader({ title, icon, crumbs, actions, subtitle, children }) {
  return (
    <div className="page-header">
      {crumbs?.length > 1 && <Breadcrumbs crumbs={crumbs} />}
      <div className="page-title-row">
        <div className="page-title-wrap min0">
          {icon && <span className="page-icon">{icon}</span>}
          <div className="min0">
            <h1 className="page-title truncate" title={typeof title === 'string' ? title : undefined}>{title}</h1>
            {subtitle && <div className="page-subtitle">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
