import { crc32 } from 'node:zlib';

/**
 * A real .xlsx built in memory, so the reader can be proven against the actual
 * file format rather than against a stand-in. Committing binary fixtures would
 * hide what a case actually contains.
 */
export interface FixtureCell {
  text?: string; number?: string; formula?: string;
  /** A number format code, e.g. 'h:mm' or '[h]:mm'; decides how a cell is stored. */
  format?: string;
}
export interface FixtureSheet { name: string; rows: FixtureCell[][] }

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const columnName = (index: number): string => {
  let name = '', value = index;
  do { name = String.fromCharCode(65 + (value % 26)) + name; value = Math.floor(value / 26) - 1; } while (value >= 0);
  return name;
};

/** Stored (uncompressed) zip entries — a valid archive without extra dependencies. */
function buildZip(entries: { name: string; text: string }[]): Uint8Array {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.text, 'utf8');
    const digest = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(digest, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(digest, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + data.length;
  }
  const directoryBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

export function buildWorkbookFile(sheets: FixtureSheet[], options: { macros?: boolean } = {}): ArrayBuffer {
  const formats: string[] = [];
  const styleId = (format: string) => {
    const existing = formats.indexOf(format);
    return (existing >= 0 ? existing : formats.push(format) - 1) + 1;
  };
  const strings: string[] = [];
  const stringId = (value: string) => {
    const existing = strings.indexOf(value);
    if (existing >= 0) return existing;
    strings.push(value);
    return strings.length - 1;
  };
  const sheetParts = sheets.map((sheet, index) => {
    const rows = sheet.rows.map((row, rowIndex) => {
      const cells = row.map((cell, columnIndex) => {
        const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
        const style = cell.format ? ` s="${styleId(cell.format)}"` : '';
        if (cell.formula !== undefined) {
          // A formula with its stored result. A reader that executed formulas
          // would need a calculation engine; this one reads what was saved.
          return `<c r="${reference}"${style}><f>${xml(cell.formula)}</f><v>${xml(cell.number ?? '')}</v></c>`;
        }
        if (cell.number !== undefined) return `<c r="${reference}"${style}><v>${xml(cell.number)}</v></c>`;
        if (cell.text === undefined || cell.text === '') return `<c r="${reference}"/>`;
        return `<c r="${reference}" t="s"><v>${stringId(cell.text)}</v></c>`;
      }).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');
    return { index: index + 1, name: sheet.name, xml:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>` };
  });

  const parts = [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${options.macros ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' : ''}
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheetParts.map(sheet => `<Override PartName="/xl/worksheets/sheet${sheet.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { name: '_rels/.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetParts.map(sheet => `<sheet name="${xml(sheet.name)}" sheetId="${sheet.index}" r:id="rId${sheet.index}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetParts.map(sheet => `<Relationship Id="rId${sheet.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheet.index}.xml"/>`).join('')}
<Relationship Id="rIdStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { name: 'xl/styles.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${formats.length}">${formats.map((format, index) =>
      `<numFmt numFmtId="${164 + index}" formatCode="${xml(format)}"/>`).join('')}</numFmts>
<fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="${formats.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${
      formats.map((_, index) => `<xf numFmtId="${164 + index}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('')
    }</cellXfs></styleSheet>` },
    ...sheetParts.map(sheet => ({ name: `xl/worksheets/sheet${sheet.index}.xml`, text: sheet.xml })),
  ];
  if (options.macros) parts.push({ name: 'xl/vbaProject.bin', text: 'Sub Auto_Open()\nEnd Sub' });
  parts.push({ name: 'xl/sharedStrings.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map(value => `<si><t>${xml(value)}</t></si>`).join('')}</sst>` });

  const bytes = buildZip(parts);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The header of a legacy binary Excel file: an OLE compound document. */
export function buildLegacyXlsFile(): ArrayBuffer {
  const bytes = new Uint8Array(512);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return bytes.buffer;
}

/** Cell shorthands for readable fixtures. */
export const text = (value: string): FixtureCell => ({ text: value });
export const empty = (): FixtureCell => ({});
export const formula = (expression: string, storedResult: string): FixtureCell => ({ formula: expression, number: storedResult });
/** A serial number carrying a number format, the way a spreadsheet stores a duration. */
export const formatted = (serial: string, format: string): FixtureCell => ({ number: serial, format });
