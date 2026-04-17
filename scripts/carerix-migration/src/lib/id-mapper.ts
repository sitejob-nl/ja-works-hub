import type { SupabaseClient } from '@supabase/supabase-js';
import type winston from 'winston';

interface MappingRow {
  entity_type: string;
  entity_id: string;
  external_id: string;
}

export class IdMapper {
  private supabase: SupabaseClient;
  private orgId: string;
  private logger: winston.Logger;
  // Cache: Map<"entityType:externalId", jaWerktId>
  private cache = new Map<string, string>();

  constructor(supabase: SupabaseClient, orgId: string, logger: winston.Logger) {
    this.supabase = supabase;
    this.orgId = orgId;
    this.logger = logger;
  }

  private key(entityType: string, externalId: string): string {
    return `${entityType}:${externalId}`;
  }

  async loadExisting(): Promise<void> {
    this.logger.info('Loading existing external_mappings for carerix...');

    let offset = 0;
    const pageSize = 1000;
    let total = 0;

    while (true) {
      const { data, error } = await this.supabase
        .from('external_mappings')
        .select('entity_type, entity_id, external_id')
        .eq('external_system', 'carerix')
        .eq('organization_id', this.orgId)
        .range(offset, offset + pageSize - 1);

      if (error) throw new Error(`Failed to load mappings: ${error.message}`);
      if (!data || data.length === 0) break;

      for (const row of data as MappingRow[]) {
        this.cache.set(this.key(row.entity_type, row.external_id), row.entity_id);
      }

      total += data.length;
      offset += pageSize;

      if (data.length < pageSize) break;
    }

    this.logger.info(`Loaded ${total} existing carerix mappings`);
  }

  getJaWerktId(entityType: string, carerixId: string): string | null {
    return this.cache.get(this.key(entityType, carerixId)) || null;
  }

  async saveMapping(
    entityType: string,
    jaWerktId: string,
    carerixId: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const { error } = await this.supabase.from('external_mappings').insert({
      organization_id: this.orgId,
      entity_type: entityType,
      entity_id: jaWerktId,
      external_system: 'carerix',
      external_id: String(carerixId),
      metadata: metadata || null,
    });

    if (error) throw new Error(`Failed to save mapping: ${error.message}`);

    this.cache.set(this.key(entityType, String(carerixId)), jaWerktId);
  }
}
