import { describe, expect, it } from 'vitest';
import { bedsOccupiedOn, checkOutDateProblem, defaultCheckOutDate, roomHasFreeBedOn, summarizePropertyOccupancy } from '@/lib/housing-availability';

describe('bedsOccupiedOn', () => {
  it('telt geen bedden in een lege kamer', () => {
    expect(bedsOccupiedOn([], '2026-06-03')).toBe(0);
    expect(bedsOccupiedOn(null, '2026-06-03')).toBe(0);
  });

  it('telt een open-einde bewoner (geen uitcheck) als bezet', () => {
    const a = [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: null }];
    expect(bedsOccupiedOn(a, '2026-06-03')).toBe(1);
    expect(bedsOccupiedOn(a, '2030-01-01')).toBe(1);
  });

  it('komt vrij op/na de uitcheckdatum (grens inclusief op de datum zelf)', () => {
    const a = [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: '2026-07-15' }];
    expect(bedsOccupiedOn(a, '2026-06-20')).toBe(1); // vóór uitcheck → bezet
    expect(bedsOccupiedOn(a, '2026-07-15')).toBe(0); // op uitcheck → vrij
    expect(bedsOccupiedOn(a, '2026-08-01')).toBe(0); // na uitcheck → vrij
  });

  it('telt een toekomstige reservering niet mee voor eerdere datums', () => {
    const a = [{ status: 'gereserveerd', check_in_date: '2026-08-01', check_out_date: null }];
    expect(bedsOccupiedOn(a, '2026-06-03')).toBe(0); // reservering nog niet begonnen → vrij nu
    expect(bedsOccupiedOn(a, '2026-08-01')).toBe(1); // vanaf de reservering → bezet
  });

  it('negeert niet-actieve (historische) toewijzingen', () => {
    const a = [
      { status: 'uitgecheckt', check_in_date: '2026-01-01', check_out_date: '2026-03-01' },
      { status: 'geannuleerd', check_in_date: '2026-02-01', check_out_date: null },
    ];
    expect(bedsOccupiedOn(a, '2026-06-03')).toBe(0);
  });
});

describe('roomHasFreeBedOn', () => {
  it('lege kamer is vrij', () => {
    expect(roomHasFreeBedOn({ capacity: 1, housing_assignments: [] }, '2026-06-03')).toBe(true);
  });

  it('volle capaciteit-1 kamer met open-einde bewoner is niet vrij', () => {
    const unit = { capacity: 1, housing_assignments: [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: null }] };
    expect(roomHasFreeBedOn(unit, '2026-06-03')).toBe(false);
  });

  it('kamer met toekomstige uitcheck is vrij op/na die datum', () => {
    const unit = { capacity: 1, housing_assignments: [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: '2026-07-15' }] };
    expect(roomHasFreeBedOn(unit, '2026-06-20')).toBe(false);
    expect(roomHasFreeBedOn(unit, '2026-07-15')).toBe(true);
  });

  it('deels bezette kamer (capaciteit 2, 1 bewoner) is vrij', () => {
    const unit = { capacity: 2, housing_assignments: [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: null }] };
    expect(roomHasFreeBedOn(unit, '2026-06-03')).toBe(true);
  });

  it('onbekende capaciteit telt als 1 — lege kamer blijft zichtbaar', () => {
    expect(roomHasFreeBedOn({ capacity: null, housing_assignments: [] }, '2026-06-03')).toBe(true);
    const occupied = { capacity: null, housing_assignments: [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: null }] };
    expect(roomHasFreeBedOn(occupied, '2026-06-03')).toBe(false);
  });
});

describe('bedsOccupiedOn — uitgecheckt met een datum', () => {
  const futureCheckOut = [{ status: 'uitgecheckt', check_in_date: '2026-08-01', check_out_date: '2026-09-20' }];

  it('bewoner die op een toekomstige datum is uitgecheckt bezet het bed tot die dag', () => {
    expect(bedsOccupiedOn(futureCheckOut, '2026-09-07')).toBe(1); // vóór de uitcheck → nog bezet
    expect(bedsOccupiedOn(futureCheckOut, '2026-09-19')).toBe(1); // dag ervoor → nog bezet
    expect(bedsOccupiedOn(futureCheckOut, '2026-09-20')).toBe(0); // op de uitcheckdatum → vrij
    expect(bedsOccupiedOn(futureCheckOut, '2026-10-01')).toBe(0); // erna → vrij
  });

  it('een uitcheck in het verleden telt vanaf die datum niet meer mee', () => {
    const past = [{ status: 'uitgecheckt', check_in_date: '2026-08-01', check_out_date: '2026-08-20' }];
    expect(bedsOccupiedOn(past, '2026-08-19')).toBe(1); // historisch: toen wél bezet
    expect(bedsOccupiedOn(past, '2026-08-20')).toBe(0);
    expect(bedsOccupiedOn(past, '2026-09-07')).toBe(0);
  });

  it('uitgecheckt zonder uitcheckdatum (legacy) telt nooit mee', () => {
    expect(bedsOccupiedOn([{ status: 'uitgecheckt', check_in_date: '2026-08-01', check_out_date: null }], '2026-09-07')).toBe(0);
  });

  it('kamer met toekomstige uitcheck komt in de kamerkiezer pas op die datum vrij', () => {
    const unit = { capacity: 1, housing_assignments: futureCheckOut };
    expect(roomHasFreeBedOn(unit, '2026-09-10')).toBe(false);
    expect(roomHasFreeBedOn(unit, '2026-09-20')).toBe(true);
  });
});

describe('summarizePropertyOccupancy', () => {
  const bewoond = { status: 'ingecheckt', check_in_date: '2026-08-01', check_out_date: null };
  const uitgecheckt2009 = { status: 'uitgecheckt', check_in_date: '2026-08-01', check_out_date: '2026-09-20' };

  it('leeg pand telt nergens toe en deelt niet door nul', () => {
    expect(summarizePropertyOccupancy([], '2026-09-07')).toEqual({
      totalCapacity: 0, currentOccupancy: 0, percentage: 0, freeRooms: 0,
    });
    expect(summarizePropertyOccupancy(null, '2026-09-07').percentage).toBe(0);
  });

  it('telt een toekomstige uitcheck als bezet tot de uitcheckdatum', () => {
    const units = [{ capacity: 1, housing_assignments: [uitgecheckt2009] }];
    expect(summarizePropertyOccupancy(units, '2026-09-07')).toEqual({
      totalCapacity: 1, currentOccupancy: 1, percentage: 100, freeRooms: 0,
    });
    // Op de uitcheckdatum zelf is de kamer vrij — zonder handmatige actie.
    expect(summarizePropertyOccupancy(units, '2026-09-20')).toEqual({
      totalCapacity: 1, currentOccupancy: 0, percentage: 0, freeRooms: 1,
    });
  });

  it('een uitcheck in het verleden telt niet meer mee', () => {
    const units = [{ capacity: 1, housing_assignments: [{ status: 'uitgecheckt', check_in_date: '2026-08-01', check_out_date: '2026-08-20' }] }];
    expect(summarizePropertyOccupancy(units, '2026-09-07').currentOccupancy).toBe(0);
    expect(summarizePropertyOccupancy(units, '2026-09-07').freeRooms).toBe(1);
  });

  it('telt reserveringen mee vanaf de incheckdatum, net als de kamerkiezer', () => {
    const units = [{ capacity: 1, housing_assignments: [{ status: 'gereserveerd', check_in_date: '2026-09-20', check_out_date: null }] }];
    expect(summarizePropertyOccupancy(units, '2026-09-07').currentOccupancy).toBe(0);
    expect(summarizePropertyOccupancy(units, '2026-09-20').currentOccupancy).toBe(1);
  });

  it('telt over meerdere kamers en rondt het percentage af', () => {
    const units = [
      { capacity: 2, housing_assignments: [bewoond] },
      { capacity: 1, housing_assignments: [uitgecheckt2009] },
      { capacity: 1, housing_assignments: [] },
    ];
    expect(summarizePropertyOccupancy(units, '2026-09-07')).toEqual({
      totalCapacity: 4, currentOccupancy: 2, percentage: 50, freeRooms: 1,
    });
  });

  it('kamers zonder capaciteit tellen niet als vrije kamer', () => {
    const units = [{ capacity: 0, housing_assignments: [] }];
    expect(summarizePropertyOccupancy(units, '2026-09-07').freeRooms).toBe(0);
  });
});

describe('checkOutDateProblem', () => {
  it('accepteert vandaag, verleden en toekomst zolang het niet vóór de incheck is', () => {
    expect(checkOutDateProblem('2026-09-07', '2026-08-01')).toBeNull();
    expect(checkOutDateProblem('2026-08-20', '2026-08-01')).toBeNull();
    expect(checkOutDateProblem('2027-01-01', '2026-08-01')).toBeNull();
    expect(checkOutDateProblem('2026-08-01', '2026-08-01')).toBeNull(); // dezelfde dag mag
  });

  it('wijst een datum vóór de incheckdatum af', () => {
    expect(checkOutDateProblem('2026-07-31', '2026-08-01')).toBe('De uitcheckdatum kan niet vóór de incheckdatum liggen.');
  });

  it('wijst een lege datum af', () => {
    expect(checkOutDateProblem('', '2026-08-01')).toBe('Kies een uitcheckdatum.');
    expect(checkOutDateProblem(null, '2026-08-01')).toBe('Kies een uitcheckdatum.');
  });

  it('zonder bekende incheckdatum is elke datum goed', () => {
    expect(checkOutDateProblem('2020-01-01', null)).toBeNull();
  });
});

describe('defaultCheckOutDate', () => {
  it('stelt vandaag voor', () => {
    expect(defaultCheckOutDate('2026-08-01', '2026-09-07')).toBe('2026-09-07');
    expect(defaultCheckOutDate(null, '2026-09-07')).toBe('2026-09-07');
  });

  it('valt terug op de incheckdatum als die nog in de toekomst ligt', () => {
    expect(defaultCheckOutDate('2026-10-01', '2026-09-07')).toBe('2026-10-01');
  });
});
