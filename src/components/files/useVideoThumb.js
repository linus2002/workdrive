import { useDrive } from '../../store/DriveStore';
import { fileBlob } from '../../store/useItemActions';
import { captureVideoFrame } from '../../utils/videoThumb';
import { useThumb } from '../../data/storage/thumbStore';

/**
 * A still frame of an uploaded video ({ url, duration }), captured the first time it's needed and cached per
 * file version (outside the saved workspace, see thumbStore). null until ready, or when the video can't be read.
 */
export function useVideoThumb(item, isVideo) {
  const { blobsVersion } = useDrive();
  const key = isVideo ? `video:${item.id}@${item.version || 1}` : null;
  return useThumb(key, async () => {
    const blob = await fileBlob(item);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    try { return await captureVideoFrame(url); } finally { URL.revokeObjectURL(url); }
  }, blobsVersion);
}
