import { describe, expect, it } from 'vitest';
// Validatie van de publieke profielaanvullink is server-side gedeeld; we testen de pure
// module hier rechtstreeks (zelfde patroon als matching.test.ts).
import {
  mergeProfileValues,
  parseIsoDate,
  summarizeProfileErrors,
  validateProfileSubmission,
  type ProfileFormValues,
} from '../../supabase/functions/_shared/profile-validation.ts';

const TODAY = new Date(Date.UTC(2026, 6, 19)); // 2026-07-19, vast referentiepunt

/** Een volledig ingevuld formulier zonder Nederlands telefoonnummer — het doelscenario. */
const compleet = (overrides: Partial<ProfileFormValues> = {}): ProfileFormValues => ({
  phone: '+40 721 234 567',
  phone_nl: '',
  email: 'ion.popescu@example.com',
  emergency_contact_name: 'Maria Popescu',
  emergency_contact_phone: '+40 721 987 654',
  date_of_birth: '1992-03-14',
  nationality: 'Roemeense',
  languages: ['Roemeens', 'Engels'],
  has_dutch_address: false,
  has_drivers_license: false,
  available_from: '2026-08-01',
  ...overrides,
});

const validate = (values: ProfileFormValues) => validateProfileSubmission(values, { today: TODAY });

describe('validateProfileSubmission', () => {
  it('keurt een compleet profiel zonder Nederlands telefoonnummer goed', () => {
    const result = validate(compleet());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.missingLabels).toEqual([]);
  });

  it('laat het Nederlandse telefoonnummer bewust leeg toe (kandidaten hebben er vaak geen)', () => {
    expect(validate(compleet({ phone_nl: '' })).valid).toBe(true);
    expect(validate(compleet({ phone_nl: null })).valid).toBe(true);
    expect(validate(compleet({ phone_nl: undefined })).valid).toBe(true);
  });

  it('controleert een ingevuld Nederlands nummer wel op volledigheid', () => {
    const result = validate(compleet({ phone_nl: '06 12' }));
    expect(result.valid).toBe(false);
    expect(result.errors.phone_nl).toContain('niet compleet');
  });

  it('geeft per veld een eigen melding, niet één generieke fout', () => {
    const result = validate({});
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(
      [
        'available_from',
        'date_of_birth',
        'email',
        'emergency_contact_name',
        'emergency_contact_phone',
        'languages',
        'nationality',
        'phone',
      ].sort(),
    );
    // Elke melding is uniek en Nederlands.
    const messages = Object.values(result.errors);
    expect(new Set(messages).size).toBe(messages.length);
    expect(result.errors.email).toBe('Vul je e-mailadres in.');
  });

  it('somt de ontbrekende velden op in formuliervolgorde', () => {
    const result = validate({ email: 'ion@example.com', phone: '+40 721 234 567' });
    expect(result.missingLabels).toEqual([
      'Naam noodcontact',
      'Telefoonnummer noodcontact',
      'Geboortedatum',
      'Nationaliteit',
      'Talen',
      'Beschikbaar vanaf',
    ]);
  });

  it('behandelt witruimte als leeg', () => {
    const result = validate(compleet({ emergency_contact_name: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.emergency_contact_name).toBeTruthy();
  });

  it('accepteert buitenlandse telefoonnummers in diverse notaties', () => {
    for (const phone of ['+40721234567', '0040 721 234 567', '+48 123 456 789', '+31612345678']) {
      expect(validate(compleet({ phone })).valid).toBe(true);
    }
  });

  it('wijst een te kort telefoonnummer af', () => {
    const result = validate(compleet({ phone: '+40 72' }));
    expect(result.errors.phone).toContain('niet compleet');
  });

  it('wijst een onjuist e-mailadres af', () => {
    for (const email of ['ion.popescu', 'ion@popescu', 'ion @example.com', '@example.com']) {
      expect(validate(compleet({ email })).errors.email).toBeTruthy();
    }
  });

  it('accepteert een lege lijst talen niet', () => {
    expect(validate(compleet({ languages: [] })).errors.languages).toBeTruthy();
    expect(validate(compleet({ languages: ['  '] })).errors.languages).toBeTruthy();
    expect(validate(compleet({ languages: ['Pools'] })).valid).toBe(true);
  });

  describe('geboortedatum', () => {
    it('wijst een onmogelijke datum af', () => {
      expect(validate(compleet({ date_of_birth: '2026-02-31' })).errors.date_of_birth).toBe(
        'Vul een geldige geboortedatum in.',
      );
    });

    it('wijst een kandidaat jonger dan 16 af', () => {
      const result = validate(compleet({ date_of_birth: '2012-07-20' }));
      expect(result.errors.date_of_birth).toContain('16 jaar');
    });

    it('accepteert precies 16 jaar op de verjaardag', () => {
      expect(validate(compleet({ date_of_birth: '2010-07-19' })).valid).toBe(true);
    });

    it('wijst een onwaarschijnlijk hoge leeftijd af', () => {
      expect(validate(compleet({ date_of_birth: '1900-01-01' })).errors.date_of_birth).toContain(
        'Controleer',
      );
    });
  });

  describe('Nederlands adres', () => {
    it('vraagt geen adresvelden als de kandidaat nog geen NL-adres heeft', () => {
      expect(validate(compleet({ has_dutch_address: false })).valid).toBe(true);
    });

    it('maakt straat, postcode en stad verplicht zodra het vinkje aan staat', () => {
      const result = validate(compleet({ has_dutch_address: true }));
      expect(result.valid).toBe(false);
      expect(result.errors.address_street).toBeTruthy();
      expect(result.errors.address_postal).toBeTruthy();
      expect(result.errors.address_city).toBeTruthy();
    });

    it('controleert het formaat van de postcode', () => {
      const met = (address_postal: string) =>
        validate(
          compleet({
            has_dutch_address: true,
            address_street: 'Dorpsstraat 1',
            address_city: 'Mierlo',
            address_postal,
          }),
        );
      expect(met('5731 AB').valid).toBe(true);
      expect(met('5731ab').valid).toBe(true);
      expect(met('1234').errors.address_postal).toContain('5731 AB');
      expect(met('AB 1234').errors.address_postal).toBeTruthy();
    });
  });

  describe('rijbewijs en beschikbaarheid', () => {
    it('vraagt de verloopdatum alleen als de kandidaat een rijbewijs heeft', () => {
      expect(validate(compleet({ has_drivers_license: false })).valid).toBe(true);
      expect(
        validate(compleet({ has_drivers_license: true })).errors.drivers_license_expiry,
      ).toBeTruthy();
      expect(
        validate(compleet({ has_drivers_license: true, drivers_license_expiry: '2030-01-01' }))
          .valid,
      ).toBe(true);
    });

    it('laat "beschikbaar tot" leeg (onbepaalde tijd beschikbaar)', () => {
      expect(validate(compleet({ available_until: '' })).valid).toBe(true);
    });

    it('wijst een einddatum vóór de startdatum af', () => {
      const result = validate(compleet({ available_from: '2026-08-01', available_until: '2026-07-01' }));
      expect(result.errors.available_until).toContain('vóór je startdatum');
    });

    it('accepteert een einddatum gelijk aan de startdatum', () => {
      expect(
        validate(compleet({ available_from: '2026-08-01', available_until: '2026-08-01' })).valid,
      ).toBe(true);
    });
  });
});

describe('summarizeProfileErrors', () => {
  it('vertaalt veldfouten naar labels in formuliervolgorde', () => {
    expect(
      summarizeProfileErrors({ languages: 'x', phone: 'x', address_postal: 'x' }),
    ).toEqual(['Telefoon (EU / buitenland)', 'Talen', 'Postcode']);
  });

  it('geeft een lege lijst zonder fouten', () => {
    expect(summarizeProfileErrors({})).toEqual([]);
  });

  // De pagina leidt haar samenvatting hieruit af; zonder fouten mag er dus niets staan.
  it('sluit aan op wat validateProfileSubmission teruggeeft', () => {
    const result = validate({});
    expect(summarizeProfileErrors(result.errors)).toEqual(result.missingLabels);
  });
});

describe('parseIsoDate', () => {
  it('parseert een geldige ISO-datum', () => {
    expect(parseIsoDate('2026-07-19')?.toISOString()).toBe('2026-07-19T00:00:00.000Z');
  });

  it('weigert doorrollende datums en losse rommel', () => {
    for (const value of ['2026-02-31', '2026-13-01', '19-07-2026', '', '2026-7-9', null, 42]) {
      expect(parseIsoDate(value)).toBeNull();
    }
  });
});

describe('mergeProfileValues', () => {
  it('vult ontbrekende velden aan uit het bestaande dossier', () => {
    const merged = mergeProfileValues(
      { phone: '+40 721 234 567' },
      { email: 'ion@example.com', nationality: 'Roemeense' },
    );
    expect(merged.phone).toBe('+40 721 234 567');
    expect(merged.email).toBe('ion@example.com');
    expect(merged.nationality).toBe('Roemeense');
  });

  it('laat de ingestuurde waarde winnen van de bestaande', () => {
    const merged = mergeProfileValues({ email: 'nieuw@example.com' }, { email: 'oud@example.com' });
    expect(merged.email).toBe('nieuw@example.com');
  });

  it('overschrijft bestaande gegevens nooit met leeg (COALESCE-afspraak)', () => {
    const merged = mergeProfileValues(
      { email: '', phone: '   ', languages: [] },
      { email: 'oud@example.com', phone: '+40 721 234 567', languages: ['Roemeens'] },
    );
    expect(merged.email).toBe('oud@example.com');
    expect(merged.phone).toBe('+40 721 234 567');
    expect(merged.languages).toEqual(['Roemeens']);
  });

  it('respecteert een expliciet uitgezet vinkje', () => {
    expect(
      mergeProfileValues({ has_dutch_address: false }, { has_dutch_address: true })
        .has_dutch_address,
    ).toBe(false);
    expect(
      mergeProfileValues({}, { has_dutch_address: true }).has_dutch_address,
    ).toBe(true);
  });

  it('keurt een profiel goed dat al compleet in het dossier staat maar niet is meegestuurd', () => {
    // Scenario: oudere/gecachede frontend-bundel stuurt alleen een deel van de velden mee.
    const merged = mergeProfileValues({ phone: '+40 721 234 567' }, compleet());
    expect(validate(merged).valid).toBe(true);
  });

  it('gaat om met ontbrekende invoer aan beide kanten', () => {
    const merged = mergeProfileValues(null, undefined);
    expect(validate(merged).valid).toBe(false);
    expect(merged.languages).toEqual([]);
  });
});
