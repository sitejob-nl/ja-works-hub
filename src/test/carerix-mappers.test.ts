import { describe, expect, it } from 'vitest';
import {
  isValidBsn,
  mapCREmployee,
  splitCarerixPhones,
} from '../../supabase/functions/_shared/carerix/mappers.ts';

describe('mapCREmployee', () => {
  it('maps Carerix identity fields from CR fields and additionalInfo', () => {
    const mapped = mapCREmployee(
      {
        _id: '123',
        employeeID: 456,
        firstName: 'Jan',
        lastName: 'Jansen',
        sofiNumber: '123456782',
        toLanguageNode: { _id: 'nl', value: 'Dutch' },
        additionalInfo: {
          nationaliteit: 'Pools',
          talen: 'English, pl',
        },
      },
      'org-1',
    );

    expect(mapped.employee_number).toBe('456');
    expect(mapped.bsn).toBe('123456782');
    expect(mapped.nationality).toBe('Pools');
    expect(mapped.languages).toEqual(['Nederlands', 'Engels', 'Pools']);
  });

  it('maps nationality from toNationalityNode (JA Werkt tenant)', () => {
    const mapped = mapCREmployee(
      {
        _id: '124',
        firstName: 'Anna',
        lastName: 'Nowak',
        toNationalityNode: { _id: '3266', value: 'Pools', label: 'Dossier', tag: 'PL' },
      },
      'org-1',
    );

    expect(mapped.nationality).toBe('Pools');
  });

  it('never falls back to the data node label — empty nodes are NOT "Dossier"', () => {
    // Regressietest: een leeg CRDataNode komt terug als
    // { _id: "0", value: null, label: "Dossier" }. De oude label-fallback
    // zette daardoor 1934 kandidaten op nationaliteit "Dossier".
    const mapped = mapCREmployee(
      {
        _id: '125',
        firstName: 'Ion',
        lastName: 'Popescu',
        toNationalityNode: { _id: '0', label: 'Dossier' },
        toHomeCountryNode: { _id: '0', label: 'Dossier' },
        toBirthCountryNode: { _id: '0', label: 'Dossier' },
        toIdentificationCountryNode: { _id: '0', label: 'Dossier' },
        toLanguageNode: { _id: '0', label: 'Dossier' },
      },
      'org-1',
    );

    expect(mapped.nationality).toBeNull();
    expect(mapped.languages).toBeNull();
    expect(mapped).not.toHaveProperty('address_country');
    expect(mapped).not.toHaveProperty('birth_country');
  });

  it('does not use identification country (land van ID-bewijs) as nationality', () => {
    const mapped = mapCREmployee(
      {
        _id: '126',
        firstName: 'Anna',
        lastName: 'Nowak',
        toIdentificationCountryNode: { _id: '3266', value: 'Polen', tag: 'PL' },
      },
      'org-1',
    );

    expect(mapped.nationality).toBeNull();
  });

  it('maps address_country and birth_country from country nodes (ISO tag)', () => {
    const mapped = mapCREmployee(
      {
        _id: '127',
        firstName: 'Vasile',
        lastName: 'Ionescu',
        toHomeCountryNode: { _id: '3268', value: 'Roemenië', label: 'Dossier', tag: 'RO' },
        toBirthCountryNode: { _id: '3268', value: 'Roemenië', label: 'Dossier', tag: 'RO' },
      },
      'org-1',
    );

    expect(mapped.address_country).toBe('RO');
    expect(mapped.birth_country).toBe('RO');
  });

  it('reads BSN from JA Werkt custom field _10235 with elfproef validation', () => {
    const mapped = mapCREmployee(
      {
        _id: '128',
        firstName: 'Janos',
        lastName: 'Rafi',
        additionalInfo: { _10235: '381783686' },
      },
      'org-1',
    );

    expect(mapped.bsn).toBe('381783686');
  });

  it('rejects non-BSN values in the BSN field', () => {
    const mapped = mapCREmployee(
      {
        _id: '129',
        firstName: 'Test',
        lastName: 'Persoon',
        sofiNumber: '123456789', // faalt elfproef
        additionalInfo: { _10235: 'Yes ' },
      },
      'org-1',
    );

    expect(mapped.bsn).toBeNull();
  });

  it('maps tussenvoegsel (lastNamePrefix) into last_name', () => {
    const mapped = mapCREmployee(
      { _id: '130', firstName: 'Jan', lastNamePrefix: 'van der', lastName: 'Berg' },
      'org-1',
    );

    expect(mapped.last_name).toBe('van der Berg');
  });

  it('maps tenant status values (Werkzoekend, Niet bemiddelbaar)', () => {
    const werkzoekend = mapCREmployee(
      { _id: '131', firstName: 'A', lastName: 'B', toStatusNode: { _id: '76', value: 'Werkzoekend' } },
      'org-1',
    );
    const nietBemiddelbaar = mapCREmployee(
      { _id: '132', firstName: 'C', lastName: 'D', toStatusNode: { _id: '77', value: 'Niet bemiddelbaar' } },
      'org-1',
    );

    expect(werkzoekend.status).toBe('werkzoekend');
    expect(nietBemiddelbaar.status).toBe('niet_beschikbaar');
  });

  it('maps eigen huisvesting (_10232) to has_dutch_address', () => {
    const ja = mapCREmployee(
      { _id: '133', firstName: 'A', lastName: 'B', additionalInfo: { _10232: ['10230'] } },
      'org-1',
    );
    const nee = mapCREmployee(
      { _id: '134', firstName: 'C', lastName: 'D', additionalInfo: { _10232: ['10231'] } },
      'org-1',
    );
    const onbekend = mapCREmployee(
      { _id: '135', firstName: 'E', lastName: 'F' },
      'org-1',
    );

    expect(ja.has_dutch_address).toBe(true);
    expect(nee.has_dutch_address).toBe(false);
    expect(onbekend).not.toHaveProperty('has_dutch_address');
  });

  it('splits an NL + foreign phone pair across phone and phone_nl', () => {
    const mapped = mapCREmployee(
      {
        _id: '136',
        firstName: 'Rache',
        lastName: 'Ionuț',
        mobileNumber: '+31616681429',
        mobileNumberBusiness: '+40758436539',
      },
      'org-1',
    );

    expect(mapped.phone).toBe('+40758436539');
    expect(mapped.phone_nl).toBe('+31616681429');
  });
});

describe('splitCarerixPhones', () => {
  it('keeps a single number in phone, regardless of origin', () => {
    expect(splitCarerixPhones({ mobileNumber: '+48730269332' })).toEqual({
      phone: '+48730269332',
      phone_nl: null,
    });
    expect(splitCarerixPhones({ mobileNumber: '0651647925' })).toEqual({
      phone: '0651647925',
      phone_nl: null,
    });
  });

  it('puts the foreign number in phone and the Dutch number in phone_nl', () => {
    expect(
      splitCarerixPhones({ mobileNumber: '0040774500182', mobileNumberBusiness: '0645219024' }),
    ).toEqual({ phone: '0040774500182', phone_nl: '0645219024' });

    // Andersom geordend: NL eerst, buitenlands tweede
    expect(
      splitCarerixPhones({ mobileNumber: '+31616520264', mobileNumberBusiness: '0040754433324' }),
    ).toEqual({ phone: '0040754433324', phone_nl: '+31616520264' });
  });

  it('handles two Dutch numbers (first → phone, second → phone_nl)', () => {
    expect(
      splitCarerixPhones({ mobileNumber: '+31687255315', mobileNumberBusiness: '+31 6 26840218' }),
    ).toEqual({ phone: '+31687255315', phone_nl: '+31 6 26840218' });
  });

  it('dedupes the same number in different notations and trims whitespace', () => {
    expect(
      splitCarerixPhones({ mobileNumber: '+40757586987 ', phoneNumber: '0040757586987' }),
    ).toEqual({ phone: '+40757586987', phone_nl: null });
  });

  it('returns nulls when no numbers exist', () => {
    expect(splitCarerixPhones({})).toEqual({ phone: null, phone_nl: null });
  });
});

describe('isValidBsn', () => {
  it('accepts valid BSNs (elfproef)', () => {
    expect(isValidBsn('381783686')).toBe(true);
    expect(isValidBsn('369945189')).toBe(true);
    expect(isValidBsn('123456782')).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isValidBsn('123456789')).toBe(false); // faalt elfproef
    expect(isValidBsn('Yes ')).toBe(false);
    expect(isValidBsn('')).toBe(false);
    expect(isValidBsn(null)).toBe(false);
    expect(isValidBsn('06-12345678')).toBe(false); // telefoonnummer-achtig
  });
});
