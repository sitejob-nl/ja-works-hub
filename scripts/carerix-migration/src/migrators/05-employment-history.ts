import type { MigrationContext, CREmployee, CRWorkHistory } from '../types/carerix.js';

const ENTITY_TYPE = 'employment';

const FIELDS = `
  _id
  workHistories {
    items {
      _id employer jobTitle
      startDate endDate
      contractType notes
    }
  }
`;

function buildQuery(pageNumber: number, pageSize: number): string {
  return `query {
    crEmployeePage(pageNumber: ${pageNumber}, pageSize: ${pageSize}) {
      totalElements
      items { ${FIELDS} }
    }
  }`;
}

function mapToJaWerkt(wh: CRWorkHistory, candidateId: string, orgId: string) {
  const noteParts = [
    wh.employer ? `Werkgever: ${wh.employer}` : null,
    wh.jobTitle ? `Functie: ${wh.jobTitle}` : null,
    wh.notes || null,
  ].filter(Boolean);

  return {
    candidate_id: candidateId,
    start_date: wh.startDate || new Date().toISOString().slice(0, 10),
    end_date: wh.endDate || null,
    contract_type: wh.contractType || null,
    is_current: !wh.endDate,
    notes: noteParts.join('\n') || null,
    organization_id: orgId,
  };
}

export async function migrateEmploymentHistory(ctx: MigrationContext): Promise<void> {
  const { carerixClient, supabase, idMapper, logger, progress, config } = ctx;

  progress.startEntity('employment');
  logger.info('Starting employment history migration...');

  let count = 0;

  for await (const employee of carerixClient.paginateAll<CREmployee>(
    buildQuery,
    (data) => data.crEmployeePage,
  )) {
    const candidateId = idMapper.getJaWerktId('candidate', String(employee._id));
    if (!candidateId) continue;

    const histories = employee.workHistories?.items || [];
    if (histories.length === 0) continue;

    for (const wh of histories) {
      count++;
      const carerixId = String(wh._id);

      if (idMapper.getJaWerktId(ENTITY_TYPE, carerixId)) {
        progress.recordSkip('employment');
        continue;
      }

      try {
        const mapped = mapToJaWerkt(wh, candidateId, config.organizationId);

        if (config.dryRun) {
          logger.debug(`[DRY-RUN] Would create employment: ${wh.employer}`, { carerixId });
          progress.recordCreate('employment');
          continue;
        }

        const { data: inserted, error } = await supabase
          .from('candidate_employment')
          .insert(mapped)
          .select('id')
          .single();

        if (error) throw new Error(error.message);

        await idMapper.saveMapping(ENTITY_TYPE, inserted.id, carerixId);
        progress.recordCreate('employment');

        logger.debug(`Created employment record: ${wh.employer}`, { carerixId });
      } catch (err: any) {
        logger.error(`Failed to import employment ${carerixId}`, { error: err.message });
        progress.recordFailure('employment', carerixId, err.message, wh);
      }
    }
  }

  progress.setFound('employment', count);
  progress.endEntity('employment');
  logger.info(`Employment history migration complete: ${count} found`);
}
