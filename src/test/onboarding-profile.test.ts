import { beforeEach, describe, expect, it } from 'vitest';
import { saveOnboardingProfile } from '../../supabase/functions/_shared/onboarding-profile';

const token = { organization_id: 'org-a', form_id: 'form-a' };
const definitions = [
  { id: 'phone', maps_to_table: 'candidates', maps_to_column: 'phone', field_type: 'tel' },
  { id: 'city', maps_to_table: 'candidates', maps_to_column: 'address_city', field_type: 'text' },
  { id: 'question', maps_to_table: null, maps_to_column: null, field_type: 'checkbox' },
];
let writes: { table: string; payload: any; filters: unknown[] }[];
let failure: string | null;
let fields: any[];

function client(defaultForm: string | null = 'form-a') {
  return { from(table: string) {
    let write: any = null;
    const filters: unknown[] = [];
    const builder: any = {};
    for (const op of ['select', 'in', 'is', 'single', 'maybeSingle']) builder[op] = () => builder;
    builder.eq = (...args: unknown[]) => { filters.push(args); return builder; };
    for (const op of ['update', 'insert']) builder[op] = (payload: unknown) => {
      write = { table, payload, filters }; writes.push(write); return builder;
    };
    builder.then = (resolve: any, reject: any) => Promise.resolve({
      error: failure === table ? { message: 'simulated database error' } : null,
      data: write ? { id: 'candidate-a' }
        : table === 'onboarding_forms' ? (defaultForm ? { id: defaultForm } : null)
        : table === 'onboarding_form_steps' ? [{ id: 'step-a' }] : fields,
    }).then(resolve, reject);
    return builder;
  } };
}

beforeEach(() => { writes = []; failure = null; fields = definitions; });

describe('onboarding naar kandidaatprofiel', () => {
  it('neemt gekoppelde velden over en bewaart overige antwoorden, tenant-gebonden', async () => {
    await saveOnboardingProfile(client(), token, 'candidate-a', {
      form_id: 'form-a', responses: { phone: ' 0612345678 ', question: 'false', unrelated: 'ignore' },
    });
    expect(writes[0]).toEqual({ table: 'candidates', payload: { phone: '0612345678' },
      filters: [['organization_id', 'org-a'], ['id', 'candidate-a']] });
    expect(writes[1].payload).toEqual([
      expect.objectContaining({ candidate_id: 'candidate-a', organization_id: 'org-a', field_id: 'phone' }),
      expect.objectContaining({ field_id: 'question', value: 'false' }),
    ]);
    expect(writes[0].payload).not.toHaveProperty('address_city');
  });
  it('meldt een mislukte profielwrite en gaat dan niet door met opslaan van antwoorden', async () => {
    failure = 'candidates';
    await expect(saveOnboardingProfile(client(), token, 'candidate-a', { responses: { phone: '0612345678' } }))
      .rejects.toThrow('profielgegevens konden niet worden opgeslagen');
    expect(writes).toHaveLength(1);
  });
  it('meldt een mislukte antwoordenwrite in plaats van succes', async () => {
    failure = 'onboarding_responses';
    await expect(saveOnboardingProfile(client(), token, 'candidate-a', { responses: { question: 'true' } }))
      .rejects.toThrow('formulierantwoorden konden niet worden opgeslagen');
  });
  it('kan via form_id geen ander formulier kiezen', async () => {
    await expect(saveOnboardingProfile(client(), token, 'candidate-a', { form_id: 'other-org-form', responses: {} }))
      .rejects.toThrow('hoort niet bij');
    expect(writes).toEqual([]);
  });
  it('controleert ook de organisatie van het gekoppelde formulier', async () => {
    failure = 'onboarding_forms';
    await expect(saveOnboardingProfile(client(), token, 'candidate-a', { responses: { phone: '123' } }))
      .rejects.toThrow('niet beschikbaar');
    expect(writes).toEqual([]);
  });
  it('gebruikt bij oude links het standaardformulier van de organisatie', async () => {
    await saveOnboardingProfile(client(), { ...token, form_id: null }, 'candidate-a', { form_id: 'form-a', responses: { phone: '123' } });
    expect(writes[0].payload).toEqual({ phone: '123' });
  });
  it('behoudt de oude formulierroute inclusief adrescoördinaten', async () => {
    await saveOnboardingProfile(client(null), { ...token, form_id: null }, 'candidate-a', {
      personal_data: { phone: '123', address_city: 'Eindhoven', address_lat: 51.44, address_lng: 5.48 },
    });
    expect(writes[0].payload).toEqual({ phone: '123', address_city: 'Eindhoven', address_lat: 51.44, address_lng: 5.48 });
  });
  it('weigert een mapping naar administratieve kandidaatvelden', async () => {
    fields = [{ id: 'status', maps_to_table: 'candidates', maps_to_column: 'employee_status', field_type: 'text' }];
    await expect(saveOnboardingProfile(client(), token, 'candidate-a', { responses: { status: 'actief' } }))
      .rejects.toThrow('niet goed gekoppeld');
    expect(writes).toEqual([]);
  });
  it('maakt van ontbrekende geocodes geen (0,0)', async () => {
    await saveOnboardingProfile(client(), token, 'candidate-a', { responses: { city: 'Eindhoven' },
      address_geo: { address_lat: null, address_lng: '' } });
    expect(writes[0].payload).toEqual({ address_city: 'Eindhoven' });
  });
  it('neemt geldige geocodes bij het ingevulde adres mee', async () => {
    await saveOnboardingProfile(client(), token, 'candidate-a', { responses: { city: 'Eindhoven' },
      address_geo: { address_lat: 51.44, address_lng: 5.48 } });
    expect(writes[0].payload).toEqual({ address_city: 'Eindhoven', address_lat: 51.44, address_lng: 5.48 });
  });
});
