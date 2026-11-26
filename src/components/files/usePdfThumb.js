import { useDrive, blobRegistry } from '../../store/DriveStore';
import { fileBlob } from '../../store/useItemActions';
import { renderPdfFirstPage } from '../../utils/pdfThumb';
import { useThumb } from '../../data/storage/thumbStore';

/**
 * The first page of a PDF as a small image URL, made the first time it's needed and cached per file version
 * (outside the saved workspace, see thumbStore). null until it's ready, or for unreadable/encrypted PDFs.
 */
export function usePdfThumb(item) {
  const { blobsVersion } = useDrive();
  // Only real PDFs: a sample file without stored bytes would be generated and drawn on the main thread just for a
  // thumbnail, while its card can show its text instead (CardPreview).
  const isPdf = item?.type === 'file' && item.ext === 'pdf' && (blobRegistry.has(item.id) || !!item.dataUrl);
  const key = isPdf ? `pdf:${item.id}@${item.version || 1}` : null;
  const thumb = useThumb(key, async () => {
    const blob = await fileBlob(item);
    return blob ? { url: await renderPdfFirstPage(blob) } : null;
  }, blobsVersion);
  return thumb?.url || null;
}
