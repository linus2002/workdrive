import { useEffect, useRef } from 'react';

/**
 * Don't lose unsaved edits silently: while `dirty`, warn before the page is closed or reloaded, and ask before an
 * in-app link navigates away (settings tabs, sidebar, ...). Links inside `keepSelector` (the form's own area) are
 * left alone.
 */
export function useUnsavedGuard(dirty, message = 'You have unsaved changes. Leave without saving?', keepSelector = null) {
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onUnload = (e) => { if (!dirtyRef.current) return; e.preventDefault(); e.returnValue = ''; };
    const onClick = (e) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || a.target === '_blank' || (keepSelector && a.closest(keepSelector))) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm(message)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('beforeunload', onUnload); document.removeEventListener('click', onClick, true); };
  }, [message, keepSelector]);
}
