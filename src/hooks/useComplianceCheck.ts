import { supabase } from '@/integrations/supabase/client';

/**
 * Soort compliance-probleem. Bepaalt welke actie de UI eraan kan hangen:
 * - `document`  → ontbrekend document, op te lossen met een upload
 * - `field`     → leeg kandidaatveld, op te lossen met een invoerveld
 * - `sensitive` → leeg BSN/IBAN; schrijven gaat via `candidates` (DB-trigger versleutelt)
 * - `blocked`   → wél melden, maar niet ter plekke op te lossen (bijv. verlopen rijbewijs)
 */
export type ComplianceItemKind = 'document' | 'field' | 'sensitive' | 'blocked';

export interface ComplianceItem {
  /** Stabiele sleutel, uniek binnen één resultaat. Bijv. `doc:id_bewijs` of `field:bsn`. */
  code: string;
  /** De Nederlandse melding zoals die in `issues` staat. */
  label: string;
  kind: ComplianceItemKind;
  /** Alleen bij kind 'document': het documenttype dat ontbreekt. */
  docType?: string;
  /** Alleen bij kind 'field' / 'sensitive': de kolom op `candidates`. */
  field?: string;
}

export interface ComplianceResult {
  passed: boolean;
  /**
   * Platte meldingen, één per probleem. Bewust behouden naast `items`: onder meer
   * ComplianceWarningDialog en de override-reden in het audit-log gebruiken deze vorm.
   * Altijd gelijk aan `items.map((i) => i.label)`.
   */
  issues: string[];
  /** Zelfde problemen, maar gestructureerd zodat de UI er een actie aan kan hangen. */
  items: ComplianceItem[];
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
  const items: ComplianceItem[] = [];

  const addDocument = (docType: string, label: string) =>
    items.push({ code: `doc:${docType}`, label, kind: 'document', docType });
  const addField = (field: string, label: string) =>
    items.push({
      code: `field:${field}`,
      label,
      kind: field === 'bsn' || field === 'iban' ? 'sensitive' : 'field',
      field,
    });
  const addBlocked = (code: string, label: string) =>
    items.push({ code: `blocked:${code}`, label, kind: 'blocked' });

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
      .select('first_name, last_name, date_of_birth, nationality, has_drivers_license, drivers_license_expiry, phone, email, address_street, has_dutch_address')
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

    // Check documents (contract wordt altijd onderaan gecheckt — hier overslaan om dubbel te voorkomen)
    for (const docType of requiredDocs) {
      if (docType === 'contract') continue;
      if (docType === 'id_bewijs') {
        const hasValidId = (docs ?? []).some(d => d.type === 'id_bewijs' && d.status !== 'verlopen');
        if (!hasValidId) addDocument(docType, `Geen geldig ${DOC_LABELS[docType] || docType}`);
      } else {
        if (!docTypes.includes(docType as any)) addDocument(docType, `${DOC_LABELS[docType] || docType} ontbreekt`);
      }
    }

    // Check fields
    for (const field of requiredFields) {
      if (!hasSensitiveField(field)) {
        addField(field, `${FIELD_LABELS[field] || field} niet ingevuld`);
      }
    }
  } else {
    // Fallback to hardcoded checks (contract wordt altijd onderaan gecheckt)
    const hasValidId = (docs ?? []).some(d => d.type === 'id_bewijs' && d.status !== 'verlopen');
    const hasReglement = docTypes.includes('reglement');

    if (!hasValidId) addDocument('id_bewijs', 'Geen geldig ID bewijs');
    if (!hasReglement) addDocument('reglement', 'Reglement niet afgetekend');
    if (!hasSensitiveField('bsn')) addField('bsn', 'BSN niet ingevuld');
    if (!hasSensitiveField('iban')) addField('iban', 'IBAN niet ingevuld');
    if (!candidate?.date_of_birth) addField('date_of_birth', 'Geboortedatum ontbreekt');
  }

  // Always: rijbewijs-vervaldatum
  if (candidate?.has_drivers_license && candidate?.drivers_license_expiry) {
    if (new Date(candidate.drivers_license_expiry) < new Date()) {
      addBlocked('drivers_license_expired', 'Rijbewijs is verlopen');
    }
  }

  // Always: Nederlands adres tijdens plaatsing (meeting 17-06) + contract aanwezig.
  if (candidate && (candidate as any).has_dutch_address === false) {
    addBlocked('no_dutch_address', 'Geen Nederlands adres');
  }
  if (!docTypes.includes('contract')) {
    addDocument('contract', 'Contract ontbreekt');
  }

  const issues = items.map((item) => item.label);
  return { passed: items.length === 0, issues, items, rulesApplied };
};
