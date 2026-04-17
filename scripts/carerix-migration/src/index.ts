import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { CarerixAuth } from './lib/carerix-auth.js';
import { CarerixClient } from './lib/carerix-client.js';
import { createSupabaseClient } from './lib/supabase-client.js';
import { IdMapper } from './lib/id-mapper.js';
import { ProgressTracker } from './lib/progress.js';
import type { MigrationContext } from './types/carerix.js';

import { migrateCompanies } from './migrators/01-companies.js';
import { migrateContacts } from './migrators/02-contacts.js';
import { migrateCandidates } from './migrators/03-candidates.js';
import { migrateDocuments } from './migrators/04-documents.js';
import { migrateEmploymentHistory } from './migrators/05-employment-history.js';
import { migrateVacancies } from './migrators/06-vacancies.js';
import { migratePlacements } from './migrators/07-placements.js';
import { migrateNotes } from './migrators/08-notes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// All migrators in dependency order
const ALL_MIGRATORS = [
  { name: 'companies', fn: migrateCompanies },
  { name: 'contacts', fn: migrateContacts },
  { name: 'candidates', fn: migrateCandidates },
  { name: 'documents', fn: migrateDocuments },
  { name: 'employment', fn: migrateEmploymentHistory },
  { name: 'vacancies', fn: migrateVacancies },
  { name: 'placements', fn: migratePlacements },
  { name: 'notes', fn: migrateNotes },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',') || null;
  const skip = args.find(a => a.startsWith('--skip='))?.split('=')[1]?.split(',') || [];
  return { only, skip };
}

async function main() {
  // Ensure logs directory exists
  mkdirSync(resolve(__dirname, '..', 'logs'), { recursive: true });

  const config = loadConfig();
  const logger = createLogger();
  const { only, skip } = parseArgs();

  logger.info('=== Carerix → JA Werkt Migration ===');
  logger.info(`Mode: ${config.dryRun ? 'DRY-RUN' : 'LIVE'}`);
  logger.info(`Organization: ${config.organizationId}`);
  logger.info(`Batch size: ${config.batchSize}`);

  if (only) logger.info(`Only running: ${only.join(', ')}`);
  if (skip.length) logger.info(`Skipping: ${skip.join(', ')}`);

  // Initialize shared modules
  const auth = new CarerixAuth(config.carerix, logger);
  const carerixClient = new CarerixClient(config.carerix, auth, logger);
  const supabase = createSupabaseClient(config.supabase);
  const idMapper = new IdMapper(supabase, config.organizationId, logger);
  const progress = new ProgressTracker(logger);

  // Load existing mappings for idempotency
  await idMapper.loadExisting();

  const ctx: MigrationContext = {
    carerixClient,
    supabase,
    idMapper,
    logger,
    progress,
    config,
  };

  // Run migrators in order
  for (const { name, fn } of ALL_MIGRATORS) {
    if (only && !only.includes(name)) {
      logger.info(`Skipping ${name} (not in --only list)`);
      continue;
    }
    if (skip.includes(name)) {
      logger.info(`Skipping ${name} (in --skip list)`);
      continue;
    }

    logger.info(`\n--- Starting: ${name} ---`);
    const startTime = Date.now();

    try {
      await fn(ctx);
    } catch (err: any) {
      logger.error(`FATAL error in ${name} migrator: ${err.message}`, { stack: err.stack });
      logger.error(`Continuing with next migrator...`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`--- Finished: ${name} (${duration}s) ---`);
  }

  // Summary
  progress.printSummary();
  progress.writeFailuresFile();

  logger.info('\nMigration complete!');
  if (config.dryRun) {
    logger.info('This was a DRY-RUN. No data was written to Supabase.');
    logger.info('Run without --dry-run to execute the migration.');
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
