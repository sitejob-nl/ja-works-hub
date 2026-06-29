import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useExactActive } from '@/hooks/useExactActive';
import { toast } from 'sonner';
import { Save, BookOpen, RefreshCw } from 'lucide-react';

async function fetchRevenueGLAccounts() {
  const { data, error } = await supabase.functions.invoke('exact-list-glaccounts', {
    body: { kind: 'revenue' },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as { accounts?: GLAccount[] };
}

const HOUR_TYPES = [
  { code: 'normaal', label: 'Normaal' },
  { code: 'overwerk', label: 'Overwerk' },
  { code: 'toeslag_nacht', label: 'Nachttoeslag' },
  { code: 'toeslag_weekend', label: 'Weekendtoeslag' },
  { code: 'toeslag_feestdag', label: 'Feestdagtoeslag' },
  { code: 'reis', label: 'Reisuren' },
  { code: 'wacht', label: 'Wachturen' },
];

interface GLAccount {
  id: string;
  code: string;
  description: string | null;
  label: string;
}

export default function ExactGLAccountMappings() {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  // Local state for mapping selections
  const [mappings, setMappings] = useState<Record<string, { gl_account_id: string; gl_account_code: string }>>({});

  // Fetch existing mappings from DB
  const { data: existingMappings, isLoading: mappingsLoading } = useQuery({
    queryKey: ['exact-gl-mappings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exact_glaccount_mappings')
        .select('*')
        .eq('organization_id', orgId);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch revenue GLAccounts from Exact using the same type/prefix logic as BestOps.
  const { data: glAccountsData, isLoading: glLoading, refetch: refetchGL } = useQuery({
    queryKey: ['exact-glaccounts', orgId, 'revenue'],
    queryFn: fetchRevenueGLAccounts,
  });

  const glAccounts = glAccountsData?.accounts ?? [];

  // Initialize local state from DB
  useEffect(() => {
    if (existingMappings) {
      const m: Record<string, { gl_account_id: string; gl_account_code: string }> = {};
      for (const em of existingMappings) {
        m[em.hour_type_code] = { gl_account_id: em.gl_account_id, gl_account_code: em.gl_account_code || '' };
      }
      setMappings(m);
    }
  }, [existingMappings]);

  // Save all mappings
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Upsert each mapping
      for (const ht of HOUR_TYPES) {
        const mapping = mappings[ht.code];
        if (mapping?.gl_account_id) {
          const glAccount = glAccounts.find(g => g.id === mapping.gl_account_id);
          const { error } = await supabase
            .from('exact_glaccount_mappings')
            .upsert({
              organization_id: orgId,
              hour_type_code: ht.code,
              gl_account_id: mapping.gl_account_id,
              gl_account_code: glAccount?.code || mapping.gl_account_code || null,
              description: glAccount?.description || null,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'organization_id,hour_type_code' });
          if (error) throw error;
        } else {
          // Remove mapping if cleared
          await supabase
            .from('exact_glaccount_mappings')
            .delete()
            .eq('organization_id', orgId)
            .eq('hour_type_code', ht.code);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exact-gl-mappings'] });
      toast.success('Grootboekkoppelingen opgeslagen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const isLoading = mappingsLoading || glLoading;
  const hasChanges = JSON.stringify(mappings) !== JSON.stringify(
    Object.fromEntries((existingMappings || []).map(m => [m.hour_type_code, { gl_account_id: m.gl_account_id, gl_account_code: m.gl_account_code || '' }]))
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" /> Grootboekkoppelingen
            </CardTitle>
            <CardDescription>
              Koppel uurtypes aan grootboekrekeningen in Exact Online
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchGL()} disabled={glLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${glLoading ? 'animate-spin' : ''}`} /> Vernieuwen
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : glAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Geen omzetrekeningen gevonden in Exact Online. Controleer of er actieve omzetrekeningen (Type 110 of 8xxx) bestaan.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              {HOUR_TYPES.map((ht) => (
                <div key={ht.code} className="flex items-center gap-4">
                  <div className="w-40 flex-shrink-0">
                    <Badge variant="outline">{ht.label}</Badge>
                  </div>
                  <Select
                    value={mappings[ht.code]?.gl_account_id || ''}
                    onValueChange={(value) => {
                      const gl = glAccounts.find(g => g.id === value);
                      setMappings(prev => ({
                        ...prev,
                        [ht.code]: value
                          ? { gl_account_id: value, gl_account_code: gl?.code || '' }
                          : undefined as any,
                      }));
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Selecteer grootboekrekening..." />
                    </SelectTrigger>
                    <SelectContent>
                      {glAccounts.map((gl) => (
                        <SelectItem key={gl.id} value={gl.id}>
                          {gl.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !hasChanges}
              >
                <Save className="h-4 w-4 mr-1" />
                {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
