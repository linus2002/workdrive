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
  const thumb = isPdf ? item.pdfThumb || null : null;

  useEffect(() => {
    if (!isPdf || thumb || inFlight.has(item.id) || failed.has(item.id)) return;
    inFlight.add(item.id);
    (async () => {
      try {
        const blob = await fileBlob(item);
        if (!blob) throw new Error('no data');
        const url = await renderPdfFirstPage(blob);
        api.updateItem(item.id, { pdfThumb: url }, { touch: false });
      } catch {
        failed.add(item.id); // unreadable/encrypted PDF: keep the placeholder
      } finally {
        inFlight.delete(item.id);
      }
    })();
  }, [isPdf, thumb, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return thumb;
}
