import { describe, expect, it } from 'vitest';
import { mapCREmployee } from '../../supabase/functions/_shared/carerix/mappers.ts';

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

  it('falls back to identification country for nationality', () => {
    const mapped = mapCREmployee(
      {
        _id: '124',
        firstName: 'Anna',
        lastName: 'Nowak',
        toIdentificationCountryNode: { _id: 'pl', label: 'Polen' },
        systemLanguage: 'en',
      },
      'org-1',
    );

    expect(mapped.nationality).toBe('Polen');
    expect(mapped.languages).toEqual(['Engels']);
  });
});
