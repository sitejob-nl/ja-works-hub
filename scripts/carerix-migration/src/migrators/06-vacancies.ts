import type { MigrationContext, CRPublication } from '../types/carerix.js';
import { vacancyStatusMap, mapStatus } from '../lib/status-maps.js';

const ENTITY_TYPE = 'vacancy';

const FIELDS = `
  _id title jobTitle
  description body requirements
  city location
  hourlyRate salary
  publicationStart publicationEnd
  statusInfo { value code }
  toVacancy { _id toCompany { _id } }
  toCompany { _id }
`;

function buildQuery(pageNumber: number, pageSize: number): string {
  return `query {
    crPublicationPage(pageNumber: ${pageNumber}, pageSize: ${pageSize}) {
      totalElements
      items { ${FIELDS} }
    }
  }`;
}

function stripHtml(html: string | undefined | null): string | null {
  if (!html) return null;
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;
}

function mapToJaWerkt(pub: CRPublication, companyId: string | null, orgId: string) {
  const description = stripHtml(pub.description || pub.body);
  const requirements = stripHtml(pub.requirements);
  const fullDescription = [description, requirements ? `\n\nVereisten:\n${requirements}` : null]
    .filter(Boolean)
    .join('') || null;

  const hourlyRate = pub.hourlyRate || (pub.salary ? parseFloat(pub.salary) : null) || 0;
  const status = mapStatus(vacancyStatusMap, pub.statusInfo?.value, 'gesloten');

  return {
    title: pub.title || pub.jobTitle || 'Onbekende vacature',
    description: fullDescription,
    location: pub.city || pub.location || null,
    hourly_rate: hourlyRate,
    status,
    company_id: companyId,
    organization_id: orgId,
  };
}

export async function migrateVacancies(ctx: MigrationContext): Promise<void> {
  const { carerixClient, supabase, idMapper, logger, progress, config } = ctx;

  progress.startEntity('vacancies');
  logger.info('Starting vacancies migration...');

  let count = 0;

  for await (const pub of carerixClient.paginateAll<CRPublication>(
    buildQuery,
    (data) => data.crPublicationPage,
  )) {
    count++;
    const carerixId = String(pub._id);

    if (idMapper.getJaWerktId(ENTITY_TYPE, carerixId)) {
      progress.recordSkip('vacancies');
      continue;
    }

    try {
      // Resolve company
      const companyRef = pub.toCompany?._id || pub.toVacancy?.toCompany?._id;
      const companyId = companyRef ? idMapper.getJaWerktId('company', String(companyRef)) : null;

      const mapped = mapToJaWerkt(pub, companyId, config.organizationId);

      if (config.dryRun) {
        logger.debug(`[DRY-RUN] Would create vacancy: ${mapped.title}`, { carerixId });
        progress.recordCreate('vacancies');
        continue;
      }

      const { data: inserted, error } = await supabase
        .from('vacancies')
        .insert(mapped)
        .select('id')
        .single();

      if (error) throw new Error(error.message);

      await idMapper.saveMapping(ENTITY_TYPE, inserted.id, carerixId);
      progress.recordCreate('vacancies');

      logger.debug(`Created vacancy: ${mapped.title}`, { carerixId });
    } catch (err: any) {
      logger.error(`Failed to import vacancy ${carerixId}`, { error: err.message });
      progress.recordFailure('vacancies', carerixId, err.message, { title: pub.title });
    }
  }

  progress.setFound('vacancies', count);
  progress.endEntity('vacancies');
  logger.info(`Vacancies migration complete: ${count} found`);
}
