export type IcsEventInput = {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string | Date;
  durationMinutes?: number;
  organizerName?: string | null;
  organizerEmail?: string | null;
};

const pad = (value: number) => String(value).padStart(2, "0");

function formatIcsDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcsText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldLine(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    parts.push(rest.slice(0, 73));
    rest = ` ${rest.slice(73)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

export function buildIcsEvent(input: IcsEventInput): string {
  const start = input.startsAt instanceof Date ? input.startsAt : new Date(input.startsAt);
  const end = new Date(start.getTime() + (input.durationMinutes ?? 60) * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JA Werkt//Match Interview//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    input.location ? `LOCATION:${escapeIcsText(input.location)}` : null,
    input.description ? `DESCRIPTION:${escapeIcsText(input.description)}` : null,
    input.organizerEmail ? `ORGANIZER;CN=${escapeIcsText(input.organizerName || "JA Werkt")}:MAILTO:${input.organizerEmail}` : null,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => Boolean(line));
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
