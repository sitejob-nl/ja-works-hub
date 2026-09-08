import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { hoursMatrixRpc, matrixDetailSchema, matrixListSchema, matrixBindingSchema, type MatrixDraftInput, type MatrixVersion } from '@/lib/hours-matrices';

export function useHoursMatrices(orgId: string) {
  return useQuery({
    queryKey: qk.hoursMatrices.all(orgId),
    queryFn: async () => matrixListSchema.parse(await hoursMatrixRpc('hours_list_matrices', { p_company_id: null })),
    enabled: !!orgId,
  });
}

export function useHoursMatrixCompanies(orgId: string) {
  return useQuery({
    queryKey: qk.hoursMatrices.companies(orgId),
    queryFn: () => unwrap(supabase.from('companies').select('id,name').eq('organization_id', orgId).order('name')),
    enabled: !!orgId,
  });
}

export function useCreateHoursMatrix(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scope: 'client' | 'cao'; companyId: string | null; name: string }) => matrixDetailSchema.parse(await hoursMatrixRpc('hours_create_matrix', {
      p_scope: input.scope, p_company_id: input.companyId, p_name: input.name.trim(),
    })),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: qk.hoursMatrices.all(orgId) }); },
  });
}

export function useHoursMatrix(orgId: string, matrixId?: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.hoursMatrices.detail(orgId, matrixId ?? ''),
    queryFn: async () => matrixDetailSchema.parse(await hoursMatrixRpc('hours_get_matrix', { p_matrix_id: matrixId! })),
    enabled: !!orgId && !!matrixId,
  });
  const mutation = useMutation({
    mutationFn: async (input: { type: 'save'; draft: MatrixDraftInput; version?: MatrixVersion } | { type: 'publish'; version: MatrixVersion }) => {
      const result = input.type === 'publish'
        ? await hoursMatrixRpc('hours_publish_matrix_version', { p_version_id: input.version.id, p_expected_revision: input.version.revision, p_confirmed: true })
        : input.version ? await hoursMatrixRpc('hours_save_matrix_draft', {
          p_version_id: input.version.id, p_expected_revision: input.version.revision,
          p_valid_from: input.draft.validFrom, p_valid_until: input.draft.validUntil, p_config: input.draft.config,
        }) : await hoursMatrixRpc('hours_create_matrix_draft', {
          p_matrix_id: matrixId!, p_valid_from: input.draft.validFrom, p_valid_until: input.draft.validUntil, p_config: input.draft.config,
        });
      return matrixDetailSchema.parse(result);
    },
    onSuccess: async data => {
      qc.setQueryData(qk.hoursMatrices.detail(orgId, data.id), data);
      await qc.invalidateQueries({ queryKey: qk.hoursMatrices.all(orgId) });
    },
  });
  return { ...query, mutation };
}

export function useHoursMatrixBinding(orgId: string, companyId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.hoursMatrices.binding(orgId, companyId),
    queryFn: async () => matrixBindingSchema.parse(await hoursMatrixRpc('hours_get_company_matrix_binding', { p_company_id: companyId })),
    enabled: !!orgId && !!companyId,
  });
  const mutation = useMutation({
    mutationFn: async (input: { expectedVersion: number; caoMatrixId: string | null }) => matrixBindingSchema.parse(await hoursMatrixRpc('hours_set_company_matrix_binding', {
      p_company_id: companyId, p_expected_version: input.expectedVersion, p_cao_matrix_id: input.caoMatrixId,
    })),
    onSuccess: async data => {
      qc.setQueryData(qk.hoursMatrices.binding(orgId, companyId), data);
      await qc.invalidateQueries({ queryKey: qk.hoursMatrices.all(orgId) });
    },
  });
  return { ...query, mutation };
}
