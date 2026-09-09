/**
 * How many pages a delivered PDF has. The browser already reads the bytes to
 * compute the digest, so counting here costs nothing extra and keeps the number
 * next to the file it describes. It is a fact about the delivery, not a trust
 * boundary: the reviewer always sees the actual pages before applying anything.
 */
export async function countPdfPages(bytes: ArrayBuffer): Promise<number> {
  const [pdfjsLib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
  // getDocument transfers the buffer, so the digest keeps its own copy.
  const document = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  try {
    return document.numPages;
  } finally {
    await document.destroy();
  }
}
