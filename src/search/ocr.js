// OCR with Tesseract.js, loaded only when first needed.
// Recognition runs in a Web Worker inside this browser; files never leave the device. The first run downloads
// the recognition engine and English language data (about 10 MB) from a public CDN; the browser caches them.

let workerPromise = null;

function worker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('eng'));
    workerPromise.catch(() => { workerPromise = null; }); // allow a retry (e.g. after going back online)
  }
  return workerPromise;
}

// One recognition at a time: Tesseract is CPU-heavy and the page should stay responsive.
let chain = Promise.resolve();

/** image: HTMLCanvasElement | Blob (PNG/JPEG/WebP/BMP) | data URL. Returns { text, confidence 0-100 }. */
export function recognize(image) {
  const job = chain.then(async () => {
    const w = await worker();
    const { data } = await w.recognize(image);
    return { text: (data.text || '').replace(/[ \t]+\n/g, '\n').trim(), confidence: Math.round(data.confidence || 0) };
  });
  chain = job.catch(() => {});
  return job;
}

export async function shutdownOcr() {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch { /* already gone */ }
  workerPromise = null;
}
