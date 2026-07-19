import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { formatEUR } from '@/lib/format';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { TrendingUp, RefreshCw, Save, Lock, AlertTriangle } from 'lucide-react';

// Roept de exact-api OData-proxy aan (rol-gate + token-refresh zitten in de edge function).
async function exactApiWithOrg(endpoint: string, orgId: string) {
  const { data, error } = await supabase.functions.invoke('exact-api', {
    body: { endpoint, method: 'GET', organization_id: orgId },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

// Exact OData geeft { d: { results: [...] } } terug.
function odataResults<T = any>(raw: any): T[] {
  const results = raw?.d?.results;
  return Array.isArray(results) ? results : [];
}

interface GLAccount { ID: string; Code: string; Description: string; }
interface SelectedAccount { ID: string; Code: string; Description: string; }

const NOW_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [NOW_YEAR, NOW_YEAR - 1, NOW_YEAR - 2];

export default function Omzet() {
  const orgId = useOrganizationId();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [year, setYear] = useState<number>(NOW_YEAR);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);

  // Alleen directie/beheer (dataminimalisatie). Omzetcijfers zijn niet voor alle interne rollen.
  const isAdmin = profile?.role === 'admin';

  // Org-instellingen: welke grootboekrekeningen tellen als omzet.
  const { data: org } = useQuery({
    queryKey: ['omzet-settings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('settings').eq('id', orgId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && isAdmin,
  });
  const savedAccounts: SelectedAccount[] = useMemo(
    () => ((org?.settings as any)?.revenue_gl_accounts ?? []) as SelectedAccount[],
    [org],
  );

  // Beschikbare omzetrekeningen uit Exact. Via exact-list-glaccounts, dat op
  // Type 110 (Revenue) + code-prefix 8 filtert. Eerder stond hier `Type eq 20`,
  // maar dat is in Exact "Accounts receivable" (debiteuren) — de picker toonde
  // dus de verkeerde rekeningen.
  const { data: glData, isLoading: glLoading, error: glError, refetch: refetchGl } = useQuery({
    queryKey: ['omzet-glaccounts', orgId, 'revenue'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('exact-list-glaccounts', {
        body: { kind: 'revenue' },
      });
      if (error) throw new Error(await extractFunctionErrorMessage(error, 'Grootboekrekeningen ophalen mislukt'));
      if (data?.error) throw new Error(data.error);
      return data as { accounts?: Array<{ id: string; code: string; description: string | null }> };
    },
    enabled: !!orgId && isAdmin,
    retry: false,
  });

  // De opgeslagen selectie in organizations.settings gebruikt het Exact-formaat
  // ({ ID, Code, Description }); die vorm houden we aan zodat bestaande
  // instellingen blijven werken.
  const glAccounts: GLAccount[] = (glData?.accounts ?? []).map((account) => ({
    ID: account.id,
    Code: account.code,
    Description: account.description ?? '',
  }));

  // De effectieve selectie: lokaal gewijzigd of (bij eerste render) de opgeslagen set.
  const effectiveSelected = selectedIds ?? new Set(savedAccounts.map((a) => a.ID));

  const saveSelection = useMutation({
    mutationFn: async () => {
      const chosen: SelectedAccount[] = glAccounts
        .filter((g) => effectiveSelected.has(g.ID))
        .map((g) => ({ ID: g.ID, Code: g.Code, Description: g.Description }));
      const nextSettings = { ...((org?.settings as any) ?? {}), revenue_gl_accounts: chosen };
      const { error } = await supabase.from('organizations').update({ settings: nextSettings }).eq('id', orgId);
      if (error) throw error;
      return chosen;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['omzet-settings', orgId] });
      qc.invalidateQueries({ queryKey: ['omzet-balance', orgId] });
      setSelectedIds(null);
      toast.success('Omzetrekeningen opgeslagen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Omzet per geselecteerde rekening voor het gekozen jaar (Exact ReportingBalance).
  const { data: balanceRaw, isLoading: balanceLoading, error: balanceError } = useQuery({
    queryKey: ['omzet-balance', orgId, year, savedAccounts.map((a) => a.ID).sort().join(',')],
    queryFn: () => exactApiWithOrg(
      `financial/ReportingBalance?$filter=ReportingYear eq ${year}&$select=GLAccount,GLAccountCode,GLAccountDescription,Amount,ReportingPeriod&$top=5000`,
      orgId,
    ),
    enabled: !!orgId && isAdmin && savedAccounts.length > 0,
    retry: false,
  });

  // Per geselecteerde rekening: som over alle perioden. Omzet (credit) staat negatief in Exact → omkeren.
  const omzetPerAccount = useMemo(() => {
    const wanted = new Set(savedAccounts.map((a) => a.ID));
    const sums = new Map<string, number>();
    for (const row of odataResults<any>(balanceRaw)) {
      if (!wanted.has(row.GLAccount)) continue;
      const amount = Number(row.Amount) || 0;
      sums.set(row.GLAccount, (sums.get(row.GLAccount) ?? 0) + amount);
    }
    return savedAccounts.map((a) => ({
      ...a,
      omzet: -(sums.get(a.ID) ?? 0), // credit→positieve omzet
    }));
  }, [balanceRaw, savedAccounts]);

  const totaal = omzetPerAccount.reduce((s, a) => s + a.omzet, 0);

  if (!isAdmin) {
    return (
      <div className="max-w-xl">
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
            <Lock className="h-5 w-5 shrink-0" />
            <span>Deze pagina is alleen voor directie/beheer.</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><TrendingUp className="h-6 w-6" /> Omzet</h1>
          <p className="text-muted-foreground text-sm mt-1">Omzet per grootboekrekening uit Exact Online — alleen directie.</p>
        </div>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Omzetoverzicht */}
      <Card>
        <CardHeader>
          <CardTitle>Omzet {year}</CardTitle>
          <CardDescription>Som per geselecteerde grootboekrekening over het hele jaar.</CardDescription>
        </CardHeader>
        <CardContent>
          {savedAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nog geen omzetrekeningen geselecteerd. Kies hieronder welke grootboekrekeningen als omzet tellen.</p>
          ) : balanceError ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Kon de omzet niet ophalen uit Exact: {(balanceError as Error).message}</span>
            </div>
          ) : balanceLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : (
            <div className="space-y-1">
              {omzetPerAccount.map((a) => (
                <div key={a.ID} className="flex items-center justify-between border-b py-2 last:border-0">
                  <span className="text-sm"><span className="font-medium">{a.Code}</span> — {a.Description}</span>
                  <span className="font-medium tabular-nums">{formatEUR(a.omzet)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3">
                <span className="font-semibold">Totaal</span>
                <span className="text-lg font-semibold tabular-nums">{formatEUR(totaal)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selectie van omzetrekeningen */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Omzetrekeningen kiezen</CardTitle>
              <CardDescription>Vink de grootboekrekeningen (Type 20) aan die als omzet meetellen.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchGl()} disabled={glLoading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${glLoading ? 'animate-spin' : ''}`} /> Vernieuwen
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {glError ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Geen verbinding met Exact Online: {(glError as Error).message}. Koppel Exact eerst via Instellingen.</span>
            </div>
          ) : glLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : glAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Geen omzetrekeningen (Type 20) gevonden in Exact Online.</p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
                {glAccounts.map((gl) => (
                  <label key={gl.ID} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={effectiveSelected.has(gl.ID)}
                      onCheckedChange={(checked) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev ?? new Set(savedAccounts.map((a) => a.ID)));
                          if (checked) next.add(gl.ID); else next.delete(gl.ID);
                          return next;
                        });
                      }}
                    />
                    <span className="text-sm"><span className="font-medium">{gl.Code}</span> — {gl.Description}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <Badge variant="secondary">{effectiveSelected.size} geselecteerd</Badge>
                <Button onClick={() => saveSelection.mutate()} disabled={saveSelection.isPending}>
                  <Save className="h-4 w-4 mr-1" /> {saveSelection.isPending ? 'Opslaan…' : 'Opslaan'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
