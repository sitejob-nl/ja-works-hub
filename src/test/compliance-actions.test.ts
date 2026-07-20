import { describe, it, expect } from 'vitest';
import {
  buildDocumentStoragePath, documentHasExpiry, isUploadableDocumentType,
  normalizeComplianceField, resolveComplianceAction, validateComplianceField, validateUploadFile,
} from '@/lib/compliance-actions';
import type { ComplianceItem } from '@/hooks/useComplianceCheck';

const item = (partial: Partial<ComplianceItem> & Pick<ComplianceItem, 'kind'>): ComplianceItem => ({
  code: partial.code ?? 'x',
  label: partial.label ?? 'Iets ontbreekt',
  ...partial,
});

describe('resolveComplianceAction — issue naar actie', () => {
  it('maakt van een ontbrekend document een upload-actie', () => {
    const action = resolveComplianceAction(
      item({ kind: 'document', code: 'doc:contract', docType: 'contract' }),
    );
    expect(action).toEqual({ type: 'upload', docType: 'contract', withExpiry: false });
  });

  it('vraagt een vervaldatum bij documenten die verlopen', () => {
    const action = resolveComplianceAction(
      item({ kind: 'document', code: 'doc:id_bewijs', docType: 'id_bewijs' }),
    );
    expect(action).toMatchObject({ type: 'upload', docType: 'id_bewijs', withExpiry: true });
    expect(documentHasExpiry('reglement')).toBe(false);
  });

  it('biedt geen upload voor een documenttype dat de database niet kent', () => {
    // compliance_rules.required_documents is vrije tekst; 'vca' zit niet in de enum.
    const action = resolveComplianceAction(item({ kind: 'document', code: 'doc:vca', docType: 'vca' }));
    expect(action.type).toBe('none');
    expect(isUploadableDocumentType('vca')).toBe(false);
    expect(isUploadableDocumentType('id_bewijs')).toBe(true);
  });

  it('maakt van een leeg veld een invulactie met het juiste invoertype', () => {
    expect(resolveComplianceAction(item({ kind: 'field', code: 'field:date_of_birth', field: 'date_of_birth' })))
      .toMatchObject({ type: 'field', field: 'date_of_birth', inputType: 'date', sensitive: false });
    expect(resolveComplianceAction(item({ kind: 'field', code: 'field:email', field: 'email' })))
      .toMatchObject({ type: 'field', inputType: 'email' });
    expect(resolveComplianceAction(item({ kind: 'field', code: 'field:phone', field: 'phone' })))
      .toMatchObject({ type: 'field', inputType: 'tel' });
  });

  it('markeert BSN en IBAN als gevoelig', () => {
    for (const field of ['bsn', 'iban']) {
      expect(resolveComplianceAction(item({ kind: 'sensitive', code: `field:${field}`, field })))
        .toMatchObject({ type: 'field', field, sensitive: true });
    }
  });

  it('geeft geen invoerveld voor een onbekend veld', () => {
    const action = resolveComplianceAction(item({ kind: 'field', code: 'field:gadget', field: 'gadget' }));
    expect(action.type).toBe('none');
  });

  it('toont geblokkeerde punten zonder actie, met een reden per geval', () => {
    const adres = resolveComplianceAction(
      item({ kind: 'blocked', code: 'blocked:no_dutch_address', label: 'Geen Nederlands adres' }),
    );
    const rijbewijs = resolveComplianceAction(
      item({ kind: 'blocked', code: 'blocked:drivers_license_expired', label: 'Rijbewijs is verlopen' }),
    );
    expect(adres.type).toBe('none');
    expect(rijbewijs.type).toBe('none');
    expect(adres).not.toEqual(rijbewijs);
  });
});

describe('validateComplianceField — BSN', () => {
  it('accepteert een BSN dat door de elfproef komt', () => {
    expect(validateComplianceField('bsn', '111222333')).toBeNull();
    expect(validateComplianceField('bsn', '111 222 333')).toBeNull();
  });

  it('weigert een BSN met verkeerde lengte of gefaalde elfproef', () => {
    expect(validateComplianceField('bsn', '123456789')).toMatch(/elfproef/i);
    expect(validateComplianceField('bsn', '12345678')).toMatch(/9 cijfers/i);
    expect(validateComplianceField('bsn', 'abcdefghi')).not.toBeNull();
  });
});

describe('validateComplianceField — IBAN', () => {
  it('accepteert een IBAN met kloppende mod-97-controle', () => {
    expect(validateComplianceField('iban', 'NL91ABNA0417164300')).toBeNull();
    expect(validateComplianceField('iban', 'nl91 abna 0417 1643 00')).toBeNull();
  });

  it('weigert een IBAN met een typefout of onzin', () => {
    expect(validateComplianceField('iban', 'NL91ABNA0417164301')).not.toBeNull();
    expect(validateComplianceField('iban', 'NL91')).not.toBeNull();
    expect(validateComplianceField('iban', 'zomaar wat')).not.toBeNull();
  });
});

describe('validateComplianceField — overige velden', () => {
  it('vraagt altijd om een waarde', () => {
    expect(validateComplianceField('nationality', '   ')).toBe('Vul een waarde in.');
    expect(validateComplianceField('bsn', '')).toBe('Vul een waarde in.');
  });

  it('weigert een geboortedatum in de toekomst of een onmogelijk jaartal', () => {
    expect(validateComplianceField('date_of_birth', '1990-05-04')).toBeNull();
    expect(validateComplianceField('date_of_birth', '2999-01-01')).toMatch(/toekomst/i);
    expect(validateComplianceField('date_of_birth', '1450-01-01')).not.toBeNull();
    expect(validateComplianceField('date_of_birth', 'geen datum')).not.toBeNull();
  });

  it('controleert e-mail en telefoon oppervlakkig maar bruikbaar', () => {
    expect(validateComplianceField('email', 'jan@voorbeeld.nl')).toBeNull();
    expect(validateComplianceField('email', 'jan@voorbeeld')).not.toBeNull();
    expect(validateComplianceField('phone', '+31 6 12345678')).toBeNull();
    expect(validateComplianceField('phone', '0612')).not.toBeNull();
  });

  it('vraagt bij vrije tekst minimaal twee tekens', () => {
    expect(validateComplianceField('nationality', 'Nederlandse')).toBeNull();
    expect(validateComplianceField('address_street', 'X')).not.toBeNull();
  });
});

describe('normalizeComplianceField', () => {
  it('haalt scheidingstekens uit BSN en IBAN voordat ze versleuteld worden opgeslagen', () => {
    expect(normalizeComplianceField('bsn', ' 111 222 333 ')).toBe('111222333');
    expect(normalizeComplianceField('iban', 'nl91 abna-0417 1643 00')).toBe('NL91ABNA0417164300');
  });

  it('laat gewone velden verder met rust, op spaties aan de randen na', () => {
    expect(normalizeComplianceField('nationality', '  Nederlandse ')).toBe('Nederlandse');
    expect(normalizeComplianceField('address_street', 'Dorps straat 1')).toBe('Dorps straat 1');
  });
});

describe('validateUploadFile', () => {
  it('accepteert pdf, jpg en png', () => {
    for (const name of ['id.pdf', 'foto.JPG', 'scan.jpeg', 'kaart.png']) {
      expect(validateUploadFile({ name, size: 1024 })).toBeNull();
    }
  });

  it('weigert andere formaten, lege en te grote bestanden', () => {
    expect(validateUploadFile({ name: 'contract.docx', size: 1024 })).toMatch(/PDF, JPG of PNG/);
    expect(validateUploadFile({ name: 'zonderextensie', size: 1024 })).not.toBeNull();
    expect(validateUploadFile({ name: 'leeg.pdf', size: 0 })).toMatch(/leeg/i);
    expect(validateUploadFile({ name: 'groot.pdf', size: 11 * 1024 * 1024 })).toMatch(/te groot/i);
  });
});

describe('buildDocumentStoragePath', () => {
  it('gebruikt hetzelfde pad als het documententabblad op het dossier', () => {
    expect(buildDocumentStoragePath('org-1', 'cand-2', 'Paspoort scan.PDF', 'uuid-3'))
      .toBe('org-1/cand-2/uuid-3.pdf');
  });

  it('laat de extensie weg als het bestand er geen heeft', () => {
    expect(buildDocumentStoragePath('org-1', 'cand-2', 'scan', 'uuid-3')).toBe('org-1/cand-2/uuid-3');
  });
});
