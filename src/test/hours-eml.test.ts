import { describe, expect, it } from 'vitest';
import { decodeEmailMessage, splitQuotedHistory } from '@/lib/hours-eml';
import { readHoursFromMailText } from '@/lib/hours-mail-text';
import type { WorkbookContext } from '@/lib/hours-workbook';

/**
 * A message is four things at once: headers, what was written now, the history
 * underneath it and whatever came attached. The proof that matters is that the
 * history never becomes hours a second time.
 */

const bytesOf = (text: string): ArrayBuffer => {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);
  const buffer = new ArrayBuffer(encoded.length);
  new Uint8Array(buffer).set(encoded);
  return buffer;
};

const context: WorkbookContext = {
  members: [{ id: 'm1', name: 'Jan Kowalski' }],
  days: ['07', '08', '09', '10', '11', '12', '13'].map((day, index) => ({
    id: `day-${index}`, memberId: 'm1', workDate: `2026-09-${day}`,
  })),
};

const plainMessage = [
  'From: Peter de Vries <peter@acme.nl>',
  'To: uren@jawerkt.nl',
  'Subject: Uren week 37',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hoi,',
  '',
  'Jan Kowalski',
  'maandag 8',
  'dinsdag 8,5',
  '',
  'Groet, Peter',
  '',
  'Op wo 3 sep 2026 om 09:12 schreef Kas <kas@sitejob.nl>:',
  '> Jan Kowalski',
  '> maandag 6',
  '> dinsdag 6',
].join('\r\n');

describe('taking a delivered message apart', () => {
  it('keeps the new text and sets the quoted history aside', () => {
    const decoding = decodeEmailMessage(bytesOf(plainMessage));

    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;
    expect(decoding.message.subject).toBe('Uren week 37');
    expect(decoding.message.text).toContain('maandag 8');
    expect(decoding.message.text).not.toContain('maandag 6');
    expect(decoding.message.quoted).toContain('maandag 6');
  });

  it('lets the quoted week propose nothing a second time', () => {
    const decoding = decodeEmailMessage(bytesOf(plainMessage));
    if (decoding.ok === false) throw new Error('blocked');

    const reading = readHoursFromMailText(decoding.message.text, context);
    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => candidate.minutes),
      'the history states the same two days and must not be read at all').toEqual([480, 510]);
  });

  it('cuts at an Outlook reply header too, not only at a quote marker', () => {
    const split = splitQuotedHistory([
      'Jan Kowalski', 'maandag 8', '',
      'Van: Kas <kas@sitejob.nl>', 'Verzonden: woensdag 3 september 2026 09:12',
      'Jan Kowalski', 'maandag 6',
    ].join('\n'));

    expect(split.text).toContain('maandag 8');
    expect(split.text).not.toContain('maandag 6');
  });

  it('cuts at a signature separator, which is not delivered content either', () => {
    const split = splitQuotedHistory('Jan Kowalski\nmaandag 8\n\n--\nPeter de Vries\n06-12345678');

    expect(split.text).toContain('maandag 8');
    expect(split.text).not.toContain('06-12345678');
  });

  it('decodes quoted-printable and a multipart message with an attachment', () => {
    const message = [
      'From: Peter <peter@acme.nl>',
      'Subject: =?utf-8?B?VXJlbiB3ZWVrIDM3?=',
      'Content-Type: multipart/mixed; boundary="grens"',
      '',
      '--grens',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Jan Kowalski',
      'maandag 8 uur, dat is een lange=',
      ' regel',
      '',
      '--grens',
      'Content-Type: application/octet-stream; name="urenbriefje.xlsx"',
      'Content-Disposition: attachment; filename="urenbriefje.xlsx"',
      'Content-Transfer-Encoding: base64',
      '',
      'UEsDBAo=',
      '',
      '--grens--',
    ].join('\r\n');

    const decoding = decodeEmailMessage(bytesOf(message));
    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;
    expect(decoding.message.subject, 'an encoded subject is still a subject').toBe('Uren week 37');
    expect(decoding.message.text, 'a soft line break is not a line break').toContain('een lange regel');
    expect(decoding.message.attachments).toHaveLength(1);
    const [attachment] = decoding.message.attachments;
    expect(attachment.fileName).toBe('urenbriefje.xlsx');
    expect(attachment.inline).toBe(false);
    expect(Array.from(attachment.bytes.slice(0, 2)),
      'a zip container, whatever it was labelled').toEqual([0x50, 0x4b]);
  });

  it('marks a signature logo as inline, so it is never stored as a delivery', () => {
    const message = [
      'Content-Type: multipart/related; boundary="g"',
      '',
      '--g',
      'Content-Type: text/plain',
      '',
      'Jan Kowalski',
      '',
      '--g',
      'Content-Type: image/png; name="logo.png"',
      'Content-Disposition: inline; filename="logo.png"',
      'Content-ID: <logo>',
      'Content-Transfer-Encoding: base64',
      '',
      'iVBORw0KGgo=',
      '',
      '--g--',
    ].join('\r\n');

    const decoding = decodeEmailMessage(bytesOf(message));
    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;
    expect(decoding.message.attachments[0].inline).toBe(true);
  });

  it('falls back to the readable text of an HTML-only message', () => {
    const message = [
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Jan Kowalski</p><p>maandag 8</p><p>dinsdag 8,5</p>',
    ].join('\r\n');

    const decoding = decodeEmailMessage(bytesOf(message));
    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;

    const reading = readHoursFromMailText(decoding.message.text, context);
    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => candidate.minutes)).toEqual([480, 510]);
  });

  it('blocks a file that is not a message at all', () => {
    const decoding = decodeEmailMessage(bytesOf('gewoon wat tekst zonder kopregels'));

    expect(decoding.ok).toBe(false);
    if (decoding.ok === true) return;
    expect(decoding.issues[0].code).toBe('UNREADABLE_EMAIL');
  });
});
