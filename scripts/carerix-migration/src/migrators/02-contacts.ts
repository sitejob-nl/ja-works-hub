import type { MigrationContext, CRCompany, CRContact } from '../types/carerix.js';

const ENTITY_TYPE = 'contact';

const FIELDS = `
  _id name
  contacts {
    items {
      _id firstName lastName
      emailAddress phoneNumber mobileNumber
      jobTitle functionTitle
    }
  }
`;

function buildQuery(pageNumber: number, pageSize: number): string {
  return `query {
    crCompanyPage(pageNumber: ${pageNumber}, pageSize: ${pageSize}) {
      totalElements
      items { ${FIELDS} }
    }
  }`;
}

function mapToJaWerkt(contact: CRContact, companyId: string, orgId: string) {
  return {
    company_id: companyId,
    first_name: contact.firstName || null,
    last_name: contact.lastName || null,
    email: contact.emailAddress || null,
    phone: contact.mobileNumber || contact.phoneNumber || null,
    function_title: contact.jobTitle || contact.functionTitle || null,
    organization_id: orgId,
    is_active: true,
  };
}

export async function migrateContacts(ctx: MigrationContext): Promise<void> {
  const { carerixClient, supabase, idMapper, logger, progress, config } = ctx;

  progress.startEntity('contacts');
  logger.info('Starting contacts migration...');

  let count = 0;

  // Iterate through companies and their nested contacts
  for await (const company of carerixClient.paginateAll<CRCompany>(
    buildQuery,
    (data) => data.crCompanyPage,
  )) {
    const companyId = idMapper.getJaWerktId('company', String(company._id));
    if (!companyId) {
      logger.warn(`Company ${company._id} (${company.name}) not found in mappings, skipping contacts`);
      continue;
    }

    const contacts = company.contacts?.items || [];

    for (const contact of contacts) {
      count++;
      const carerixId = String(contact._id);

      if (idMapper.getJaWerktId(ENTITY_TYPE, carerixId)) {
        progress.recordSkip('contacts');
        continue;
      }

      try {
        const mapped = mapToJaWerkt(contact, companyId, config.organizationId);

        if (config.dryRun) {
          logger.debug(`[DRY-RUN] Would create contact: ${mapped.first_name} ${mapped.last_name}`, { carerixId });
          progress.recordCreate('contacts');
          continue;
        }

        const { data: inserted, error } = await supabase
          .from('company_contacts')
          .insert(mapped)
          .select('id')
          .single();

        if (error) throw new Error(error.message);

        await idMapper.saveMapping(ENTITY_TYPE, inserted.id, carerixId);
        progress.recordCreate('contacts');

        logger.debug(`Created contact: ${mapped.first_name} ${mapped.last_name}`, { carerixId });
      } catch (err: any) {
        logger.error(`Failed to import contact ${carerixId}`, { error: err.message });
        progress.recordFailure('contacts', carerixId, err.message, contact);
      }
    }
  }

  progress.setFound('contacts', count);
  progress.endEntity('contacts');
  logger.info(`Contacts migration complete: ${count} found`);
}
