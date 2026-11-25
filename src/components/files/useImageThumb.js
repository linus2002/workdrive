import { useDrive, blobRegistry } from '../../store/DriveStore';
import { useThumb } from '../../data/storage/thumbStore';

const SMALL_ENOUGH = 300 * 1024; // smaller uploads are shown as they are
const WIDTH = 480;

async function shrink(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { return { failed: true }; } // a format the browser can't decode here
  try {
    const scale = Math.min(1, WIDTH / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    // WebP keeps transparency (logos, screenshots) and is small; browsers without it give PNG, still fine.
    return { url: c.toDataURL('image/webp', 0.82) };
  } finally {
    bmp.close?.();
  }
}

/**
 * Grid cards show a 480px copy of big uploaded photos (made once per file version and cached), instead of
 * decoding the full 10–20 MB original for every card. Returns the URL to show: the small copy when ready,
 * the original for small images or when no copy can be made, and null while the copy is being made.
 */
export function useImageThumb(item, originalUrl) {
  const { blobsVersion } = useDrive();
  const blob = blobRegistry.get(item.id)?.blob;
  const big = !!blob && blob.size > SMALL_ENOUGH && blob.type !== 'image/svg+xml' && typeof createImageBitmap === 'function';
  const key = big ? `img:${item.id}@${item.version || 1}` : null;
  const thumb = useThumb(key, () => shrink(blob), blobsVersion);
  if (!big || thumb?.failed) return originalUrl;
  return thumb?.url || null;
}
