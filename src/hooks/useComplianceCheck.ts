import { supabase } from '@/integrations/supabase/client';

export interface ComplianceResult {
  passed: boolean;
  issues: string[];
}

export const checkCompliance = async (candidateId: string): Promise<ComplianceResult> => {
  const issues: string[] = [];

  // 1. Check documents
  const { data: docs } = await supabase
    .from('documents')
    .select('type, status')
    .eq('candidate_id', candidateId);

  const docTypes = (docs ?? []).map(d => d.type);
  const hasValidId = (docs ?? []).some(d => d.type === 'id_bewijs' && d.status !== 'verlopen');
  const hasContract = docTypes.includes('contract');
  const hasReglement = docTypes.includes('reglement');

  if (!hasValidId) issues.push('Geen geldig ID bewijs');
  if (!hasContract) issues.push('Contract niet getekend');
  if (!hasReglement) issues.push('Reglement niet afgetekend');

  // 2. Check candidate basic data
  const { data: candidate } = await supabase
    .from('candidates')
    .select('first_name, last_name, bsn, iban, date_of_birth, nationality, has_drivers_license, drivers_license_expiry')
    .eq('id', candidateId)
    .single();

  if (!candidate?.bsn) issues.push('BSN niet ingevuld');
  if (!candidate?.iban) issues.push('IBAN niet ingevuld');
  if (!candidate?.date_of_birth) issues.push('Geboortedatum ontbreekt');

  // 3. Check drivers license expiry
  if (candidate?.has_drivers_license && candidate?.drivers_license_expiry) {
    if (new Date(candidate.drivers_license_expiry) < new Date()) {
      issues.push('Rijbewijs is verlopen');
    }
  }

  return { passed: issues.length === 0, issues };
};
