import { createAdminClient, jsonResponse, requireInternalProfile } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPORTS = {
  candidates: 'id, first_name, last_name, email, phone, status, employee_status, date_of_birth, nationality, address_city, address_country, source, created_at, updated_at',
  employees: 'id, candidate_id, employee_number, contract_type, contract_hours, start_date, end_date, status, onboarding_completed, created_at, updated_at',
  companies: 'id, name, email, phone, website, kvk_number, btw_number, legal_form, cao, is_active, address_city, address_country, invoice_email, invoice_company_name, created_at, updated_at',
  placements: 'id, candidate_id, employee_id, company_id, vacancy_id, function_name, start_date, end_date, expected_end_date, status, hourly_rate, client_hourly_rate, work_location, created_at, updated_at',
  timesheets: 'id, employee_id, candidate_id, placement_id, work_date, hours, overtime_hours, hourly_rate, status, source, client_approved, employee_confirmed, created_at, updated_at',
  vacancies: 'id, company_id, title, description, location, status, required_count, filled_count, start_date, end_date, salary_display, urgency, created_at, updated_at',
  properties: 'id, name, address_city, address_country, total_capacity, is_active, has_snf_certificate, has_rental_permit, monthly_rent, created_at, updated_at',
  vehicles: 'id, license_plate, brand, model, year, first_registration, apk_expiry, current_mileage, fuel_type, seats, status, created_at, updated_at',
  communications: 'id, candidate_id, company_id, company_contact_id, channel, direction, subject, email_from, email_to, email_cc, message_type, sent_at, created_at',
  documents: 'id, candidate_id, employee_id, name, type, status, source, issued_date, expiry_date, verified_at, created_at, updated_at',
} as const;

type ExportEntity = keyof typeof EXPORTS;

const isExportEntity = (value: unknown): value is ExportEntity =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(EXPORTS, value);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);

  const auth = await requireInternalProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const { entity } = await req.json().catch(() => ({}));
  if (!isExportEntity(entity)) {
    return jsonResponse({ error: 'Onbekende export-entiteit' }, 400, corsHeaders);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from(entity)
    .select(EXPORTS[entity])
    .eq('organization_id', auth.organizationId)
    .order('created_at', { ascending: false })
    .limit(10_000);

  if (error) return jsonResponse({ error: error.message }, 500, corsHeaders);

  await admin.from('audit_log').insert({
    organization_id: auth.organizationId,
    user_id: auth.userId,
    action: 'export',
    table_name: entity,
    record_id: null,
    new_values: {
      count: data?.length ?? 0,
      columns: EXPORTS[entity].split(',').map((column) => column.trim()),
    },
  });

  return jsonResponse({ rows: data ?? [], entity }, 200, corsHeaders);
});
