import { describe, expect, it } from 'vitest';
import {
  describeFolderAccess,
  groupDocumentsByFolder,
  isRestrictedFolder,
  suggestFolderId,
  toggleFolderRole,
  type CompanyDocumentFolder,
} from '@/lib/company-document-folders';

const ALL = ['admin', 'intercedent', 'backoffice', 'finance'] as const;

const folder = (over: Partial<CompanyDocumentFolder> & Pick<CompanyDocumentFolder, 'id' | 'key'>): CompanyDocumentFolder => ({
  label: over.key,
  sort_order: 0,
  is_default: false,
  allowed_roles: [...ALL],
  required_permission: null,
  ...over,
});

const algemeen = folder({ id: 'f-alg', key: 'algemeen', label: 'Algemeen', sort_order: 10, is_default: true });
const contracten = folder({ id: 'f-con', key: 'contracten', label: 'Contracten', sort_order: 20 });
const financieel = folder({ id: 'f-fin', key: 'financieel', label: 'Financieel', sort_order: 40, required_permission: 'finance.view' });

describe('isRestrictedFolder', () => {
  it('is open als alle interne rollen erbij mogen zonder extra recht', () => {
    expect(isRestrictedFolder(algemeen)).toBe(false);
  });

  it('is afgeschermd zodra een rol ontbreekt of een recht vereist is', () => {
    expect(isRestrictedFolder(financieel)).toBe(true);
    expect(isRestrictedFolder({ allowed_roles: ['admin', 'finance'], required_permission: null })).toBe(true);
  });
});

describe('describeFolderAccess', () => {
  it('benoemt de rollen en het finance-recht in gewone taal', () => {
    expect(describeFolderAccess(algemeen)).toBe('Alle interne rollen');
    expect(describeFolderAccess(financieel)).toBe('Alle interne rollen met het recht Finance bekijken');
    expect(describeFolderAccess({ allowed_roles: ['admin', 'finance'], required_permission: null })).toBe('Admin, Finance');
    expect(describeFolderAccess({ allowed_roles: ['admin'], required_permission: 'finance.view' })).toBe('Admin met het recht Finance bekijken');
  });

  it('houdt de vaste rolvolgorde aan, ongeacht de opslagvolgorde', () => {
    expect(describeFolderAccess({ allowed_roles: ['finance', 'admin', 'intercedent'], required_permission: null })).toBe('Admin, Intercedent, Finance');
  });
});

describe('toggleFolderRole', () => {
  it('zet een rol uit en aan zonder admin ooit kwijt te raken', () => {
    const zonderFinance = toggleFolderRole([...ALL], 'finance', false);
    expect(zonderFinance).toEqual(['admin', 'intercedent', 'backoffice']);
    expect(toggleFolderRole(zonderFinance, 'finance', true)).toEqual([...ALL]);
    expect(toggleFolderRole(['admin'], 'admin', false)).toEqual(['admin']);
    expect(toggleFolderRole([], 'intercedent', true)).toEqual(['admin', 'intercedent']);
  });
});

describe('groupDocumentsByFolder', () => {
  const docs = [
    { id: 'd1', company_document_folder_id: 'f-fin' },
    { id: 'd2', company_document_folder_id: 'f-alg' },
    { id: 'd3', company_document_folder_id: 'f-alg' },
    { id: 'd4', company_document_folder_id: 'f-onbekend' },
    { id: 'd5', company_document_folder_id: null },
  ];

  it('groepeert in mapvolgorde en laat lege mappen staan', () => {
    const groups = groupDocumentsByFolder(docs, [financieel, contracten, algemeen]);
    expect(groups.map((g) => g.folder?.key ?? null)).toEqual(['algemeen', 'contracten', 'financieel', null]);
    expect(groups[0].docs.map((d) => d.id)).toEqual(['d2', 'd3']);
    expect(groups[1].docs).toEqual([]);
    expect(groups[2].docs.map((d) => d.id)).toEqual(['d1']);
  });

  it('parkeert documenten zonder (zichtbare) map achteraan in plaats van ze te verbergen', () => {
    const groups = groupDocumentsByFolder(docs, [algemeen]);
    const rest = groups[groups.length - 1];
    expect(rest.folder).toBeNull();
    expect(rest.docs.map((d) => d.id)).toEqual(['d1', 'd4', 'd5']);
  });

  it('voegt geen restgroep toe als alles een map heeft', () => {
    const groups = groupDocumentsByFolder(docs.slice(0, 3), [algemeen, financieel]);
    expect(groups.every((g) => g.folder !== null)).toBe(true);
  });
});

describe('suggestFolderId', () => {
  const folders = [algemeen, contracten, financieel];

  it('volgt de standaardmap van het type als die zichtbaar is', () => {
    expect(suggestFolderId({ default_folder_id: 'f-con' }, folders)).toBe('f-con');
  });

  it('valt terug op de standaardmap van de organisatie', () => {
    expect(suggestFolderId({ default_folder_id: 'f-verborgen' }, folders)).toBe('f-alg');
    expect(suggestFolderId({ default_folder_id: null }, folders)).toBe('f-alg');
    expect(suggestFolderId(undefined, folders)).toBe('f-alg');
  });

  it('kiest de eerste zichtbare map als de standaardmap er niet is, en leeg als er niets is', () => {
    expect(suggestFolderId(undefined, [contracten, financieel])).toBe('f-con');
    expect(suggestFolderId(undefined, [])).toBe('');
  });
});
