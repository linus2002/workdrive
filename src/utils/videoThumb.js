// Grabs a still frame from a video (a little way in, past any black lead-in) as a small JPEG data URL.
// One video at a time, so a grid full of videos doesn't decode them all at once.

let chain = Promise.resolve();

export function captureVideoFrame(src, width = 360) {
  const job = chain.then(() => new Promise((resolve, reject) => {
    const v = document.createElement('video');
    let done = false;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load(); // releases the decoder
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error('timed out')), 20000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onerror = () => finish(reject, new Error('unreadable video'));
    // Points to try (fractions of the length): a frame that's almost all black moves on to the next one.
    const tries = [0.1, 0.3, 0.55];
    let attempt = 0;
    let probing = false;
    const seekTo = () => {
      const d = v.duration;
      v.currentTime = Number.isFinite(d) && d > 0 ? Math.min(Math.max(d * tries[attempt], 0.1), d * 0.9) : 0.5 + attempt;
    };
    v.onloadedmetadata = () => {
      // Recorded WebM often has no duration in its header: seeking far past the end makes the browser work it out.
      if (!Number.isFinite(v.duration)) { probing = true; v.currentTime = 1e101; return; }
      seekTo();
    };
    v.onseeked = () => {
      if (probing) { probing = false; seekTo(); return; }
      try {
        if (!v.videoWidth || !v.videoHeight) throw new Error('no picture'); // audio-only
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(width, v.videoWidth);
        canvas.height = Math.round((canvas.width * v.videoHeight) / v.videoWidth);
        const g = canvas.getContext('2d', { willReadFrequently: true });
        g.drawImage(v, 0, 0, canvas.width, canvas.height);
        if (attempt < tries.length - 1 && isDark(g, canvas.width, canvas.height)) { attempt++; seekTo(); return; }
        finish(resolve, { url: canvas.toDataURL('image/jpeg', 0.75), duration: Number.isFinite(v.duration) ? v.duration : null });
      } catch (e) {
        finish(reject, e);
      }
    };
    v.src = src;
  }));
  chain = job.catch(() => {});
  return job;
}

/** Is the drawn frame (nearly) black? Samples a coarse grid of pixels. */
function isDark(g, w, h) {
  const { data } = g.getImageData(0, 0, w, h);
  let sum = 0; let n = 0;
  const step = Math.max(1, Math.floor((w * h) / 400)) * 4;
  for (let i = 0; i < data.length; i += step) { sum += data[i] + data[i + 1] + data[i + 2]; n++; }
  return sum / (n * 3) < 12;
}

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
