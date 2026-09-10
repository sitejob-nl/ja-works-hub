/**
 * One entry out of a zip container, read without running anything in it.
 *
 * A .docx is a zip whose `word/document.xml` holds the text, and that single
 * entry is all this module ever wants. A general-purpose archive library would
 * bring a dependency and an API surface far larger than one lookup, so the
 * central directory is walked here and the entry is inflated with the browser's
 * own DecompressionStream. Nothing is executed and nothing is written to disk:
 * a delivered file is data, not a program.
 */

const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** Zip64 marks its real numbers elsewhere; a delivered Word file never needs it. */
const ZIP64_MARKER = 0xffff;

export interface ZipEntryLocation { offset: number; compression: number; compressedSize: number }

/**
 * The central directory sits at the end, behind a record whose own length
 * depends on a trailing comment. Scanning backwards for its signature is what
 * the format asks for; a comment that happens to contain the signature would
 * still leave the fields behind it unreadable, and that ends in `null`.
 */
function endOfCentralDirectory(view: DataView): { entries: number; offset: number } | null {
  const start = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let position = view.byteLength - 22; position >= start; position -= 1) {
    if (view.getUint32(position, true) !== END_SIGNATURE) continue;
    const entries = view.getUint16(position + 10, true);
    const offset = view.getUint32(position + 16, true);
    if (entries === ZIP64_MARKER || offset === ZIP64_MARKER * 0x10000 + 0xffff) return null;
    return { entries, offset };
  }
  return null;
}

function findEntry(bytes: ArrayBuffer, name: string): ZipEntryLocation | null {
  const view = new DataView(bytes);
  const end = endOfCentralDirectory(view);
  if (!end) return null;
  const decoder = new TextDecoder();
  let position = end.offset;
  for (let index = 0; index < end.entries; index += 1) {
    if (position + 46 > view.byteLength || view.getUint32(position, true) !== CENTRAL_SIGNATURE) return null;
    const compression = view.getUint16(position + 10, true);
    const compressedSize = view.getUint32(position + 20, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const offset = view.getUint32(position + 42, true);
    const entryName = decoder.decode(new Uint8Array(bytes, position + 46, nameLength));
    if (entryName === name) return { offset, compression, compressedSize };
    position += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The named entry as text, or `null` when this archive does not hold it or
 * stores it in a way this reader does not support. A caller turns that into an
 * honest blockade; it never guesses at the content.
 */
export async function readZipText(bytes: ArrayBuffer, name: string): Promise<string | null> {
  let entry: ZipEntryLocation | null;
  try { entry = findEntry(bytes, name); } catch { return null; }
  if (!entry) return null;
  const view = new DataView(bytes);
  // The local header repeats the name and extra fields with its own lengths, and
  // those may differ from the central directory's; the data starts behind them.
  if (entry.offset + 30 > view.byteLength || view.getUint32(entry.offset, true) !== LOCAL_SIGNATURE) return null;
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true)
    + view.getUint16(entry.offset + 28, true);
  if (start + entry.compressedSize > view.byteLength) return null;
  const data = new Uint8Array(bytes, start, entry.compressedSize);
  try {
    const plain = entry.compression === 0 ? data
      : entry.compression === 8 ? await inflate(data) : null;
    return plain === null ? null : new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
