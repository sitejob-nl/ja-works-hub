import type { MigrationContext, CRCompany } from '../types/carerix.js';

const ENTITY_TYPE = 'company';

const FIELDS = `
  _id name displayName
  kvkNumber btwNumber vatNumber
  emailAddress phoneNumber website
  street houseNumber postalCode city country
  notes memo
`;

function buildQuery(pageNumber: number, pageSize: number): string {
  return `query {
    crCompanyPage(pageNumber: ${pageNumber}, pageSize: ${pageSize}) {
      totalElements
      items { ${FIELDS} }
    }
  }`;
}

function mapToJaWerkt(company: CRCompany, orgId: string) {
  const street = [company.street, company.houseNumber].filter(Boolean).join(' ');

  return {
    name: company.name || company.displayName || 'Onbekend bedrijf',
    kvk_number: company.kvkNumber || null,
    btw_number: company.btwNumber || company.vatNumber || null,
    email: company.emailAddress || null,
    phone: company.phoneNumber || null,
    website: company.website || null,
    address_street: street || null,
    address_postal: company.postalCode || null,
    address_city: company.city || null,
    address_country: company.country || null,
    notes: [company.notes, company.memo].filter(Boolean).join('\n\n') || null,
    organization_id: orgId,
    is_active: true,
  };
}

export async function migrateCompanies(ctx: MigrationContext): Promise<void> {
  const { carerixClient, supabase, idMapper, logger, progress, config } = ctx;

  progress.startEntity('companies');
  logger.info('Starting companies migration...');

  let count = 0;

  for await (const company of carerixClient.paginateAll<CRCompany>(
    buildQuery,
    (data) => data.crCompanyPage,
  )) {
    count++;
    const carerixId = String(company._id);

    // Idempotency check
    if (idMapper.getJaWerktId(ENTITY_TYPE, carerixId)) {
      progress.recordSkip('companies');
      continue;
    }

    try {
      const mapped = mapToJaWerkt(company, config.organizationId);

      if (config.dryRun) {
        logger.debug(`[DRY-RUN] Would create company: ${mapped.name}`, { carerixId });
        progress.recordCreate('companies');
        continue;
      }

      const { data: inserted, error } = await supabase
        .from('companies')
        .insert(mapped)
        .select('id')
        .single();

      if (error) throw new Error(error.message);

      await idMapper.saveMapping(ENTITY_TYPE, inserted.id, carerixId);
      progress.recordCreate('companies');

      logger.debug(`Created company: ${mapped.name}`, { carerixId, jaWerktId: inserted.id });
    } catch (err: any) {
      logger.error(`Failed to import company ${carerixId}`, { error: err.message, company });
      progress.recordFailure('companies', carerixId, err.message, company);
    }
  }

  progress.setFound('companies', count);
  progress.endEntity('companies');
  logger.info(`Companies migration complete: ${count} found`);
}
