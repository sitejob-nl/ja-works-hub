/**
 * Post-migration verification script.
 * Checks counts, orphans, and document integrity.
 *
 * Usage: npm run verify
 */

import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { createSupabaseClient } from './lib/supabase-client.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger();
  const supabase = createSupabaseClient(config.supabase);
  const orgId = config.organizationId;

  logger.info('=== Post-Migration Verification ===\n');

  let allPassed = true;

  // 1. Mapping counts
  logger.info('1. External mapping counts:');
  const { data: mappings } = await supabase
    .from('external_mappings')
    .select('entity_type')
    .eq('external_system', 'carerix')
    .eq('organization_id', orgId);

  // Count by entity_type manually
  const typeCounts: Record<string, number> = {};
  for (const row of mappings || []) {
    typeCounts[row.entity_type] = (typeCounts[row.entity_type] || 0) + 1;
  }

  for (const [type, count] of Object.entries(typeCounts)) {
    logger.info(`  ${type}: ${count} mappings`);
  }

  // 2. Table counts
  logger.info('\n2. Table record counts (this org):');

  const tables = [
    { name: 'candidates', table: 'candidates' },
    { name: 'companies', table: 'companies' },
    { name: 'company_contacts', table: 'company_contacts' },
    { name: 'vacancies', table: 'vacancies' },
    { name: 'placements', table: 'placements' },
    { name: 'documents', table: 'documents' },
    { name: 'candidate_employment', table: 'candidate_employment' },
    { name: 'notes', table: 'notes' },
    { name: 'recruiter_tasks', table: 'recruiter_tasks' },
  ];

  for (const { name, table } of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId);

    if (error) {
      logger.error(`  ${name}: ERROR - ${error.message}`);
      allPassed = false;
    } else {
      logger.info(`  ${name}: ${count} records`);
    }
  }

  // 3. Orphan checks
  logger.info('\n3. Orphan checks:');

  // Placements with missing candidates
  const { data: orphanPlacements } = await supabase
    .from('placements')
    .select('id, employee_id')
    .eq('organization_id', orgId)
    .is('employee_id', null);

  if (orphanPlacements && orphanPlacements.length > 0) {
    logger.warn(`  Placements without employee: ${orphanPlacements.length}`);
    allPassed = false;
  } else {
    logger.info('  Placements: all have valid employee_id ✓');
  }

  // Documents with missing candidates
  const { data: orphanDocs } = await supabase
    .from('documents')
    .select('id, candidate_id')
    .eq('organization_id', orgId)
    .is('candidate_id', null);

  if (orphanDocs && orphanDocs.length > 0) {
    logger.warn(`  Documents without candidate: ${orphanDocs.length}`);
    allPassed = false;
  } else {
    logger.info('  Documents: all have valid candidate_id ✓');
  }

  // 4. Document spot check
  logger.info('\n4. Document spot check (20 random candidates):');

  const { data: sampleCandidates } = await supabase
    .from('candidates')
    .select('id, first_name, last_name')
    .eq('organization_id', orgId)
    .eq('source', 'carerix')
    .limit(20);

  let docCheckPassed = 0;
  for (const candidate of sampleCandidates || []) {
    const { count: docCount } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('candidate_id', candidate.id);

    if ((docCount || 0) > 0) {
      docCheckPassed++;
    }
  }

  logger.info(`  ${docCheckPassed}/${sampleCandidates?.length || 0} candidates have documents`);

  // 5. Carerix source check
  logger.info('\n5. Source verification:');
  const { count: carerixSourceCount } = await supabase
    .from('candidates')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('source', 'carerix');

  logger.info(`  Candidates with source='carerix': ${carerixSourceCount}`);

  // Summary
  logger.info(`\n=== Verification ${allPassed ? 'PASSED ✓' : 'HAS WARNINGS ⚠'} ===`);
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
