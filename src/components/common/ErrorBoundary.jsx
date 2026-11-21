import { Component, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RotateCcw, FolderOpen, X } from 'lucide-react';
import { Modal } from './index';

/** A failed lazy chunk can't be retried in place (React caches the rejected import): reload the page instead. */
const isChunkError = (error) => /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(String(error?.message || error));

function Details({ error }) {
  const text = String(error?.message || error || 'Unknown error');
  return (
    <details className="eb-details">
      <summary>Technical details</summary>
      <pre>{text}{error?.stack && import.meta.env?.DEV ? `\n\n${String(error.stack).split('\n').slice(1, 8).join('\n')}` : ''}</pre>
    </details>
  );
}

/** Full-area fallback for a screen (inside the app frame), a public page, or the whole app. */
function ScreenFallback({ error, reset, home = true, hard = false, title = 'Something went wrong on this screen' }) {
  const navigate = useNavigate();
  const reload = () => { if (hard || isChunkError(error)) window.location.reload(); else reset(); };
  const goHome = () => {
    if (hard) { window.location.assign('/folders'); return; }
    navigate('/folders');
    reset(); // already on /folders: the path doesn't change, so clear the error ourselves
  };
  return (
    <div className={`eb-screen ${hard ? 'eb-screen-full' : ''}`} role="alert">
      <div className="eb-card">
        <span className="eb-icon" aria-hidden="true"><AlertTriangle size={28} /></span>
        <h2>{title}</h2>
        <p className="muted">The rest of the app is still working. You can try this screen again or go somewhere else — nothing you saved has been lost.</p>
        <div className="eb-actions">
          <button type="button" className="btn btn-primary" onClick={reload}><RotateCcw size={15} /> Reload screen</button>
          {home && <button type="button" className="btn" onClick={goHome}><FolderOpen size={15} /> Go to My Folders</button>}
        </div>
        <Details error={error} />
      </div>
    </div>
  );
}

/** Overlay shown instead of a file preview that failed to render. */
function PreviewFallback({ error, reset, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal')) { e.stopPropagation(); reset(); onClose?.(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [reset, onClose]);
  return (
    <div className="eb-preview" role="alertdialog" aria-modal="true" aria-labelledby="eb-preview-title">
      <div className="eb-card">
        <span className="eb-icon" aria-hidden="true"><AlertTriangle size={28} /></span>
        <h2 id="eb-preview-title">This file couldn’t be shown</h2>
        <p className="muted">Something went wrong while opening the preview. The file itself is unchanged.</p>
        <div className="eb-actions">
          <button type="button" className="btn btn-primary" onClick={() => { reset(); onClose?.(); }} autoFocus><X size={15} /> Close preview</button>
          <button type="button" className="btn" onClick={() => (isChunkError(error) ? window.location.reload() : reset())}><RotateCcw size={15} /> Try again</button>
        </div>
        <Details error={error} />
      </div>
    </div>
  );
}

/** Small modal shown instead of a dialog that failed to render. */
function DialogFallback({ error, onClose }) {
  return (
    <Modal title="Something went wrong" icon={<AlertTriangle size={18} />} onClose={onClose} width={420}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close</button>}>
      <p className="muted" style={{ margin: 0 }}>This dialog couldn’t be opened. Close it and try again.</p>
      <Details error={error} />
    </Modal>
  );
}

/**
 * Catches render errors in its children and shows a friendly fallback instead of a blank app.
 * variant: 'screen' (default) | 'public' | 'app' | 'preview' | 'dialog'.
 * resetKey: when it changes (e.g. the route path or previewed file), a shown error is cleared.
 * onClose: for 'preview' and 'dialog' — closes the thing that crashed.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error: error || new Error('Unknown error') };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary:${this.props.variant || 'screen'}]`, error, info?.componentStack || '');
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset();
  }

  reset() {
    this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children ?? null;
    const { variant = 'screen', onClose } = this.props;
    if (variant === 'dialog') return <DialogFallback error={error} onClose={onClose} />;
    if (variant === 'preview') return <PreviewFallback error={error} reset={this.reset} onClose={onClose} />;
    if (variant === 'public') return <ScreenFallback error={error} reset={this.reset} home={false} title="Something went wrong on this page" />;
    if (variant === 'app') return <ScreenFallback error={error} reset={this.reset} hard title="Something went wrong" />;
    return <ScreenFallback error={error} reset={this.reset} />;
  }
}
