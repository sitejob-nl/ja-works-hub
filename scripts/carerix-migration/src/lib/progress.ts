import type winston from 'winston';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface EntityStats {
  found: number;
  skipped: number;
  created: number;
  failed: number;
  startTime: number;
  endTime?: number;
}

interface FailedRecord {
  entityType: string;
  carerixId: string;
  error: string;
  data?: any;
}

export class ProgressTracker {
  private stats = new Map<string, EntityStats>();
  private failures: FailedRecord[] = [];
  private logger: winston.Logger;

  constructor(logger: winston.Logger) {
    this.logger = logger;
  }

  startEntity(entityType: string): void {
    this.stats.set(entityType, {
      found: 0,
      skipped: 0,
      created: 0,
      failed: 0,
      startTime: Date.now(),
    });
  }

  setFound(entityType: string, count: number): void {
    const s = this.stats.get(entityType);
    if (s) s.found = count;
  }

  recordSkip(entityType: string): void {
    const s = this.stats.get(entityType);
    if (s) s.skipped++;
  }

  recordCreate(entityType: string): void {
    const s = this.stats.get(entityType);
    if (s) s.created++;
  }

  recordFailure(entityType: string, carerixId: string, error: string, data?: any): void {
    const s = this.stats.get(entityType);
    if (s) s.failed++;
    this.failures.push({ entityType, carerixId, error, data });
  }

  endEntity(entityType: string): void {
    const s = this.stats.get(entityType);
    if (s) s.endTime = Date.now();
  }

  getStats(entityType: string): EntityStats | undefined {
    return this.stats.get(entityType);
  }

  printSummary(): void {
    const header = 'Entity            | Found  | Skipped | Created | Failed | Duration';
    const divider = '------------------|--------|---------|---------|--------|--------';

    this.logger.info('');
    this.logger.info('=== MIGRATION SUMMARY ===');
    this.logger.info(header);
    this.logger.info(divider);

    for (const [entity, s] of this.stats) {
      const duration = s.endTime
        ? `${((s.endTime - s.startTime) / 1000).toFixed(1)}s`
        : 'running';
      this.logger.info(
        `${entity.padEnd(18)}| ${String(s.found).padEnd(7)}| ${String(s.skipped).padEnd(8)}| ${String(s.created).padEnd(8)}| ${String(s.failed).padEnd(7)}| ${duration}`,
      );
    }

    if (this.failures.length > 0) {
      this.logger.info('');
      this.logger.warn(`${this.failures.length} total failures — see failures file for details`);
    }
  }

  writeFailuresFile(): void {
    if (this.failures.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);
    const filePath = resolve(__dirname, '..', '..', 'logs', `migration-failures-${today}.json`);

    writeFileSync(filePath, JSON.stringify(this.failures, null, 2), 'utf-8');
    this.logger.info(`Failures written to ${filePath}`);
  }
}
