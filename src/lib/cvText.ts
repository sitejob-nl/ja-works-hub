// Gedeelde client-side CV-/documenttekstextractie.
// Ondersteunt PDF (tekstlaag + OCR-fallback), DOCX, ODT, legacy DOC, RTF, TXT en
// afbeeldingen (OCR). Gebruikt door zowel CandidateAiTab (dossieranalyse) als
// CandidateNew (CV-upload met auto-invullen). Toasts geven OCR-voortgang aan.
import { toast } from 'sonner';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Geaccepteerde bestandstypen voor CV-/documentupload (extensies + MIME-types).
export const CV_ACCEPT = [
  '.pdf',
  '.doc',
  '.docx',
  '.odt',
  '.txt',
  '.rtf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.tif',
  '.tiff',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'text/plain',
  'text/rtf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
].join(',');

const extractPdfText = async (file: File) => {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (pageText) pages.push(pageText);
  }

  const text = pages.join('\n\n').trim();
  if (text.length > 100) return text;

  toast.info('Geen tekstlaag gevonden. OCR wordt gestart; dit kan even duren.');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  const ocrPages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) continue;

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      const pageText = result.data.text.replace(/\s{3,}/g, '\n').trim();
      if (pageText) ocrPages.push(pageText);
    }
  } finally {
    await worker.terminate();
  }

  return ocrPages.join('\n\n').trim();
};

const extractDocxText = async (file: File) => {
  const { unzipSync, strFromU8 } = await import('fflate');
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const documentParts = Object.keys(zip)
    .filter((path) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(path))
    .sort((a, b) => {
      if (a === 'word/document.xml') return -1;
      if (b === 'word/document.xml') return 1;
      return a.localeCompare(b);
    });

  const parser = new DOMParser();
  const sections: string[] = [];

  for (const part of documentParts) {
    const xml = strFromU8(zip[part]);
    const doc = parser.parseFromString(xml, 'application/xml');
    const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
    const text = paragraphs
      .map((paragraph) => Array.from(paragraph.getElementsByTagName('w:t'))
        .map((node) => node.textContent ?? '')
        .join('')
        .trim())
      .filter(Boolean)
      .join('\n');
    if (text) sections.push(text);
  }

  return sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
};

const extractOdtText = async (file: File) => {
  const { unzipSync, strFromU8 } = await import('fflate');
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const content = zip['content.xml'];
  if (!content) return '';

  return strFromU8(content)
    .replace(/<text:line-break\s*\/>/g, '\n')
    .replace(/<\/text:(p|h)>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const extractLegacyDocText = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const utf16 = new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
  const clean = (value: string) => value
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}\r\n@+/-]/gu, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const candidates = [clean(utf8), clean(utf16)].sort((a, b) => b.length - a.length);
  return candidates[0] ?? '';
};

const extractRtfText = async (file: File) => {
  const value = await file.text();
  return value
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\[a-zA-Z]+\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const extractImageText = async (file: File) => {
  toast.info('OCR wordt gestart voor de afbeelding; dit kan even duren.');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const result = await worker.recognize(file);
    return result.data.text.replace(/\s{3,}/g, '\n').trim();
  } finally {
    await worker.terminate();
  }
};

// Extraheert platte tekst uit een geüpload CV-/documentbestand. Gooit een Error
// met NL-melding voor niet-ondersteunde bestandstypen.
export const extractCvTextFromFile = async (file: File) => {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (type === 'application/pdf' || name.endsWith('.pdf')) return extractPdfText(file);
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) return extractDocxText(file);
  if (type === 'application/vnd.oasis.opendocument.text' || name.endsWith('.odt')) return extractOdtText(file);
  if (type === 'application/msword' || name.endsWith('.doc')) return extractLegacyDocText(file);
  if (type === 'text/plain' || name.endsWith('.txt')) return file.text();
  if (type === 'text/rtf' || name.endsWith('.rtf')) return extractRtfText(file);
  if (type.startsWith('image/') || /\.(jpe?g|png|webp|tiff?)$/i.test(name)) return extractImageText(file);

  throw new Error('Dit bestandstype wordt nog niet ondersteund voor AI-analyse');
};
