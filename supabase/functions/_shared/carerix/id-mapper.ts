// external_mappings helpers for Carerix idempotency.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type MappingKey = string; // `${entityType}:${carerixId}`

const PAGE_SIZE = 1000;
const PRELOAD_ATTEMPTS = 3;

export class IdMapper {
  private cache = new Map<MappingKey, string>();

  constructor(
    private supabase: SupabaseClient,
    private organizationId: string,
  ) {}

  private key(entityType: string, carerixId: string): MappingKey {
    return `${entityType}:${carerixId}`;
  }

  // De cache is de enige ontdubbeling van de import: staat een Carerix-ID er niet
  // in, dan beschouwt insertIfNew het record als nieuw en voegt het opnieuw toe.
  // Een onvolledige preload is daarom geen prestatieprobleem maar een
  // datacorruptie-probleem — vandaar dat we het verwachte aantal vooraf opvragen
  // en hard falen als we dat niet halen, in plaats van stilletjes door te gaan.
  async preload(entityTypes: string[]): Promise<void> {
    if (entityTypes.length === 0) return;

    const expected = await this.countMappings(entityTypes);
    if (expected === 0) return;

    let lastError: string | null = null;
    for (let attempt = 1; attempt <= PRELOAD_ATTEMPTS; attempt++) {
      const loaded = await this.loadAllPages(entityTypes, expected);
      if (loaded >= expected) return;

      lastError = `${loaded}/${expected} koppelingen geladen`;
      console.warn(
        `[carerix] id-mapper preload onvolledig (poging ${attempt}/${PRELOAD_ATTEMPTS}): ${lastError}`,
      );
    }

    throw new Error(
      `id-mapper preload incompleet voor ${entityTypes.join(', ')}: ${lastError}. ` +
        'Import gestopt om duplicaten te voorkomen.',
    );
  }

  private async countMappings(entityTypes: string[]): Promise<number> {
    const { count, error } = await this.supabase
      .from('external_mappings')
      .select('id', { count: 'exact', head: true })
      .eq('external_system', 'carerix')
      .eq('organization_id', this.organizationId)
      .in('entity_type', entityTypes);

    if (error) throw new Error(`id-mapper preload count failed: ${error.message}`);
    return count ?? 0;
  }

  // Paginatie op de primaire sleutel. Zonder expliciete sortering is de volgorde
  // tussen twee range-queries niet gegarandeerd, waardoor rijen dubbel of
  // helemaal niet terugkomen.
  private async loadAllPages(entityTypes: string[], expected: number): Promise<number> {
    let loaded = 0;

    for (let from = 0; from < expected; from += PAGE_SIZE) {
      const { data, error } = await this.supabase
        .from('external_mappings')
        .select('entity_type, entity_id, external_id')
        .eq('external_system', 'carerix')
        .eq('organization_id', this.organizationId)
        .in('entity_type', entityTypes)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(`id-mapper preload failed: ${error.message}`);
      if (!data || data.length === 0) break;

      for (const row of data) {
        this.cache.set(
          this.key(row.entity_type as string, row.external_id as string),
          row.entity_id as string,
        );
      }
      loaded += data.length;
    }

    return loaded;
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
