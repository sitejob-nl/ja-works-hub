/**
 * Discover Carerix additionalInfo field keys.
 * Fetches 10 sample employees and logs all unique custom field keys.
 *
 * Usage: npm run discover-fields
 */

import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { CarerixAuth } from './lib/carerix-auth.js';
import { CarerixClient } from './lib/carerix-client.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger();
  const auth = new CarerixAuth(config.carerix, logger);
  const client = new CarerixClient(config.carerix, auth, logger);

  logger.info('Fetching sample employees to discover additionalInfo fields...');

  const data = await client.query<any>(`
    query {
      crEmployeePage(pageNumber: 0, pageSize: 10) {
        totalElements
        items {
          _id firstName lastName
          additionalInfo
        }
      }
    }
  `);

  const allKeys = new Map<string, { count: number; sampleValues: any[] }>();

  for (const emp of data.crEmployeePage.items) {
    if (!emp.additionalInfo) continue;

    for (const [key, value] of Object.entries(emp.additionalInfo)) {
      const existing = allKeys.get(key) || { count: 0, sampleValues: [] };
      existing.count++;
      if (existing.sampleValues.length < 3 && value !== null && value !== '') {
        existing.sampleValues.push(value);
      }
      allKeys.set(key, existing);
    }
  }

  logger.info(`\nFound ${allKeys.size} unique additionalInfo keys across ${data.crEmployeePage.items.length} employees:\n`);

  const sorted = [...allKeys.entries()].sort((a, b) => b[1].count - a[1].count);

  for (const [key, info] of sorted) {
    logger.info(`  ${key} (${info.count}x) — samples: ${JSON.stringify(info.sampleValues)}`);
  }

  logger.info('\nAlso discovering status nodes...');

  // Try to discover candidate statuses
  try {
    const statusData = await client.query<any>(`
      query {
        crDataNodePage(qualifier: "type.identifier = 'CandidateStatusType'", pageSize: 100) {
          totalElements
          items { _id value }
        }
      }
    `);

    logger.info(`\nCandidate statuses (${statusData.crDataNodePage.totalElements}):`);
    for (const node of statusData.crDataNodePage.items) {
      logger.info(`  ${node._id}: ${node.value}`);
    }
  } catch (err) {
    logger.warn('Could not fetch candidate statuses — try different qualifier');
  }

  // Try to discover attachment types
  try {
    const attachTypes = await client.query<any>(`
      query {
        crDataNodePage(qualifier: "type.identifier = 'AttachmentType'", pageSize: 100) {
          totalElements
          items { _id value }
        }
      }
    `);

    logger.info(`\nAttachment types (${attachTypes.crDataNodePage.totalElements}):`);
    for (const node of attachTypes.crDataNodePage.items) {
      logger.info(`  ${node._id}: ${node.value}`);
    }
  } catch (err) {
    logger.warn('Could not fetch attachment types — try different qualifier');
  }

  logger.info('\nDone! Use these keys to fill in field-mappings.json');
}

main().catch((err) => {
  console.error('Discovery failed:', err);
  process.exit(1);
});
