import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile, { type SheetData } from 'write-excel-file/browser';

const stringifyCell = (value: unknown) => {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
};

const normalizeCell = (value: unknown) => {
  if (value == null) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
};

export const readExcelRows = async (input: File | Blob | ArrayBuffer): Promise<string[][]> => {
  const rows = await readSheet(input);
  return rows.map((row) => row.map(stringifyCell));
};

export const readExcelObjects = async (input: File | Blob | ArrayBuffer) => {
  const rows = await readExcelRows(input);
  const headers = (rows[0] ?? []).map((header) => header.trim());
  const visibleHeaders = headers.filter(Boolean);
  const records = rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => Object.fromEntries(
      headers
        .map((header, index) => [header, row[index] ?? ''] as const)
        .filter(([header]) => Boolean(header)),
    ));

  return { headers: visibleHeaders, rows: records };
};

export const downloadExcelRecords = async (
  rows: Record<string, unknown>[],
  filename: string,
  sheetName = 'Export',
) => {
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));

  const sheetData = [
    headers,
    ...rows.map((row) => headers.map((header) => normalizeCell(row[header]))),
  ] as SheetData;

  await writeXlsxFile(sheetData, { sheet: sheetName }).toFile(filename);
};
