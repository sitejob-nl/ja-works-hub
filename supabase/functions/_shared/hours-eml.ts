import type { HoursIssue } from './hours-calculation.ts';

/**
 * A delivered `.eml`, taken apart into what somebody wrote and what came with it.
 *
 * An e-mail is not one text. It carries headers, the new message, the history of
 * everything that was written before, and often the actual hours as an
 * attachment. Reading all of that as one blob would let a quoted week from a
 * fortnight ago propose hours a second time, so this module keeps the four
 * apart and hands each to the part of the intake that knows what to do with it.
 *
 * Nothing here is executed and nothing is fetched: remote images, links and
 * scripts in a message are text like any other text, and stay text.
 */

export interface EmailAttachment {
  fileName: string; contentType: string; bytes: Uint8Array;
  /**
   * An image the message body refers to by identifier: a signature logo, not a
   * delivery. It is reported but never stored as a source of its own.
   */
  inline: boolean;
}

export interface EmailMessage {
  subject: string;
  from: string;
  /** What was written now, with the quoted history and the signature removed. */
  text: string;
  /** The history that was cut away, kept so a screen can say it was there. */
  quoted: string;
  attachments: EmailAttachment[];
}

export type EmailDecoding =
  | { ok: true; message: EmailMessage }
  | { ok: false; issues: HoursIssue[] };

const blocked = (code: string, message: string): EmailDecoding => ({ ok: false, issues: [{ code, message }] });

/**
 * MIME structure is ASCII, but a part's body is bytes in its own character set.
 * Reading the whole file as one byte-per-character string keeps both true: the
 * structure can be split as text, and a body can be turned back into the exact
 * bytes it was.
 */
function asByteString(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const chunks: string[] = [];
  for (let index = 0; index < view.length; index += 8192) {
    chunks.push(String.fromCharCode(...view.subarray(index, index + 8192)));
  }
  return chunks.join('');
}

const toBytes = (value: string): Uint8Array =>
  Uint8Array.from(value, character => character.charCodeAt(0) & 0xff);

function decodeText(value: string, charset: string): string {
  try { return new TextDecoder(charset || 'utf-8').decode(toBytes(value)); }
  catch { return new TextDecoder('utf-8').decode(toBytes(value)); }
}

function decodeBase64(value: string): string {
  try { return atob(value.replace(/[^A-Za-z0-9+/=]/g, '')); }
  catch { return ''; }
}

function decodeQuotedPrintable(value: string): string {
  return value.replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** `=?utf-8?B?…?=` in a subject or a filename; anything else is left as written. */
function decodeEncodedWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, kind: string, text: string) => {
    const raw = kind.toLowerCase() === 'b'
      ? decodeBase64(text)
      : decodeQuotedPrintable(text.replace(/_/g, ' '));
    return raw ? decodeText(raw, charset) : whole;
  });
}

type Headers = Map<string, string>;

/** Header names are case-insensitive and a value may be folded over several lines. */
function splitHeaders(part: string): { headers: Headers; body: string } {
  const separator = /\r?\n\r?\n/.exec(part);
  const head = separator ? part.slice(0, separator.index) : part;
  const body = separator ? part.slice(separator.index + separator[0].length) : '';
  const headers: Headers = new Map();
  let name = '';
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && name) {
      headers.set(name, `${headers.get(name) ?? ''} ${line.trim()}`);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) { name = ''; continue; }
    name = line.slice(0, colon).trim().toLowerCase();
    // A repeated header is the first one; a later Content-Type would change how
    // the body is read, and a message that says two things is not clarified by
    // picking the second.
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return { headers, body };
}

interface ContentType { type: string; params: Map<string, string> }

function parseContentType(value: string | undefined): ContentType {
  const [head, ...rest] = (value ?? 'text/plain').split(';');
  const params = new Map<string, string>();
  for (const piece of rest) {
    const equals = piece.indexOf('=');
    if (equals <= 0) continue;
    const key = piece.slice(0, equals).trim().toLowerCase();
    const raw = piece.slice(equals + 1).trim().replace(/^"|"$/g, '');
    params.set(key, raw);
  }
  return { type: head.trim().toLowerCase(), params };
}

function decodeBody(body: string, headers: Headers): string {
  const encoding = (headers.get('content-transfer-encoding') ?? '').trim().toLowerCase();
  if (encoding === 'base64') return decodeBase64(body);
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  return body;
}

/**
 * A filename may be split over several `filename*0*`-style parameters. Only the
 * plain forms are read; a name this reader cannot piece together falls back to
 * the part's position, so an attachment is never silently dropped.
 */
function attachmentName(contentType: ContentType, disposition: ContentType, position: number): string {
  const named = disposition.params.get('filename') ?? contentType.params.get('name');
  if (!named) return `bijlage ${position}`;
  // RFC 2231 writes a character set in front of the value; the message says which.
  const extended = /^([^']*)'[^']*'(.*)$/.exec(named);
  const value = extended
    ? decodeText(decodeQuotedPrintable(extended[2].replace(/%([0-9A-Fa-f]{2})/g, '=$1')), extended[1])
    : decodeEncodedWords(named);
  // The database refuses a name with a path separator or a control character;
  // the rest of the name stays exactly as the message wrote it.
  // \p{C} covers the control and format characters the database refuses, plus
  // the invisible ones that make a filename read as something it is not.
  return value.replace(/[\\/]/g, ' ').replace(/\p{C}/gu, '')
    .replace(/\s+/g, ' ').trim().slice(0, 255) || `bijlage ${position}`;
}

interface Collected { texts: string[]; htmls: string[]; attachments: EmailAttachment[] }

function walk(part: string, collected: Collected, depth: number): void {
  // A message that nests further than this is not a delivery of hours; stopping
  // is better than following a structure built to be followed forever.
  if (depth > 10) return;
  const { headers, body } = splitHeaders(part);
  const contentType = parseContentType(headers.get('content-type'));
  const disposition = parseContentType(headers.get('content-disposition'));

  if (contentType.type.startsWith('multipart/')) {
    const boundary = contentType.params.get('boundary');
    if (!boundary) return;
    const marker = `--${boundary}`;
    const pieces = body.split(new RegExp(`(?:^|\r?\n)${escapeForRegExp(marker)}(?:--)?[ \t]*(?:\r?\n|$)`));
    // The first piece is the preamble, which belongs to no part.
    for (const piece of pieces.slice(1)) {
      if (piece.trim()) walk(piece, collected, depth + 1);
    }
    return;
  }

  const decoded = decodeBody(body, headers);
  const isAttachment = disposition.type === 'attachment'
    || !!disposition.params.get('filename') || !!contentType.params.get('name');
  if (isAttachment) {
    collected.attachments.push({
      fileName: attachmentName(contentType, disposition, collected.attachments.length + 1),
      contentType: contentType.type,
      bytes: toBytes(decoded),
      inline: disposition.type === 'inline' && headers.has('content-id'),
    });
    return;
  }
  const charset = contentType.params.get('charset') ?? 'utf-8';
  if (contentType.type === 'text/plain') collected.texts.push(decodeText(decoded, charset));
  else if (contentType.type === 'text/html') collected.htmls.push(decodeText(decoded, charset));
}

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The readable text of an HTML message. Blocks become line breaks so a list of
 * days stays a list of days; everything else is tags, and tags are not content.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Where the message stops being new and starts being what was already said.
 *
 * A reply repeats the whole conversation underneath it. Reading that history as
 * if it were delivered now would propose last fortnight's Saturday again, so
 * everything from the first sign of quoting is set aside. The markers are the
 * ones mail programs actually write; a line that merely mentions one of them
 * inside a sentence is not a marker, which is why each is anchored to the start
 * of its own line.
 */
const QUOTE_MARKERS: RegExp[] = [
  /^>/,
  /^-{2,}\s*(oorspronkelijk bericht|original message|forwarded message|doorgestuurd bericht)/i,
  /^_{8,}\s*$/,
  /^op .{4,80}\s(schreef|geschreven door)\b/i,
  /^on .{4,80}\swrote:/i,
  /^(van|from|verzonden|sent|to|aan|onderwerp|subject)\s*:\s/i,
  /^-{2}\s*$/,
];

export function splitQuotedHistory(text: string): { text: string; quoted: string } {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex(line => QUOTE_MARKERS.some(marker => marker.test(line.trim())));
  if (cut < 0) return { text: text.trim(), quoted: '' };
  return {
    text: lines.slice(0, cut).join('\n').trim(),
    quoted: lines.slice(cut).join('\n').trim(),
  };
}

/**
 * The message's own top-level headers, lowercased.
 *
 * The reader deliberately hands back only what a delivery is *about*, so the
 * envelope is not part of `EmailMessage`. The unattended intake needs two of
 * those headers — `In-Reply-To` and `References` — to recognise which request a
 * reply hangs from, and this is how it reads them without widening what a
 * delivered message means.
 */
export function readEmailHeaders(bytes: ArrayBuffer): Record<string, string> {
  const { headers } = splitHeaders(asByteString(bytes));
  const named: Record<string, string> = {};
  for (const [name, value] of headers) named[name] = decodeEncodedWords(value).trim();
  return named;
}

export function decodeEmailMessage(bytes: ArrayBuffer): EmailDecoding {
  const raw = asByteString(bytes);
  const { headers } = splitHeaders(raw);
  if (!headers.has('content-type') && !headers.has('from') && !headers.has('subject')) {
    return blocked('UNREADABLE_EMAIL',
      'Dit bestand is geen leesbaar e-mailbericht. Er zijn geen voorstellen gemaakt; bewaar het als bron en leg de uren handmatig vast.');
  }
  const collected: Collected = { texts: [], htmls: [], attachments: [] };
  walk(raw, collected, 0);
  // A message that offers both keeps its plain text: that is what the sender
  // typed, and turning markup back into text can only lose something.
  const body = collected.texts.find(text => text.trim())
    ?? (collected.htmls.length ? htmlToText(collected.htmls.join('\n')) : '');
  const split = splitQuotedHistory(body);
  return {
    ok: true,
    message: {
      subject: decodeEncodedWords(headers.get('subject') ?? '').trim(),
      from: decodeEncodedWords(headers.get('from') ?? '').trim(),
      text: split.text,
      quoted: split.quoted,
      attachments: collected.attachments,
    },
  };
}
