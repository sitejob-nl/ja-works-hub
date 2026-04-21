// external_mappings helpers for Carerix idempotency.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type MappingKey = string; // `${entityType}:${carerixId}`

export class IdMapper {
  private cache = new Map<MappingKey, string>();

  constructor(
    private supabase: SupabaseClient,
    private organizationId: string,
  ) {}

  private key(entityType: string, carerixId: string): MappingKey {
    return `${entityType}:${carerixId}`;
  }

  async preload(entityTypes: string[]): Promise<void> {
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await this.supabase
        .from('external_mappings')
        .select('entity_type, entity_id, external_id')
        .eq('external_system', 'carerix')
        .eq('organization_id', this.organizationId)
        .in('entity_type', entityTypes)
        .range(from, from + pageSize - 1);

      if (error) throw new Error(`id-mapper preload failed: ${error.message}`);
      if (!data || data.length === 0) break;

      for (const row of data) {
        this.cache.set(
          this.key(row.entity_type as string, row.external_id as string),
          row.entity_id as string,
        );
      }

      if (data.length < pageSize) break;
      from += pageSize;
    }
  }

  get(entityType: string, carerixId: string): string | null {
    return this.cache.get(this.key(entityType, carerixId)) ?? null;
  }

  async save(
    entityType: string,
    jaWerktId: string,
    carerixId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.supabase.from('external_mappings').insert({
      organization_id: this.organizationId,
      entity_type: entityType,
      entity_id: jaWerktId,
      external_system: 'carerix',
      external_id: String(carerixId),
      metadata: metadata ?? null,
    });
    if (error) throw new Error(`id-mapper save failed: ${error.message}`);
    this.cache.set(this.key(entityType, String(carerixId)), jaWerktId);
  }
}
