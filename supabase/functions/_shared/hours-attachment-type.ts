/**
 * What one delivered file may be stored as, decided by its first bytes.
 *
 * A mail program labels an attachment with whatever it happened to know, and
 * `application/octet-stream` is the usual answer for a workbook. So the name is
 * consulted too, and the first bytes decide: a file whose content does not match
 * what it claims to be is not stored at all. A message inside a message is
 * deliberately absent — one receipt is one level deep.
 *
 * This lives beside the calculation kernel because both sides need it: the
 * browser when somebody drags in an `.eml`, and the unattended intake when the
 * very same message arrives by itself.
 */

const MAGIC: Record<string, (bytes: Uint8Array) => boolean> = {
  'application/pdf': bytes => bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46,
  'image/jpeg': bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': bytes => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': bytes => bytes[0] === 0x50 && bytes[1] === 0x4b,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': bytes => bytes[0] === 0x50 && bytes[1] === 0x4b,
  'application/vnd.ms-excel': bytes => bytes[0] === 0xd0 && bytes[1] === 0xcf,
  'application/msword': bytes => bytes[0] === 0xd0 && bytes[1] === 0xcf,
};

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

export function attachmentSourceType(fileName: string, declared: string, bytes: Uint8Array): string | null {
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(fileName)?.[1]?.toLowerCase() ?? '';
  const candidates = [declared.toLowerCase(), EXTENSION_TYPES[extension]].filter(Boolean);
  for (const candidate of candidates) {
    const magic = MAGIC[candidate];
    if (magic && magic(bytes)) return candidate;
  }
  return null;
}

