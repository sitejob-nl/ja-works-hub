import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from './useOrganizationId';

export const useModuleEnabled = (moduleKey: string): boolean => {
  const orgId = useOrganizationId();

  const { data: moduleOverride } = useQuery({
    queryKey: ['module-enabled', orgId, moduleKey],
    queryFn: async () => {
      const { data } = await supabase
        .from('organization_modules')
        .select('enabled')
        .eq('organization_id', orgId!)
        .eq('module_name', moduleKey)
        .maybeSingle();
      return data;
    },
    enabled: !!orgId,
  });

  const { data: profile } = useQuery({
    queryKey: ['profile-for-module'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      return data;
    },
  });

  const { data: org } = useQuery({
    queryKey: ['org-plan-for-module', profile?.organization_id],
    queryFn: async () => {
      const { data } = await supabase.from('organizations').select('plan_id').eq('id', profile!.organization_id).single();
      return data;
    },
    enabled: !!profile?.organization_id,
  });

  const { data: plan } = useQuery({
    queryKey: ['plan-modules', org?.plan_id],
    queryFn: async () => {
      const { data } = await supabase.from('subscription_plans').select('modules').eq('id', org!.plan_id!).single();
      return data;
    },
    enabled: !!org?.plan_id,
  });

  // Override takes precedence
  if (moduleOverride) return moduleOverride.enabled;
  // Then check plan
  if (plan?.modules) return (plan.modules as string[]).includes(moduleKey);
  // Default: enabled
  return true;
};
