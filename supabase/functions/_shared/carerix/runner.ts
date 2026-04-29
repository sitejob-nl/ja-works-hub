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
  CRJob,
  CRMatch,
  CRTodo,
  CRWorkHistory,
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
  crEmployeeAttachmentsQuery,
  crEmployeesQuery,
  crJobsQuery,
  crMatchesQuery,
  crTodosQuery,
  crWorkHistoriesQuery,
  watermarkQualifier,
} from './queries.ts';
import {
  mapCRAttachmentToDocument,
  mapCREmployee,
  mapCRJobToVacancy,
  mapCRMatch,
  mapCRTodoToNote,
  mapCRWorkHistoryToPlacement,
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
  // Set when the cr*Page-query was rejected by Carerix (scope/permission). The
  // worker uses this to mark the entity run as `skipped` instead of silently
  // showing 0 elements as `completed`.
  skipReason?: string;
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

// Result of a CR*-query that may be rejected by the tenant's scope-set.
// On scope-rejection we don't throw — instead we surface the reason so the
// runner can mark the entity as `skipped` with a human-readable explanation.
type QueryResult<T> =
  | { data: T; reason: null }
  | { data: null; reason: string };

async function tryQuery<T>(ctx: RunnerContext, gql: string): Promise<QueryResult<T>> {
  try {
    const data = await ctx.gql.query<T>(gql);
    return { data, reason: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /Cannot query field|FieldUndefined|undefined field|Validation error|GraphQLError.*not allowed|access denied|forbidden|insufficient_scope|403|401/i.test(
        msg,
      )
    ) {
      console.warn(`[carerix] Query rejected (likely scope): ${msg.slice(0, 300)}`);
      return { data: null, reason: msg };
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
  const crResult = await tryQuery<{ crEmployeePage: PageResponse<CREmployee> }>(
    ctx,
    crEmployeesQuery(page, size, watermark),
  );

  if (crResult.data?.crEmployeePage) {
    const pageData = crResult.data.crEmployeePage;
    const stats = emptyStats(pageData.totalElements);
    for (const emp of pageData.items) {
      const payload = mapCREmployee(emp, ctx.organizationId);
      await insertIfNew(ctx, 'candidates', 'candidate', String(emp._id), payload, stats, {
        name: `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim(),
      });
    }
    return stats;
  }
  if (crResult.reason) {
    // CR-query failed (unknown field, scope, etc.) — surface that instead of
    // silently falling back to v1 which hides the actual problem.
    return { ...emptyStats(0), skipReason: crResult.reason };
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
  const result = await tryQuery<{ crJobPage: PageResponse<CRJob> }>(
    ctx,
    crJobsQuery(page, size, watermark),
  );
  if (!result.data?.crJobPage) {
    return { ...emptyStats(0), skipReason: result.reason ?? 'crJobPage onverwachts leeg' };
  }

  const pageData = result.data.crJobPage;
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
  const result = await tryQuery<{ crMatchPage: PageResponse<CRMatch> }>(
    ctx,
    crMatchesQuery(page, size, watermark),
  );
  if (!result.data?.crMatchPage) {
    return { ...emptyStats(0), skipReason: result.reason ?? 'crMatchPage onverwachts leeg' };
  }

  const pageData = result.data.crMatchPage;
  const stats = emptyStats(pageData.totalElements);

  for (const match of pageData.items) {
    const carerixCandidateId = match.toEmployee?._id ? String(match.toEmployee._id) : null;
    const carerixVacancyId = match.toVacancy?._id ? String(match.toVacancy._id) : null;

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

// Placements via crWorkHistoryPage: één CRWorkHistory-record per dienstverband.
export async function runPlacementsPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  const watermark = watermarkQualifier(ctx.modifiedSince);
  const result = await tryQuery<{ crWorkHistoryPage: PageResponse<CRWorkHistory> }>(
    ctx,
    crWorkHistoriesQuery(page, size, watermark),
  );
  if (!result.data?.crWorkHistoryPage) {
    return { ...emptyStats(0), skipReason: result.reason ?? 'crWorkHistoryPage onverwachts leeg' };
  }

  const pageData = result.data.crWorkHistoryPage;
  const stats = emptyStats(pageData.totalElements);

  for (const wh of pageData.items) {
    const carerixCandidateId = wh.toEmployee?._id ? String(wh.toEmployee._id) : null;
    const carerixCompanyId = wh.toCompany?._id ? String(wh.toCompany._id) : null;
    if (!carerixCandidateId || !carerixCompanyId) {
      stats.skipped++;
      continue;
    }

    const candidateId = ctx.idMapper.get('candidate', carerixCandidateId);
    const companyId = ctx.idMapper.get('company', carerixCompanyId);
    if (!candidateId || !companyId) {
      stats.failed++;
      stats.failures.push({
        carerix_id: String(wh._id),
        error: `dependency not imported (candidate=${carerixCandidateId} company=${carerixCompanyId})`,
      });
      continue;
    }

    try {
      const payload = mapCRWorkHistoryToPlacement(wh, candidateId, companyId, ctx.organizationId);
      await insertIfNew(ctx, 'placements', 'placement', String(wh._id), payload, stats);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.failed++;
      stats.failures.push({ carerix_id: String(wh._id), error: msg });
    }
  }
  return stats;
}

// Documenten via per-kandidaat traversal: CRAttachment heeft geen direct
// toEmployee, dus we itereren over de gemapped candidates en halen voor
// elk de attachments op via crEmployee(_id).attachments.
//
// "page" hier is een kandidaat-batch. CANDIDATES_PER_BATCH kandidaten per
// worker-call. Worker self-trigger blijft werken: na batch komt volgende.
const CANDIDATES_PER_BATCH = 25;

export async function runDocumentsPage(
  ctx: RunnerContext,
  page: number,
  _size: number,
): Promise<PageStats> {
  // Haal candidate-mappings op (volgorde op entity_id voor deterministische pagination).
  const offset = page * CANDIDATES_PER_BATCH;
  const { data: mappings, error: mErr } = await ctx.admin
    .from('external_mappings')
    .select('entity_id, external_id')
    .eq('external_system', 'carerix')
    .eq('organization_id', ctx.organizationId)
    .eq('entity_type', 'candidate')
    .order('entity_id', { ascending: true })
    .range(offset, offset + CANDIDATES_PER_BATCH - 1);

  if (mErr) throw new Error(`candidate-mappings ophalen mislukt: ${mErr.message}`);
  if (!mappings || mappings.length === 0) {
    // Geen kandidaten meer — totalElements=0 sluit de runner af.
    return emptyStats(0);
  }

  // We kunnen geen exacte totalElements weten zonder COUNT — we melden het
  // aantal candidate-mappings als pseudo-total om de worker-loop progress te
  // laten tonen. De worker stopt zodra een batch leeg terugkomt.
  const stats = emptyStats(offset + mappings.length + 1); // +1 zorgt dat done pas wordt na lege batch

  for (const m of mappings) {
    const carerixEmployeeId = String(m.external_id);
    const candidateId = String(m.entity_id);

    // Per kandidaat alle attachments ophalen (max 100 per kandidaat — zou ruim
    // moeten zijn). Voor zeer veel attachments per kandidaat kan een 2e
    // GraphQL-call nodig zijn — nu houden we het op één page.
    const result = await tryQuery<{
      crEmployee: { _id: string; attachments?: { items: CRAttachment[]; totalElements: number } } | null;
    }>(ctx, crEmployeeAttachmentsQuery(carerixEmployeeId, 0, 100));

    if (result.reason) {
      stats.failed++;
      stats.failures.push({ carerix_id: carerixEmployeeId, error: result.reason.slice(0, 200) });
      continue;
    }
    const items = result.data?.crEmployee?.attachments?.items ?? [];

    for (const att of items) {
      const payload = mapCRAttachmentToDocument(
        att as CRAttachment & { downloadName?: string; attachmentMimeType?: string; label?: string },
        candidateId,
        ctx.organizationId,
      );
      await insertIfNew(ctx, 'documents', 'document', String(att._id), payload, stats);
    }
  }
  return stats;
}

export async function runNotesPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  if (!ctx.createdByUserId) {
    return {
      ...emptyStats(0),
      skipReason: 'Geen created_by (job zonder user) — notes vereist NOT NULL created_by.',
    };
  }
  const watermark = watermarkQualifier(ctx.modifiedSince);
  const result = await tryQuery<{ crTodoPage: PageResponse<CRTodo> }>(
    ctx,
    crTodosQuery(page, size, watermark),
  );
  if (!result.data?.crTodoPage) {
    return { ...emptyStats(0), skipReason: result.reason ?? 'crTodoPage onverwachts leeg' };
  }

  const pageData = result.data.crTodoPage;
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
  placements: runPlacementsPage, // via crWorkHistoryPage
  documents: runDocumentsPage,   // per-kandidaat via CREmployee.attachments
  notes: runNotesPage,
  // employment is in deze tenant gelijk aan placements (zelfde data via
  // CRWorkHistory) — daarom UNSUPPORTED in types.ts.
};
