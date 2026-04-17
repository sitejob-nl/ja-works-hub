import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { MigrationContext, CREmployee } from '../types/carerix.js';
import { candidateStatusMap, mapStatus } from '../lib/status-maps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTITY_TYPE = 'candidate';

const FIELDS = `
  _id employeeID
  firstName middleName lastName initials
  emailAddress phoneNumber mobileNumber
  dateOfBirth gender nationality
  socialSecurityNumber iban bankAccountNumber
  street houseNumber postalCode city country
  notes memo
  additionalInfo
  statusInfo { value code }
`;

function buildQuery(pageNumber: number, pageSize: number): string {
  return `query {
    crEmployeePage(pageNumber: ${pageNumber}, pageSize: ${pageSize}) {
      totalElements
      items { ${FIELDS} }
    }
  }`;
}

// Load custom field mappings if they exist
function loadFieldMappings(): Record<string, { target: string; transform: string }> {
  const path = resolve(__dirname, '..', '..', 'field-mappings.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function mapGender(g: string | undefined | null): string | null {
  if (!g) return null;
  const lower = g.toLowerCase();
  if (lower === 'm' || lower === 'male' || lower === 'man') return 'man';
  if (lower === 'v' || lower === 'f' || lower === 'female' || lower === 'vrouw') return 'vrouw';
  return 'anders';
}

function mapToJaWerkt(
  employee: CREmployee,
  orgId: string,
  fieldMappings: Record<string, { target: string; transform: string }>,
) {
  const street = [employee.street, employee.houseNumber].filter(Boolean).join(' ');
  const phone = employee.mobileNumber || employee.phoneNumber || null;
  const status = mapStatus(candidateStatusMap, employee.statusInfo?.value, 'nieuw');
  const notes = [employee.notes, employee.memo].filter(Boolean).join('\n\n') || null;

  const record: Record<string, any> = {
    first_name: employee.firstName || 'Onbekend',
    last_name: employee.lastName || 'Onbekend',
    middle_name: employee.middleName || null,
    initials: employee.initials || null,
    employee_number: employee.employeeID || null,
    email: employee.emailAddress || null,
    phone,
    date_of_birth: employee.dateOfBirth || null,
    gender: mapGender(employee.gender),
    nationality: employee.nationality || null,
    bsn: employee.socialSecurityNumber || null,
    iban: employee.iban || employee.bankAccountNumber || null,
    address_street: street || null,
    address_postal: employee.postalCode || null,
    address_city: employee.city || null,
    address_country: employee.country || null,
    notes,
    status,
    source: 'carerix',
    compliance_status: 'incompleet',
    organization_id: orgId,
  };

  // Apply custom field mappings from additionalInfo
  if (employee.additionalInfo && Object.keys(fieldMappings).length > 0) {
    for (const [key, mapping] of Object.entries(fieldMappings)) {
      const value = employee.additionalInfo[key];
      if (value !== undefined && value !== null && value !== '') {
        if (mapping.transform === 'boolean') {
          record[mapping.target] = Boolean(value);
        } else {
          record[mapping.target] = String(value);
        }
      }
    }
  }

  return record;
}

export async function migrateCandidates(ctx: MigrationContext): Promise<void> {
  const { carerixClient, supabase, idMapper, logger, progress, config } = ctx;

  progress.startEntity('candidates');
  logger.info('Starting candidates migration...');

  const fieldMappings = loadFieldMappings();
  if (Object.keys(fieldMappings).length > 0) {
    logger.info(`Loaded ${Object.keys(fieldMappings).length} custom field mappings`);
  }

  let count = 0;

  for await (const employee of carerixClient.paginateAll<CREmployee>(
    buildQuery,
    (data) => data.crEmployeePage,
  )) {
    count++;
    const carerixId = String(employee._id);

    if (idMapper.getJaWerktId(ENTITY_TYPE, carerixId)) {
      progress.recordSkip('candidates');
      continue;
    }

    try {
      const mapped = mapToJaWerkt(employee, config.organizationId, fieldMappings);

      if (config.dryRun) {
        logger.debug(`[DRY-RUN] Would create candidate: ${mapped.first_name} ${mapped.last_name}`, { carerixId });
        progress.recordCreate('candidates');
        continue;
      }

      const { data: inserted, error } = await supabase
        .from('candidates')
        .insert(mapped)
        .select('id')
        .single();

      if (error) throw new Error(error.message);

      await idMapper.saveMapping(ENTITY_TYPE, inserted.id, carerixId);
      progress.recordCreate('candidates');

      logger.debug(`Created candidate: ${mapped.first_name} ${mapped.last_name}`, { carerixId, jaWerktId: inserted.id });
    } catch (err: any) {
      logger.error(`Failed to import candidate ${carerixId}`, { error: err.message });
      progress.recordFailure('candidates', carerixId, err.message, {
        name: `${employee.firstName} ${employee.lastName}`,
      });
    }
  }

  progress.setFound('candidates', count);
  progress.endEntity('candidates');
  logger.info(`Candidates migration complete: ${count} found`);
}
