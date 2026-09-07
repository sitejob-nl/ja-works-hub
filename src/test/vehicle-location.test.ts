import { describe, expect, it } from 'vitest';
import {
  formatVehicleLocationUpdate,
  vehicleLocationDate,
  vehicleLocationDateTime,
  vehicleLocationPatch,
  vehicleLocationText,
} from '@/lib/vehicle-location';

/**
 * Laatste bekende locatie. De kern van dit ticket is dat **leeg een geldige staat is**:
 * geen lege badge, geen "Invalid Date", en geen datum die suggereert dat de auto vandaag
 * nog gezien is. Die regels zitten in deze helpers, dus hier worden ze vastgelegd.
 *
 * Tijdstippen zonder zone (`2026-09-07T14:05:00`) leest date-fns als lokale tijd, zodat de
 * verwachte tekst niet van de tijdzone van de testrunner afhangt.
 */
describe('vehicleLocationText', () => {
  it('geeft de ingevulde locatie terug', () => {
    expect(vehicleLocationText({ last_known_location: 'Parkeerterrein Mierlo' })).toBe('Parkeerterrein Mierlo');
  });

  it('trimt en behandelt alleen-spaties als leeg', () => {
    expect(vehicleLocationText({ last_known_location: '  Garage Van Dijk ' })).toBe('Garage Van Dijk');
    expect(vehicleLocationText({ last_known_location: '   ' })).toBeNull();
  });

  it('geeft null bij een leeg veld of een ontbrekende rij', () => {
    expect(vehicleLocationText({ last_known_location: null })).toBeNull();
    expect(vehicleLocationText({})).toBeNull();
    expect(vehicleLocationText(null)).toBeNull();
    expect(vehicleLocationText(undefined)).toBeNull();
  });
});

describe('vehicleLocationDate / vehicleLocationDateTime', () => {
  it('formatteert het tijdstip als er een locatie bij staat', () => {
    const row = { last_known_location: 'Mierlo', last_known_location_at: '2026-09-07T14:05:00' };
    expect(vehicleLocationDate(row)).toBe('07-09-2026');
    expect(vehicleLocationDateTime(row)).toBe('07-09-2026 14:05');
  });

  it('verwerkt een tijdstip mét zone zoals de database het teruggeeft', () => {
    const row = { last_known_location: 'Mierlo', last_known_location_at: '2026-09-07T14:05:00+00:00' };
    expect(vehicleLocationDate(row)).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });

  it('geeft null zonder tijdstip — nooit stilzwijgend vandaag', () => {
    expect(vehicleLocationDate({ last_known_location: 'Mierlo', last_known_location_at: null })).toBeNull();
    expect(vehicleLocationDateTime({ last_known_location: 'Mierlo' })).toBeNull();
  });

  it('geeft null bij een onbruikbare datum in plaats van "Invalid Date"', () => {
    const row = { last_known_location: 'Mierlo', last_known_location_at: 'zomaar wat' };
    expect(vehicleLocationDate(row)).toBeNull();
    expect(vehicleLocationDateTime(row)).toBeNull();
  });

  it('geeft null zonder locatie, ook als er wél een tijdstip staat', () => {
    const row = { last_known_location: null, last_known_location_at: '2026-09-07T14:05:00' };
    expect(vehicleLocationDate(row)).toBeNull();
  });
});

describe('formatVehicleLocationUpdate', () => {
  it('zet de naam met het tijdstip erbij, net als formatAssignedBy', () => {
    expect(formatVehicleLocationUpdate({
      last_known_location: 'Mierlo',
      last_known_location_at: '2026-09-07T14:05:00',
      location_profile: { full_name: 'Jeroen Adriaans' },
    })).toBe('Jeroen Adriaans · 07-09-2026 14:05');
  });

  it('houdt de naam als het tijdstip ontbreekt', () => {
    expect(formatVehicleLocationUpdate({
      last_known_location: 'Mierlo',
      location_profile: { full_name: 'Jeroen Adriaans' },
    })).toBe('Jeroen Adriaans');
  });

  it('houdt het tijdstip als er geen naam is — ruimte voor een automatische bron', () => {
    expect(formatVehicleLocationUpdate({
      last_known_location: 'Mierlo',
      last_known_location_at: '2026-09-07T14:05:00',
      location_profile: null,
    })).toBe('07-09-2026 14:05');
  });

  it('geeft null als er niets te melden valt, zodat de regel wegblijft', () => {
    expect(formatVehicleLocationUpdate({ last_known_location: 'Mierlo' })).toBeNull();
    expect(formatVehicleLocationUpdate({ last_known_location: null, location_profile: { full_name: 'Jeroen' } })).toBeNull();
    expect(formatVehicleLocationUpdate(null)).toBeNull();
  });
});

describe('vehicleLocationPatch', () => {
  const now = new Date('2026-09-07T14:05:00.000Z');

  it('legt locatie, tijdstip en profiel vast', () => {
    expect(vehicleLocationPatch(' Parkeerterrein Mierlo ', 'profile-1', now)).toEqual({
      last_known_location: 'Parkeerterrein Mierlo',
      last_known_location_at: '2026-09-07T14:05:00.000Z',
      last_known_location_by: 'profile-1',
    });
  });

  it('wist alle drie de velden bij lege invoer — geen datum zonder plek', () => {
    const cleared = {
      last_known_location: null,
      last_known_location_at: null,
      last_known_location_by: null,
    };
    expect(vehicleLocationPatch('', 'profile-1', now)).toEqual(cleared);
    expect(vehicleLocationPatch('    ', 'profile-1', now)).toEqual(cleared);
  });

  it('accepteert een ontbrekend profiel', () => {
    expect(vehicleLocationPatch('Mierlo', undefined, now).last_known_location_by).toBeNull();
  });
});
