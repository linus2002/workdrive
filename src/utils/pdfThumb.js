// Renders the first page of a PDF to a small JPEG data URL using pdf.js.
// pdf.js is loaded lazily so it doesn't weigh down the initial bundle.

let libPromise = null;
export function loadPdfjs() {
  if (!libPromise) {
    libPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return libPromise;
}

// Render one PDF at a time so a grid full of PDFs doesn't block the page.
let chain = Promise.resolve();

export function renderPdfFirstPage(blob, width = 360) {
  const job = chain.then(async () => {
    const lib = await loadPdfjs();
    const data = new Uint8Array(await blob.arrayBuffer());
    const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.78);
    } finally {
      doc.destroy();
    }
  });
  chain = job.catch(() => {});
  return job;
}
