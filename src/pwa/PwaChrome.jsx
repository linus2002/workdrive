import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { applyUpdate, getPwaState, promptInstall, subscribePwa } from './register';
import { useActiveT } from '../i18n';

const DISMISS_KEY = 'workdrive:install-dismissed';
const readDismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

/**
 * Floating PWA prompts, rendered next to the app (outside its providers):
 * "Update available — Reload" when a new version is waiting, and an "Install app" chip when the browser offers it.
 */
export default function PwaChrome() {
  const t = useActiveT(); // mounted outside the store, so it can't use useT
  const [pwa, setPwa] = useState(getPwaState);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [updateHidden, setUpdateHidden] = useState(false);
  useEffect(() => subscribePwa(setPwa), []);

  const dismissInstall = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode: dismissed for this visit only */ }
  };

  return (
    <>
      {pwa.updateReady && !updateHidden && (
        <div className="pwa-chrome top">
          <div className="pwa-update" role="status" aria-live="polite">
            <RefreshCw size={15} aria-hidden="true" />
            <span>{t('Update available')}</span>
            <button type="button" className="toast-action" onClick={applyUpdate}>{t('Reload')}</button>
            <button type="button" className="toast-close" onClick={() => setUpdateHidden(true)} aria-label={t('Dismiss')}><X size={14} /></button>
          </div>
        </div>
      )}
      {pwa.canInstall && !dismissed && (
        <div className="pwa-chrome">
          <div className="pwa-chip">
            <button type="button" className="pwa-chip-btn" onClick={() => promptInstall()} aria-label={t('Install WorkDrive as an app')}>
              <Download size={14} aria-hidden="true" /> {t('Install app')}
            </button>
            <button type="button" className="pwa-chip-x" onClick={dismissInstall} aria-label={t('Don’t show the install prompt again')}><X size={14} /></button>
          </div>
        </div>
      )}
    </>
  );
}
