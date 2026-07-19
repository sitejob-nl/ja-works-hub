import { describe, expect, it } from 'vitest';
import { EMPTY_MATCH_CONTACT, resolveMatchContact } from '../../supabase/functions/_shared/match-contact';
import { resolveDefaultMatchAssignee, isInternalAssigneeRole } from '@/lib/match-assignee';

const manager = { full_name: 'Bram de Vries', email: 'bram@jawerkt.nl', phone: '+31 6 12345678' };
const org = { name: 'JA Werkt', email: 'info@jawerkt.nl', phone: '+31 40 1234567' };

describe('resolveMatchContact', () => {
  it('toont de accountmanager met naam wanneer die eigen contactgegevens heeft', () => {
    expect(resolveMatchContact({ manager, organization: org })).toEqual({
      manager_name: 'Bram de Vries',
      manager_email: 'bram@jawerkt.nl',
      manager_phone: '+31 6 12345678',
      email_is_personal: true,
      phone_is_personal: true,
    });
  });

  it('valt per kanaal terug op de organisatie en markeert dat kanaal als niet-persoonlijk', () => {
    const contact = resolveMatchContact({
      manager: { full_name: 'Bram de Vries', email: 'bram@jawerkt.nl', phone: null },
      organization: org,
    });
    expect(contact.manager_phone).toBe('+31 40 1234567');
    expect(contact.phone_is_personal).toBe(false);
    expect(contact.email_is_personal).toBe(true);
  });

  it('laat de naam weg als er geen enkel persoonlijk kanaal is', () => {
    const contact = resolveMatchContact({
      manager: { full_name: 'Bram de Vries', email: '  ', phone: null },
      organization: org,
    });
    expect(contact.manager_name).toBeNull();
    expect(contact.manager_email).toBe('info@jawerkt.nl');
    expect(contact.email_is_personal).toBe(false);
  });

  it('geeft niets terug als de contactsectie uit staat', () => {
    expect(resolveMatchContact({ enabled: false, manager, organization: org })).toEqual(EMPTY_MATCH_CONTACT);
  });

  it('geeft niets terug zonder accountmanager en zonder organisatiegegevens', () => {
    expect(resolveMatchContact({ manager: null, organization: { name: 'JA Werkt' } })).toEqual({
      ...EMPTY_MATCH_CONTACT,
      manager_name: null,
    });
  });
});

describe('resolveDefaultMatchAssignee', () => {
  it('kiest de interne gebruiker die de match aanmaakt', () => {
    expect(resolveDefaultMatchAssignee({
      currentUserId: 'user-1',
      currentUserRole: 'intercedent',
      vacancyCreatedBy: 'user-2',
    })).toBe('user-1');
  });

  it('valt terug op de vacature-eigenaar bij een portaalrol (medewerker solliciteert zelf)', () => {
    expect(resolveDefaultMatchAssignee({
      currentUserId: 'medewerker-1',
      currentUserRole: 'medewerker',
      vacancyCreatedBy: 'user-2',
    })).toBe('user-2');
  });

  it('valt terug op de vacature-eigenaar zonder ingelogde gebruiker', () => {
    expect(resolveDefaultMatchAssignee({ vacancyCreatedBy: 'user-2' })).toBe('user-2');
  });

  it('levert null als er niemand toe te wijzen valt', () => {
    expect(resolveDefaultMatchAssignee({ currentUserRole: 'opdrachtgever' })).toBeNull();
  });

  it('sluit portaalrollen uit als accountmanager', () => {
    expect(isInternalAssigneeRole('admin')).toBe(true);
    expect(isInternalAssigneeRole('finance')).toBe(true);
    expect(isInternalAssigneeRole('medewerker')).toBe(false);
    expect(isInternalAssigneeRole('opdrachtgever')).toBe(false);
    expect(isInternalAssigneeRole(null)).toBe(false);
  });
});
