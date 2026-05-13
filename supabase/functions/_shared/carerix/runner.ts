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
  crPlacementJobsQuery,
  crTodosQuery,
  watermarkQualifier,
} from './queries.ts';
import {
  mapCRAttachmentToDocument,
  mapCREmployee,
  mapCRJobToVacancy,
  mapCRJobToPlacement,
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
  // Set when the cr*Page-query was rejected (scope/permission). Worker marks
  // the entity run as `skipped`.
  skipReason?: string;
  // Set when this page is the last one — runner signals this explicitly so the
  // worker doesn't have to guess based on page-size arithmetic. Different
  // runners (page-based vs candidate-batch-based) need different stop-conditions.
  done?: boolean;
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

// Helper: marks `stats.done` based on Carerix' `last` flag on the page response.
// Runners signal explicitly when their last page is processed so the worker
// doesn't need to guess based on page-size arithmetic.
function markDone<T>(stats: PageStats, pageData: { last?: boolean; items: T[] }): void {
  stats.done = pageData.last === true || pageData.items.length === 0;
}

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

// Bulk-enrich helper voor bestaande candidates: één SELECT voor de hele
// page, daarna parallel UPDATE-calls (Promise.all) voor candidates die echt
// een NULL-veld hebben dat we kunnen vullen. Veel sneller dan per-candidate
// SELECT+UPDATE — voorkomt soft-deadline timeouts.
const ENRICH_FIELDS = [
  'email',
  'phone',
  'date_of_birth',
  'address_street',
  'address_city',
  'address_postal',
];

async function bulkEnrichCandidates(
  ctx: RunnerContext,
  items: Array<{ candidateId: string; payload: Record<string, unknown> }>,
  stats: PageStats,
): Promise<void> {
  if (items.length === 0) return;
  if (ctx.dryRun) {
    stats.skipped += items.length;
    return;
  }

  const ids = items.map((i) => i.candidateId);
  const { data: existing, error: selErr } = await ctx.admin
    .from('candidates')
    .select(`id,${ENRICH_FIELDS.join(',')}`)
    .in('id', ids);

  if (selErr || !existing) {
    stats.skipped += items.length;
    return;
  }

  const existingRows = existing as unknown as Array<Record<string, unknown>>;
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of existingRows) {
    if (typeof row.id === 'string') byId.set(row.id, row);
  }

  const updatePromises: PromiseLike<{ candidateId: string; error: string | null }>[] = [];
  for (const item of items) {
    const current = byId.get(item.candidateId);
    if (!current) { stats.skipped++; continue; }
    const fieldUpdates: Record<string, unknown> = {};
    for (const field of ENRICH_FIELDS) {
      const c = current[field];
      const i = item.payload[field];
      if ((c === null || c === undefined || c === '') && i) fieldUpdates[field] = i;
    }
    if (Object.keys(fieldUpdates).length === 0) { stats.skipped++; continue; }

    updatePromises.push(
      ctx.admin
        .from('candidates')
        .update(fieldUpdates)
        .eq('id', item.candidateId)
        .then((res: { error: { message: string } | null }) => ({
          candidateId: item.candidateId,
          error: res.error?.message ?? null,
        })),
    );
  }

  const results = await Promise.all(updatePromises);
  for (const r of results) {
    if (r.error) {
      stats.failed++;
      stats.failures.push({ carerix_id: r.candidateId, error: `enrich: ${r.error}` });
    } else {
      stats.skipped++;
    }
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
  mappingMetadata?: Record<string, unknown>,
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
    await ctx.idMapper.save(entityType, id, carerixId, mappingMetadata);
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
  markDone(stats, pageData);
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

    let companyJaWerktId = ctx.idMapper.get('company', carerixCompanyId);
    if (!companyJaWerktId) {
      companyJaWerktId = await createFallbackCompanyForContact(ctx, contact, carerixCompanyId);
      if (!companyJaWerktId) {
        stats.failed++;
        stats.failures.push({
          carerix_id: String(contact._id),
          error: `company ${carerixCompanyId} not yet imported`,
          payload: { carerix_company_id: carerixCompanyId },
        });
        continue;
      }
    }

    const payload = mapContact(contact, companyJaWerktId, ctx.organizationId);
    await insertIfNew(ctx, 'company_contacts', 'contact', String(contact._id), payload, stats, {
      first_name: contact.firstName,
      last_name: contact.lastName,
    });
  }
  markDone(stats, pageData);
  return stats;
}

async function createFallbackCompanyForContact(
  ctx: RunnerContext,
  contact: CXContact,
  carerixCompanyId: string,
): Promise<string | null> {
  const fallbackName = contact.company?.name
    || contact.company?.displayName
    || `Carerix bedrijf ${carerixCompanyId}`;

  if (ctx.dryRun) return '00000000-0000-0000-0000-000000000000';

  const { data: inserted, error } = await ctx.admin
    .from('companies')
    .insert({
      name: fallbackName,
      organization_id: ctx.organizationId,
      is_active: false,
      notes: `Aangemaakt door Carerix contact-import omdat contact ${contact._id} verwijst naar een bedrijf dat niet in companyPage voorkomt.`,
    })
    .select('id')
    .single();

  if (error || !inserted?.id) return null;

  await ctx.idMapper.save('company', inserted.id as string, carerixCompanyId, {
    source_entity: 'CXContact.company',
    created_from_contact_id: String(contact._id),
    fallback_company: true,
    name: fallbackName,
  });

  return inserted.id as string;
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
    // Verzamel bestaande candidates voor één bulk-enrich aan einde van page
    // (was per-candidate SELECT+UPDATE — leverde page-tijd > soft-deadline op).
    const enrichBatch: Array<{ candidateId: string; payload: Record<string, unknown> }> = [];
    for (const emp of pageData.items) {
      const payload = mapCREmployee(emp, ctx.organizationId);
      const existingId = ctx.idMapper.get('candidate', String(emp._id));
      if (existingId) {
        enrichBatch.push({ candidateId: existingId, payload });
      } else {
        await insertIfNew(ctx, 'candidates', 'candidate', String(emp._id), payload, stats, {
          name: `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim(),
        });
      }
    }
    await bulkEnrichCandidates(ctx, enrichBatch, stats);
    markDone(stats, pageData);
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
  markDone(stats, pageData);
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
      title: job.name,
    });
  }
  markDone(stats, pageData);
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
  markDone(stats, pageData);
  return stats;
}

// Placements via crJobPage: CRJob is in Carerix het concrete
// dienstverband/plaatsing-record met medewerker, bedrijf, match/vacature,
// start/einddatum en tarieven. CRWorkHistory is werkhistorie op het CV en telt
// veel te breed.
export async function runPlacementsPage(
  ctx: RunnerContext,
  page: number,
  size: number,
): Promise<PageStats> {
  const watermark = watermarkQualifier(ctx.modifiedSince);
  const result = await tryQuery<{ crJobPage: PageResponse<CRJob> }>(
    ctx,
    crPlacementJobsQuery(page, size, watermark),
  );
  if (!result.data?.crJobPage) {
    return { ...emptyStats(0), skipReason: result.reason ?? 'crJobPage onverwachts leeg' };
  }

  const pageData = result.data.crJobPage;
  const stats = emptyStats(pageData.totalElements);

  for (const job of pageData.items) {
    const carerixCandidateId = job.toEmployee?._id ? String(job.toEmployee._id) : null;
    const carerixCompanyId = job.toCompany?._id ? String(job.toCompany._id) : null;
    if (!carerixCandidateId || !carerixCompanyId) {
      stats.skipped++;
      continue;
    }

    const candidateId = ctx.idMapper.get('candidate', carerixCandidateId);
    const companyId = ctx.idMapper.get('company', carerixCompanyId);
    if (!candidateId || !companyId) {
      stats.failed++;
      stats.failures.push({
        carerix_id: String(job._id),
        error: `dependency not imported (candidate=${carerixCandidateId} company=${carerixCompanyId})`,
        payload: {
          source_entity: 'CRJob',
          carerix_job_id: String(job._id),
          carerix_candidate_id: carerixCandidateId,
          carerix_company_id: carerixCompanyId,
          carerix_status: job.statusDisplay ?? null,
          carerix_status_code: job.status ?? null,
          carerix_name: job.name ?? null,
          start_date: job.startDate ?? null,
          end_date: job.endDate ?? null,
        },
      });
      continue;
    }

    const carerixVacancyId = job.toVacancy?._id ? String(job.toVacancy._id) : null;
    const vacancyId = (carerixVacancyId ? ctx.idMapper.get('vacancy', carerixVacancyId) : null)
      ?? ctx.idMapper.get('vacancy', String(job._id));
    const carerixMatchId = job.toMatch?._id ? String(job.toMatch._id) : null;
    const matchId = carerixMatchId ? ctx.idMapper.get('match', carerixMatchId) : null;

    try {
      const payload = mapCRJobToPlacement(job, candidateId, companyId, ctx.organizationId, {
        vacancyId,
        matchId,
      });
      const mappingMetadata = {
        source_entity: 'CRJob',
        carerix_job_id: String(job._id),
        carerix_candidate_id: carerixCandidateId,
        carerix_company_id: carerixCompanyId,
        carerix_vacancy_id: carerixVacancyId,
        carerix_match_id: carerixMatchId,
        carerix_status: job.statusDisplay ?? null,
        carerix_status_code: job.status ?? null,
        carerix_name: job.name ?? null,
        carerix_template_name: job.templateName ?? null,
        start_date: job.startDate ?? null,
        end_date: job.endDate ?? null,
        hourly_tariff_invoice: job.hourlyTariffInvoice ?? null,
        hourly_wage_gross: job.hourlyWageGross ?? null,
        hours_per_week: job.hoursPerWeek ?? null,
        total_work_hours: job.totalWorkHours ?? null,
      };
      await insertIfNew(
        ctx,
        'placements',
        'placement',
        String(job._id),
        payload,
        stats,
        mappingMetadata,
        mappingMetadata,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.failed++;
      stats.failures.push({ carerix_id: String(job._id), error: msg });
    }
  }
  markDone(stats, pageData);
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
    return { ...emptyStats(0), done: true };
  }

  // Pseudo-total om de UI progressie te tonen: we doen offset+batch maal
  // candidates totdat de batch korter is dan CANDIDATES_PER_BATCH.
  const stats = emptyStats(offset + mappings.length);

  for (const m of mappings) {
    const carerixEmployeeId = String(m.external_id);
    const candidateId = String(m.entity_id);

    let attachmentPage = 0;
    while (true) {
      const result = await tryQuery<{
        crEmployee: {
          _id: string;
          attachments?: { items: CRAttachment[]; totalElements: number; last?: boolean };
        } | null;
      }>(ctx, crEmployeeAttachmentsQuery(carerixEmployeeId, attachmentPage, 100));

      if (result.reason) {
        stats.failed++;
        stats.failures.push({ carerix_id: carerixEmployeeId, error: result.reason.slice(0, 200) });
        break;
      }
      const attachmentData = result.data?.crEmployee?.attachments;
      const items = attachmentData?.items ?? [];

      for (const att of items) {
        const payload = mapCRAttachmentToDocument(att, candidateId, ctx.organizationId);
        await insertIfNew(ctx, 'documents', 'document', String(att._id), payload, stats);
      }

      if (attachmentData?.last === true || items.length < 100) break;
      attachmentPage++;
    }
  }
  // Klaar zodra de huidige candidate-batch korter is dan de page-grootte.
  if (mappings.length < CANDIDATES_PER_BATCH) stats.done = true;
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
  const result = await tryQuery<{ crToDoPage: PageResponse<CRTodo> }>(
    ctx,
    crTodosQuery(page, size, watermark),
  );
  if (!result.data?.crToDoPage) {
    return { ...emptyStats(0), skipReason: result.reason ?? 'crToDoPage onverwachts leeg' };
  }

  const pageData = result.data.crToDoPage;
  const stats = emptyStats(pageData.totalElements);

  for (const todo of pageData.items) {
    // Resolve relation in volgorde: candidate → company → match → vacancy → contact.
    // De eerste parent die in onze idMapper voorkomt wint. Hierdoor redden we
    // todos die in Carerix alleen aan een match/job/contact hangen.
    // entityType matcht de UI-conventie (kandidaat/opdrachtgever/vacature/etc.),
    // mapperType is de interne idMapper-key.
    const tryParents: Array<[string, string, string]> = [
      [todo.toEmployee?._id ?? '', 'candidate', 'kandidaat'],
      [todo.toCompany?._id ?? '', 'company', 'opdrachtgever'],
      [todo.toMatch?._id ?? '', 'match', 'match'],
      [todo.toJob?._id ?? '', 'vacancy', 'vacature'],
      [todo.toContact?._id ?? '', 'contact', 'contact'],
    ];

    let relatedEntityId: string | null = null;
    let relatedEntityType: string | null = null;
    for (const [carerixId, mapperType, entityType] of tryParents) {
      if (!carerixId) continue;
      const id = ctx.idMapper.get(mapperType, String(carerixId));
      if (id) {
        relatedEntityId = id;
        relatedEntityType = entityType;
        break;
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
  markDone(stats, pageData);
  return stats;
}

type Runner = (ctx: RunnerContext, page: number, size: number) => Promise<PageStats>;

export const ENTITY_RUNNERS: Partial<Record<EntityName, Runner>> = {
  companies: runCompaniesPage,
  contacts: runContactsPage,
  candidates: runCandidatesPage,
  vacancies: runVacanciesPage,
  matches: runMatchesPage,
  placements: runPlacementsPage, // via crJobPage
  documents: runDocumentsPage,   // per-kandidaat via CREmployee.attachments
  notes: runNotesPage,
  // employment is in deze tenant gelijk aan placements (zelfde data via
  // CRWorkHistory) — daarom UNSUPPORTED in types.ts.
};
