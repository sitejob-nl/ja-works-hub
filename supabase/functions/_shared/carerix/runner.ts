// Per-entity page runners. Each processes ONE page and returns stats.
// v1 public API exposes only companies, contacts, candidates — see SUPPORTED_ENTITIES.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { CarerixGraphQLClient } from './client.ts';
import type { IdMapper } from './id-mapper.ts';
import type {
  CXCandidate,
  CXCompany,
  CXContact,
  EntityName,
  PageResponse,
} from './types.ts';
import { candidatesQuery, companiesQuery, contactsQuery } from './queries.ts';
import { mapCandidate, mapCompany, mapContact } from './mappers.ts';

export interface PageStats {
  totalElements: number;
  created: number;
  skipped: number;
  failed: number;
  failures: Array<{ carerix_id: string; error: string; payload?: unknown }>;
}

export interface RunnerContext {
  admin: SupabaseClient;
  gql: CarerixGraphQLClient;
  idMapper: IdMapper;
  organizationId: string;
  dryRun: boolean;
}

const emptyStats = (total = 0): PageStats => ({
  totalElements: total,
  created: 0,
  skipped: 0,
  failed: 0,
  failures: [],
});

async function insertIfNew<T extends Record<string, unknown>>(
  ctx: RunnerContext,
  table: string,
  entityType: string,
  carerixId: string,
  payload: T,
  stats: PageStats,
  failureMeta?: Record<string, unknown>,
): Promise<string | null> {
  const existing = ctx.idMapper.get(entityType, carerixId);
  if (existing) {
    stats.skipped++;
    return existing;
  }

  if (ctx.dryRun) {
    stats.created++;
    return null;
  }

  try {
    const { data: inserted, error } = await ctx.admin
      .from(table)
      .insert(payload)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const id = inserted.id as string;
    await ctx.idMapper.save(entityType, id, carerixId);
    stats.created++;
    return id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.failed++;
    stats.failures.push({ carerix_id: carerixId, error: msg, payload: failureMeta ?? payload });
    return null;
  }
}

export async function runCompaniesPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  const data = await ctx.gql.query<{ companyPage: PageResponse<CXCompany> }>(companiesQuery(page, size));
  const pageData = data.companyPage;
  const stats = emptyStats(pageData.totalElements);

  for (const company of pageData.items) {
    const payload = mapCompany(company, ctx.organizationId);
    await insertIfNew(ctx, 'companies', 'company', String(company._id), payload, stats, {
      name: company.name,
    });
  }
  return stats;
}

export async function runContactsPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  const data = await ctx.gql.query<{ contactPage: PageResponse<CXContact> }>(contactsQuery(page, size));
  const pageData = data.contactPage;
  const stats = emptyStats(pageData.totalElements);

  for (const contact of pageData.items) {
    const carerixCompanyId = contact.company?._id ? String(contact.company._id) : null;
    if (!carerixCompanyId) {
      // Contact without a company can't be stored — company_id is NOT NULL in JA Werkt.
      stats.skipped++;
      continue;
    }

    const companyJaWerktId = ctx.idMapper.get('company', carerixCompanyId);
    if (!companyJaWerktId) {
      stats.failed++;
      stats.failures.push({
        carerix_id: String(contact._id),
        error: `company ${carerixCompanyId} not yet imported`,
        payload: { carerix_company_id: carerixCompanyId },
      });
      continue;
    }

    const payload = mapContact(contact, companyJaWerktId, ctx.organizationId);
    await insertIfNew(ctx, 'company_contacts', 'contact', String(contact._id), payload, stats, {
      first_name: contact.firstName,
      last_name: contact.lastName,
    });
  }
  return stats;
}

export async function runCandidatesPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  const data = await ctx.gql.query<{ candidatePage: PageResponse<CXCandidate> }>(
    candidatesQuery(page, size),
  );
  const pageData = data.candidatePage;
  const stats = emptyStats(pageData.totalElements);

  for (const candidate of pageData.items) {
    const payload = mapCandidate(candidate, ctx.organizationId);
    await insertIfNew(ctx, 'candidates', 'candidate', String(candidate._id), payload, stats, {
      name: `${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`.trim(),
    });
  }
  return stats;
}

type Runner = (ctx: RunnerContext, page: number, size: number) => Promise<PageStats>;

export const ENTITY_RUNNERS: Partial<Record<EntityName, Runner>> = {
  companies: runCompaniesPage,
  contacts: runContactsPage,
  candidates: runCandidatesPage,
  // documents, employment, vacancies, placements, notes: not available in v1 public API
};
