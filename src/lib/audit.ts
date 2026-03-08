import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type AuditAction = Database['public']['Enums']['audit_action'];

export const logAudit = async (params: {
  action: AuditAction;
  tableName: string;
  recordId: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  reason?: string;
}) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', session?.user?.id ?? '')
      .maybeSingle();

    if (!profile?.organization_id) return;

    await supabase.from('audit_log').insert({
      organization_id: profile.organization_id,
      user_id: session?.user?.id ?? null,
      action: params.action,
      table_name: params.tableName,
      record_id: params.recordId,
      old_values: (params.oldValues as any) ?? null,
      new_values: (params.newValues as any) ?? null,
      reason: params.reason ?? null,
    });
  } catch {
    // Silent fail — audit logging should never break the app
  }
};
