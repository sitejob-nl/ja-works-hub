import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';

export interface CustomField {
  id: string;
  field_name: string;
  field_label: string;
  field_type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea';
  options: string[];
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface CustomFieldValue {
  custom_field_id: string;
  value: string | null;
}

/** Fetch custom field definitions for an entity type */
export const useCustomFieldDefinitions = (entityType: string) => {
  const orgId = useOrganizationId();
  return useQuery<CustomField[]>({
    queryKey: ['custom-fields', orgId, entityType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('custom_fields')
        .select('id, field_name, field_label, field_type, options, is_required, sort_order, is_active')
        .eq('organization_id', orgId)
        .eq('entity_type', entityType)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((d: any) => ({ ...d, options: d.options ?? [] }));
    },
  });
};

/** Fetch custom field values for a specific entity */
export const useCustomFieldValues = (entityType: string, entityId: string | undefined) => {
  const orgId = useOrganizationId();
  return useQuery<Record<string, string>>({
    queryKey: ['custom-field-values', entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('custom_field_values')
        .select('custom_field_id, value')
        .eq('entity_id', entityId!)
        .eq('organization_id', orgId);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        map[row.custom_field_id] = row.value ?? '';
      }
      return map;
    },
    enabled: !!entityId,
  });
};

/** Save a single custom field value (upsert) */
export const useSaveCustomFieldValue = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ fieldId, entityId, value }: { fieldId: string; entityId: string; value: string }) => {
      const { error } = await supabase
        .from('custom_field_values')
        .upsert({
          organization_id: orgId,
          custom_field_id: fieldId,
          entity_id: entityId,
          value: value || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'custom_field_id,entity_id' });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['custom-field-values', variables.entityId] });
    },
  });
};
