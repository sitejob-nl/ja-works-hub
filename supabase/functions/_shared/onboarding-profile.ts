// Only self-service profile columns may be written through a public onboarding token.
const PROFILE_COLUMNS = new Set([
  'first_name', 'last_name', 'bsn', 'iban', 'date_of_birth', 'nationality',
  'address_street', 'address_postal', 'address_city', 'address_country', 'phone', 'email',
]);

/** Supabase resolves write failures instead of throwing them. Never report success on one. */
export async function onboardingResult<T>(query: PromiseLike<{ data: T; error: unknown }>, message: string): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(message);
  return data;
}

type TokenContext = { organization_id: string; form_id: string | null };

export async function saveOnboardingProfile(admin: any, token: TokenContext, candidateId: string, body: any) {
  let formId = token.form_id;
  if (!formId) {
    const defaultForm: any = await onboardingResult(admin.from('onboarding_forms')
      .select('id').eq('organization_id', token.organization_id).eq('is_default', true).eq('is_active', true).maybeSingle(),
    'Het onboardingformulier kon niet worden geladen. Probeer het opnieuw.');
    formId = defaultForm?.id ?? null;
  }
  // The submitted form ID is a consistency check, never an authority to select another form.
  if (body.form_id && body.form_id !== formId) throw new Error('Dit formulier hoort niet bij deze onboardinglink. Open de link opnieuw.');

  const updates: Record<string, unknown> = {};
  const inserts: Record<string, unknown>[] = [];
  if (formId && body.responses && typeof body.responses === 'object' && !Array.isArray(body.responses)) {
    const form = await onboardingResult(admin.from('onboarding_forms').select('id')
      .eq('id', formId).eq('organization_id', token.organization_id).single(), 'Het onboardingformulier is niet beschikbaar.');
    if (!form) throw new Error('Het onboardingformulier is niet beschikbaar.');
    const steps: any = await onboardingResult(admin.from('onboarding_form_steps').select('id')
      .eq('form_id', formId).eq('is_active', true), 'De formulierstappen konden niet worden geladen.');
    const stepIds = (steps ?? []).map((s: any) => s.id);
    const fields: any = stepIds.length ? await onboardingResult(admin.from('onboarding_form_fields')
      .select('id, maps_to_table, maps_to_column, field_type').in('step_id', stepIds).eq('is_active', true),
    'De formuliervelden konden niet worden geladen.') : [];
    if (!fields?.length) throw new Error('Dit onboardingformulier heeft geen actieve velden.');

    for (const field of fields) {
      const value = body.responses[field.id];
      if (typeof value !== 'string' || !value.trim() || field.field_type === 'heading') continue;
      if (field.maps_to_table === 'candidates') {
        if (!PROFILE_COLUMNS.has(field.maps_to_column)) throw new Error('Een formulierveld is niet goed gekoppeld. Vraag je contactpersoon om dit te controleren.');
        updates[field.maps_to_column] = value.trim();
      }
      inserts.push({ organization_id: token.organization_id, candidate_id: candidateId, form_id: formId, field_id: field.id, value });
    }
  } else if (!formId && body.personal_data && typeof body.personal_data === 'object') {
    for (const key of PROFILE_COLUMNS) {
      const value = body.personal_data[key];
      if (typeof value === 'string' && value.trim()) updates[key] = value.trim();
    }
  } else {
    throw new Error('De formulierantwoorden ontbreken. Open de onboardinglink opnieuw.');
  }

  const geo = formId ? body.address_geo : body.personal_data;
  // Empty coordinates are not (0,0), and coordinates only belong to a submitted address.
  if (['address_street', 'address_postal', 'address_city'].some((key) => key in updates)
    && typeof geo?.address_lat === 'number' && typeof geo?.address_lng === 'number'
    && Number.isFinite(geo.address_lat) && Math.abs(geo.address_lat) <= 90
    && Number.isFinite(geo.address_lng) && Math.abs(geo.address_lng) <= 180) {
    updates.address_lat = geo.address_lat;
    updates.address_lng = geo.address_lng;
  }

  if (Object.keys(updates).length) {
    await onboardingResult(admin.from('candidates').update(updates)
      .eq('organization_id', token.organization_id).eq('id', candidateId).select('id').single(),
    'Je profielgegevens konden niet worden opgeslagen. Controleer de ingevulde gegevens en probeer het opnieuw.');
  }
  if (inserts.length) {
    await onboardingResult(admin.from('onboarding_responses').insert(inserts),
      'Je formulierantwoorden konden niet worden opgeslagen. Probeer het opnieuw.');
  }
}
