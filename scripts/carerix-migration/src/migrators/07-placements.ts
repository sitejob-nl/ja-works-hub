import type { MigrationContext, CRMatch } from '../types/carerix.js';
import { placementStatusMap, mapStatus } from '../lib/status-maps.js';

const ENTITY_TYPE = 'placement';

const FIELDS = `
  _id
  startDate endDate
  hourlyRate
  functionTitle jobTitle
  notes
  statusInfo { value code }
  toEmployee { _id }
  toCompany { _id }
  toPublication { _id }
`;

function buildQuery(pageNumber: number, pageSize: number): string {
  return `query {
    crMatchPage(pageNumber: ${pageNumber}, pageSize: ${pageSize}, showDeletedRecords: false) {
      totalElements
      items { ${FIELDS} }
    }
  }`;
}

function mapToJaWerkt(
  match: CRMatch,
  candidateId: string,
  companyId: string,
  vacancyId: string | null,
  orgId: string,
) {
  const status = mapStatus(placementStatusMap, match.statusInfo?.value, 'afgerond');
  const hourlyRate = match.hourlyRate || 0;
  const functionName = match.functionTitle || match.jobTitle || 'Onbekend';

  return {
    employee_id: candidateId,
    candidate_id: candidateId,
    company_id: companyId,
    vacancy_id: vacancyId,
    start_date: match.startDate || new Date().toISOString().slice(0, 10),
    end_date: match.endDate || null,
    hourly_rate: hourlyRate,
    function_name: functionName,
    status,
    notes: match.notes || null,
    organization_id: orgId,
    compliance_check_passed: false,
  };
}

export async function migratePlacements(ctx: MigrationContext): Promise<void> {
  const { carerixClient, supabase, idMapper, logger, progress, config } = ctx;

  progress.startEntity('placements');
  logger.info('Starting placements migration...');

  let count = 0;

  for await (const match of carerixClient.paginateAll<CRMatch>(
    buildQuery,
    (data) => data.crMatchPage,
  )) {
    count++;
    const carerixId = String(match._id);

    if (idMapper.getJaWerktId(ENTITY_TYPE, carerixId)) {
      progress.recordSkip('placements');
      continue;
    }

    try {
      // Resolve references
      const candidateId = match.toEmployee?._id
        ? idMapper.getJaWerktId('candidate', String(match.toEmployee._id))
        : null;

      const companyId = match.toCompany?._id
        ? idMapper.getJaWerktId('company', String(match.toCompany._id))
        : null;

      const vacancyId = match.toPublication?._id
        ? idMapper.getJaWerktId('vacancy', String(match.toPublication._id))
        : null;

      if (!candidateId) {
        logger.warn(`Match ${carerixId}: candidate ${match.toEmployee?._id} not found, skipping`);
        progress.recordFailure('placements', carerixId, 'Candidate not found in mappings');
        continue;
      }

      if (!companyId) {
        logger.warn(`Match ${carerixId}: company ${match.toCompany?._id} not found, skipping`);
        progress.recordFailure('placements', carerixId, 'Company not found in mappings');
        continue;
      }

      const mapped = mapToJaWerkt(match, candidateId, companyId, vacancyId, config.organizationId);

      if (config.dryRun) {
        logger.debug(`[DRY-RUN] Would create placement: ${mapped.function_name}`, { carerixId });
        progress.recordCreate('placements');
        continue;
      }

      const { data: inserted, error } = await supabase
        .from('placements')
        .insert(mapped)
        .select('id')
        .single();

      if (error) throw new Error(error.message);

      await idMapper.saveMapping(ENTITY_TYPE, inserted.id, carerixId);
      progress.recordCreate('placements');

      logger.debug(`Created placement: ${mapped.function_name}`, { carerixId });
    } catch (err: any) {
      logger.error(`Failed to import placement ${carerixId}`, { error: err.message });
      progress.recordFailure('placements', carerixId, err.message);
    }
  }

  progress.setFound('placements', count);
  progress.endEntity('placements');
  logger.info(`Placements migration complete: ${count} found`);
}
