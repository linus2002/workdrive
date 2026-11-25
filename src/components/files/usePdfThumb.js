import { useEffect } from 'react';
import { useDrive } from '../../store/DriveStore';
import { fileBlob } from '../../store/useItemActions';
import { renderPdfFirstPage } from '../../utils/pdfThumb';

const inFlight = new Set();
const failed = new Set();

/**
 * Returns the first-page thumbnail for a PDF item, generating and saving it
 * on the item the first time it's needed. Returns null until it's ready.
 */
export function usePdfThumb(item) {
  const { api } = useDrive();
  const isPdf = item?.type === 'file' && item.ext === 'pdf';
  // The saved thumbnail belongs to one version: a new or restored version gets a fresh one.
  const version = item?.version || 1;
  const current = isPdf && item.pdfThumb && (item.pdfThumbOf ?? 1) === version;
  const thumb = current ? item.pdfThumb : null;
  const key = isPdf ? `${item.id}@${version}` : null;

  useEffect(() => {
    if (!isPdf || thumb || inFlight.has(key) || failed.has(key)) return;
    inFlight.add(key);
    (async () => {
      try {
        const blob = await fileBlob(item);
        if (!blob) throw new Error('no data');
        const url = await renderPdfFirstPage(blob);
        api.updateItem(item.id, { pdfThumb: url, pdfThumbOf: version }, { touch: false });
      } catch {
        failed.add(key); // unreadable/encrypted PDF: keep the placeholder
      } finally {
        inFlight.delete(key);
      }
    })();
  }, [isPdf, thumb, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return thumb;
}
