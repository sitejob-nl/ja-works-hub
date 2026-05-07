import { supabase } from '@/integrations/supabase/client';

export interface ComplianceResult {
  passed: boolean;
  issues: string[];
  rulesApplied: string;
}

const FIELD_LABELS: Record<string, string> = {
  bsn: 'BSN',
  iban: 'IBAN',
  date_of_birth: 'Geboortedatum',
  nationality: 'Nationaliteit',
  address_street: 'Adres',
  phone: 'Telefoon',
  email: 'E-mail',
};

const DOC_LABELS: Record<string, string> = {
  id_bewijs: 'ID Bewijs',
  contract: 'Contract',
  reglement: 'Reglement',
  rijbewijs: 'Rijbewijs',
  vca: 'VCA',
  overig: 'Overig document',
  cv: 'CV',
  pasfoto: 'Pasfoto',
  onboarding_formulier: 'Onboarding-formulier',
  diploma: 'Diploma',
  werkfoto: 'Werkfoto',
  certificaat: 'Certificaat',
  bankbewijs: 'Bankbewijs',
  loonstrook: 'Loonstrook',
  jaaropgave: 'Jaaropgave',
  urenbrief: 'Urenbrief',
};

export const checkCompliance = async (
  candidateId: string,
  options?: { sector?: string; contractType?: string }
): Promise<ComplianceResult> => {
  const issues: string[] = [];

  // 1. Try to load dynamic rules
  let rulesApplied = 'standaard';
  const query = supabase.from('compliance_rules' as any).select('*').eq('is_active', true);

  const { data: allRules } = await query;
  const rules = (allRules as any[] || []).filter((r: any) => {
    if (options?.sector && r.sector && r.sector !== options.sector) return false;
    if (options?.contractType && r.contract_type && r.contract_type !== options.contractType) return false;
    if (!options?.sector && r.sector) return false;
    if (!options?.contractType && r.contract_type) return false;
    return true;
  });

  // Also include rules with no sector/contract_type (global rules)
  const globalRules = (allRules as any[] || []).filter((r: any) => !r.sector && !r.contract_type);
  const applicableRules = [...new Map([...globalRules, ...rules].map(r => [r.id, r])).values()];

  // 2. Get candidate + docs
  const [{ data: candidate }, { data: docs }, { data: sensitiveData }] = await Promise.all([
    supabase.from('candidates')
      .select('first_name, last_name, date_of_birth, nationality, has_drivers_license, drivers_license_expiry, phone, email, address_street')
      .eq('id', candidateId)
      .single(),
    supabase.from('documents')
      .select('type, status')
      .eq('candidate_id', candidateId),
    supabase.rpc('get_candidate_decrypted', { p_candidate_id: candidateId } as any),
  ]);

  const docTypes = (docs ?? []).map(d => d.type);
  const sensitive = Array.isArray(sensitiveData) ? sensitiveData[0] : sensitiveData;
  const hasSensitiveField = (field: string) => {
    if (field === 'bsn') return Boolean((sensitive as any)?.decrypted_bsn);
    if (field === 'iban') return Boolean((sensitive as any)?.decrypted_iban);
    return Boolean(candidate && (candidate as any)[field]);
  };

  if (applicableRules.length > 0) {
    // Use dynamic rules
    rulesApplied = applicableRules.map((r: any) => r.name).join(', ');

    const requiredDocs = new Set<string>();
    const requiredFields = new Set<string>();

    for (const rule of applicableRules) {
      (rule.required_documents || []).forEach((d: string) => requiredDocs.add(d));
      (rule.required_fields || []).forEach((f: string) => requiredFields.add(f));
    }

    // Check documents
    for (const docType of requiredDocs) {
      if (docType === 'id_bewijs') {
        const hasValidId = (docs ?? []).some(d => d.type === 'id_bewijs' && d.status !== 'verlopen');
        if (!hasValidId) issues.push(`Geen geldig ${DOC_LABELS[docType] || docType}`);
      } else {
        if (!docTypes.includes(docType as any)) issues.push(`${DOC_LABELS[docType] || docType} ontbreekt`);
      }
    }

    // Check fields
    for (const field of requiredFields) {
      if (!hasSensitiveField(field)) {
        issues.push(`${FIELD_LABELS[field] || field} niet ingevuld`);
      }
    }
  } else {
    // Fallback to hardcoded checks
    const hasValidId = (docs ?? []).some(d => d.type === 'id_bewijs' && d.status !== 'verlopen');
    const hasContract = docTypes.includes('contract');
    const hasReglement = docTypes.includes('reglement');

    if (!hasValidId) issues.push('Geen geldig ID bewijs');
    if (!hasContract) issues.push('Contract niet getekend');
    if (!hasReglement) issues.push('Reglement niet afgetekend');
    if (!hasSensitiveField('bsn')) issues.push('BSN niet ingevuld');
    if (!hasSensitiveField('iban')) issues.push('IBAN niet ingevuld');
    if (!candidate?.date_of_birth) issues.push('Geboortedatum ontbreekt');
  }

  // Always check drivers license expiry
  if (candidate?.has_drivers_license && candidate?.drivers_license_expiry) {
    if (new Date(candidate.drivers_license_expiry) < new Date()) {
      issues.push('Rijbewijs is verlopen');
    }
  }

  return { passed: issues.length === 0, issues, rulesApplied };
};
