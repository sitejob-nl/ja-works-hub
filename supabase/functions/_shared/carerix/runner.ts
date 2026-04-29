// Per-entity page runners. Each processes ONE page and returns stats.
//
// Runners cover both schemas:
//   v1 (companies/contacts/candidates/vacancies-v1) — minimal, always available
//     when basic core:data scopes are granted.
//   CR* (matches/placements/documents/notes + richer vacancies) — require
//     `urn:cx/cx5Wrapper:data:manage`-equivalent scope. Runners catch GraphQL
//     "field not found" / "access denied" errors and mark the entity skipped
//     instead of failing the whole job.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { CarerixGraphQLClient } from './client.ts';
import type { IdMapper } from './id-mapper.ts';
import type {
  CRAttachment,
  CREmployee,
  CREmployment,
  CRJob,
  CRMatch,
  CRTodo,
  CXCandidate,
  CXCompany,
  CXContact,
  EntityName,
  PageResponse,
} from './types.ts';
import {
  candidatesQuery,
  companiesQuery,
  contactsQuery,
  crAttachmentsQuery,
  crEmployeesQuery,
  crEmploymentsQuery,
  crJobsQuery,
  crMatchesQuery,
  crTodosQuery,
  watermarkQualifier,
} from './queries.ts';
import {
  mapCRAttachmentMetadata,
  mapCREmployee,
  mapCREmployment,
  mapCRJobToVacancy,
  mapCRMatch,
  mapCRTodoToNote,
  mapCandidate,
  mapCompany,
  mapContact,
} from './mappers.ts';

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
  modifiedSince?: string | null;
  createdByUserId?: string | null;
}

const emptyStats = (total = 0): PageStats => ({
  totalElements: total,
  created: 0,
  skipped: 0,
  failed: 0,
  failures: [],
});

// Wraps a query that may not be available in the tenant's scope.
// Returns null if the schema rejects the query (so the runner can mark "skipped"
// without failing the job).
async function queryOrNull<T>(
  ctx: RunnerContext,
  gql: string,
): Promise<T | null> {
  try {
    return await ctx.gql.query<T>(gql);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // GraphQL schema rejection signals: field not found / not queryable / forbidden / 403.
    if (
      /Cannot query field|FieldUndefined|undefined field|Validation error|GraphQLError.*not allowed|access denied|forbidden|insufficient_scope|403|401/i.test(
        msg,
      )
    ) {
      return null;
    }
    throw err;
  }
}

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

// =====================================================================
// v1 runners (existing — kept for tenants without cx5Wrapper scope)
// =====================================================================

export async function runCompaniesPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  const data = await ctx.gql.query<{ companyPage: PageResponse<CXCompany> }>(
    companiesQuery(page, size),
  );
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
  const data = await ctx.gql.query<{ contactPage: PageResponse<CXContact> }>(
    contactsQuery(page, size),
  );
  const pageData = data.contactPage;
  const stats = emptyStats(pageData.totalElements);

  for (const contact of pageData.items) {
    const carerixCompanyId = contact.company?._id ? String(contact.company._id) : null;
    if (!carerixCompanyId) {
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
  // Try the rich CR-schema first; fall back to the v1 candidatePage if scope
  // doesn't allow CR* — both populate the same `candidate` mapping in idMapper.
  const watermark = watermarkQualifier(ctx.modifiedSince);
  const crData = await queryOrNull<{ crEmployeePage: PageResponse<CREmployee> }>(
    ctx,
    crEmployeesQuery(page, size, watermark),
  );

  if (crData?.crEmployeePage) {
    const pageData = crData.crEmployeePage;
    const stats = emptyStats(pageData.totalElements);
    for (const emp of pageData.items) {
      const payload = mapCREmployee(emp, ctx.organizationId);
      await insertIfNew(ctx, 'candidates', 'candidate', String(emp._id), payload, stats, {
        name: `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim(),
      });
    }
    return stats;
  }

  // Fallback to v1.
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

// =====================================================================
// CR* runners — new
// =====================================================================

export async function runVacanciesPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  const watermark = watermarkQualifier(ctx.modifiedSince);
  const data = await queryOrNull<{ crJobPage: PageResponse<CRJob> }>(
    ctx,
    crJobsQuery(page, size, watermark),
  );
  if (!data?.crJobPage) {
    // Mark as skipped — caller treats null as no work (totalElements=0 finishes the entity).
    return emptyStats(0);
  }

  const pageData = data.crJobPage;
  const stats = emptyStats(pageData.totalElements);

  for (const job of pageData.items) {
    const carerixCompanyId = job.toCompany?._id ? String(job.toCompany._id) : null;
    if (!carerixCompanyId) {
      stats.skipped++;
      continue;
    }
    const companyId = ctx.idMapper.get('company', carerixCompanyId);
    if (!companyId) {
      stats.failed++;
      stats.failures.push({
        carerix_id: String(job._id),
        error: `company ${carerixCompanyId} not yet imported`,
      });
      continue;
    }

    const payload = mapCRJobToVacancy(job, companyId, ctx.organizationId);
    await insertIfNew(ctx, 'vacancies', 'vacancy', String(job._id), payload, stats, {
      title: job.title,
    });
  }
  return stats;
}

export async function runMatchesPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  const watermark = watermarkQualifier(ctx.modifiedSince);
  const data = await queryOrNull<{ crMatchPage: PageResponse<CRMatch> }>(
    ctx,
    crMatchesQuery(page, size, watermark),
  );
  if (!data?.crMatchPage) return emptyStats(0);

  const pageData = data.crMatchPage;
  const stats = emptyStats(pageData.totalElements);

  for (const match of pageData.items) {
    const carerixCandidateId = match.toEmployee?._id ? String(match.toEmployee._id) : null;
    // Vacancy ref can be either toPublication or toJob — try both.
    const carerixVacancyId =
      (match.toPublication?._id && String(match.toPublication._id)) ||
      (match.toJob?._id && String(match.toJob._id)) ||
      null;

    if (!carerixCandidateId || !carerixVacancyId) {
      stats.skipped++;
      continue;
    }

    const candidateId = ctx.idMapper.get('candidate', carerixCandidateId);
    const vacancyId = ctx.idMapper.get('vacancy', carerixVacancyId);
    if (!candidateId || !vacancyId) {
      stats.failed++;
      stats.failures.push({
        carerix_id: String(match._id),
        error: `dependency not imported (candidate=${carerixCandidateId} vacancy=${carerixVacancyId})`,
      });
      continue;
    }

    const payload = mapCRMatch(match, candidateId, vacancyId, ctx.organizationId);
    await insertIfNew(ctx, 'matches', 'match', String(match._id), payload, stats);
  }
  return stats;
}

export async function runPlacementsPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  const watermark = watermarkQualifier(ctx.modifiedSince);
  const data = await queryOrNull<{ crEmploymentPage: PageResponse<CREmployment> }>(
    ctx,
    crEmploymentsQuery(page, size, watermark),
  );
  if (!data?.crEmploymentPage) return emptyStats(0);

  const pageData = data.crEmploymentPage;
  const stats = emptyStats(pageData.totalElements);

  for (const emp of pageData.items) {
    const carerixCandidateId = emp.toEmployee?._id ? String(emp.toEmployee._id) : null;
    const carerixCompanyId = emp.toCompany?._id ? String(emp.toCompany._id) : null;
    const carerixVacancyId =
      (emp.toJob?._id && String(emp.toJob._id)) ||
      (emp.toPublication?._id && String(emp.toPublication._id)) ||
      null;
    const carerixMatchId = emp.toMatch?._id ? String(emp.toMatch._id) : null;

    if (!carerixCandidateId || !carerixCompanyId) {
      stats.skipped++;
      continue;
    }

    const candidateId = ctx.idMapper.get('candidate', carerixCandidateId);
    const companyId = ctx.idMapper.get('company', carerixCompanyId);
    if (!candidateId || !companyId) {
      stats.failed++;
      stats.failures.push({
        carerix_id: String(emp._id),
        error: `dependency not imported (candidate=${carerixCandidateId} company=${carerixCompanyId})`,
      });
      continue;
    }
    const vacancyId = carerixVacancyId ? ctx.idMapper.get('vacancy', carerixVacancyId) : null;
    const matchId = carerixMatchId ? ctx.idMapper.get('match', carerixMatchId) : null;

    try {
      const payload = mapCREmployment(
        emp,
        candidateId,
        companyId,
        ctx.organizationId,
        vacancyId ?? undefined,
        matchId ?? undefined,
      );
      await insertIfNew(ctx, 'placements', 'placement', String(emp._id), payload, stats);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.failed++;
      stats.failures.push({ carerix_id: String(emp._id), error: msg });
    }
  }
  return stats;
}

export async function runDocumentsPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  const watermark = watermarkQualifier(ctx.modifiedSince);
  const data = await queryOrNull<{ crAttachmentPage: PageResponse<CRAttachment> }>(
    ctx,
    crAttachmentsQuery(page, size, watermark),
  );
  if (!data?.crAttachmentPage) return emptyStats(0);

  const pageData = data.crAttachmentPage;
  const stats = emptyStats(pageData.totalElements);

  for (const att of pageData.items) {
    const carerixCandidateId = att.toEmployee?._id ? String(att.toEmployee._id) : null;
    if (!carerixCandidateId) {
      // Attachment hangs off a non-candidate (company logo etc.) — skip for now.
      stats.skipped++;
      continue;
    }
    const candidateId = ctx.idMapper.get('candidate', carerixCandidateId);
    if (!candidateId) {
      stats.failed++;
      stats.failures.push({
        carerix_id: String(att._id),
        error: `candidate ${carerixCandidateId} not yet imported`,
      });
      continue;
    }

    const payload = mapCRAttachmentMetadata(att, candidateId, ctx.organizationId);
    await insertIfNew(ctx, 'documents', 'document', String(att._id), payload, stats, {
      file_name: att.fileName,
      tag: att.tag,
    });
  }
  return stats;
}

export async function runNotesPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  if (!ctx.createdByUserId) {
    // Without a created_by we can't insert into `notes` (NOT NULL).
    return emptyStats(0);
  }
  const watermark = watermarkQualifier(ctx.modifiedSince);
  const data = await queryOrNull<{ crTodoPage: PageResponse<CRTodo> }>(
    ctx,
    crTodosQuery(page, size, watermark),
  );
  if (!data?.crTodoPage) return emptyStats(0);

  const pageData = data.crTodoPage;
  const stats = emptyStats(pageData.totalElements);

  for (const todo of pageData.items) {
    // Resolve relation: candidate first, then company.
    const carerixCandidateId = todo.toEmployee?._id ? String(todo.toEmployee._id) : null;
    const carerixCompanyId = todo.toCompany?._id ? String(todo.toCompany._id) : null;

    let relatedEntityId: string | null = null;
    let relatedEntityType: string | null = null;
    if (carerixCandidateId) {
      const id = ctx.idMapper.get('candidate', carerixCandidateId);
      if (id) {
        relatedEntityId = id;
        relatedEntityType = 'candidate';
      }
    }
    if (!relatedEntityId && carerixCompanyId) {
      const id = ctx.idMapper.get('company', carerixCompanyId);
      if (id) {
        relatedEntityId = id;
        relatedEntityType = 'company';
      }
    }
    if (!relatedEntityId || !relatedEntityType) {
      stats.skipped++;
      continue;
    }

    const payload = mapCRTodoToNote(
      todo,
      relatedEntityId,
      relatedEntityType,
      ctx.createdByUserId,
      ctx.organizationId,
    );
    if (!payload) {
      stats.skipped++;
      continue;
    }
    await insertIfNew(ctx, 'notes', 'note', String(todo._id), payload, stats);
  }
  return stats;
}

type Runner = (ctx: RunnerContext, page: number, size: number) => Promise<PageStats>;

export const ENTITY_RUNNERS: Partial<Record<EntityName, Runner>> = {
  companies: runCompaniesPage,
  contacts: runContactsPage,
  candidates: runCandidatesPage,
  vacancies: runVacanciesPage,
  matches: runMatchesPage,
  placements: runPlacementsPage,
  documents: runDocumentsPage,
  notes: runNotesPage,
  // employment: no target table — see UNSUPPORTED_REASONS.
};
