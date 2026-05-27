import { PropsWithChildren } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePrimaryDomain } from '@/hooks/usePublicUrl';
import { buildPublicUrl } from '@/lib/public-url';
import { Button } from '@/components/ui/button';

type ResolvedDomain = {
  organization_id: string;
  domain: string;
  domain_type: 'exact' | 'wildcard';
  primary_hostname: string;
  is_primary: boolean;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export default function TenantHostGuard({ children }: PropsWithChildren) {
  const { profile } = useAuth();
  const primaryDomain = usePrimaryDomain();
  const host = window.location.hostname.toLowerCase();

  const resolved = useQuery({
    queryKey: ['resolved-domain-host', host],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc('resolve_organization_domain', { p_host: host });
      if (error) throw error;
      return ((Array.isArray(data) ? data[0] : data) ?? null) as ResolvedDomain | null;
    },
    enabled: !!profile?.organization_id && !LOCAL_HOSTS.has(host),
    staleTime: 60_000,
  });

  const resolvedOrgId = resolved.data?.organization_id;
  const isWrongTenantHost = Boolean(
    profile?.organization_id &&
    resolvedOrgId &&
    resolvedOrgId !== profile.organization_id,
  );

  if (!isWrongTenantHost) return <>{children}</>;

  const targetUrl = buildPublicUrl(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
    primaryDomain.data ?? null,
    '/',
  );

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md rounded-lg border bg-card p-6 shadow-sm space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Verkeerd organisatiedomein</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Je bent ingelogd bij een andere organisatie dan het domein waarop je nu zit.
          </p>
        </div>
        <Button asChild className="w-full gap-2">
          <a href={targetUrl}>
            Open je eigen domein
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </div>
    </div>
  );
}
