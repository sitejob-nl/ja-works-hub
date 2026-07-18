import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { Percent, RefreshCw, Save, Sparkles } from 'lucide-react';

interface VatCode {
  code: string;
  description: string | null;
  percentage: number | null;
  label: string;
}

interface VatCodeResponse {
  vat_codes?: VatCode[];
  /** Codes die wij zouden kiezen per tarief — als startpunt, niet als wet. */
  suggested?: Record<string, string>;
  configured?: Record<string, string>;
}

/** De BTW-tarieven waarmee JA Werkt factureert. */
const VAT_RATES = [
  { rate: '21', label: '21% (hoog tarief)' },
  { rate: '9', label: '9% (laag tarief)' },
  { rate: '0', label: '0% / verlegd' },
];

const NONE = '__geen__';

async function fetchVatCodes() {
  const { data, error } = await supabase.functions.invoke('exact-list-vatcodes', { body: {} });
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'BTW-codes ophalen mislukt'));
  if (data?.error) throw new Error(data.error);
  return data as VatCodeResponse;
}

export default function ExactVatCodeMappings() {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [initialised, setInitialised] = useState(false);

  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ['exact-vatcodes', orgId],
    queryFn: fetchVatCodes,
    retry: false,
  });

  const vatCodes = data?.vat_codes ?? [];
  const configured = data?.configured ?? {};
  const suggested = data?.suggested ?? {};

  useEffect(() => {
    if (data && !initialised) {
      setSelection({ ...configured });
      setInitialised(true);
    }
  }, [data, initialised, configured]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleaned = Object.fromEntries(Object.entries(selection).filter(([, code]) => !!code));
      const { error: updateError } = await supabase
        .from('exact_config')
        .update({ default_vat_codes: cleaned, updated_at: new Date().toISOString() })
        .eq('organization_id', orgId);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exact-vatcodes', orgId] });
      toast.success('BTW-codes opgeslagen');
    },
    onError: (e: any) => toast.error(e.message ?? 'Opslaan mislukt'),
  });

  /** Vult alleen de tarieven die de gebruiker nog niet zelf heeft gekozen. */
  const applySuggestions = () => {
    setSelection((prev) => {
      const next = { ...prev };
      for (const [rate, code] of Object.entries(suggested)) {
        if (!next[rate]) next[rate] = code;
      }
      return next;
    });
  };

  const hasChanges = JSON.stringify(selection) !== JSON.stringify(configured);
  const missing = VAT_RATES.filter((r) => !selection[r.rate]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5" /> BTW-codes
            </CardTitle>
            <CardDescription>
              Welke Exact-BTW-code hoort bij welk tarief. Zonder koppeling stuurt de factuur-sync geen
              BTW-code mee en bepaalt Exact zelf het tarief — controleer dit dus vóór de eerste factuur.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} /> Vernieuwen
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            BTW-codes konden niet worden opgehaald: {(error as Error).message}
          </p>
        ) : vatCodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Geen verkoop-BTW-codes gevonden in deze Exact-administratie.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              {VAT_RATES.map((vat) => (
                <div key={vat.rate} className="flex items-center gap-4">
                  <div className="w-40 flex-shrink-0">
                    <Badge variant="outline">{vat.label}</Badge>
                  </div>
                  <Select
                    value={selection[vat.rate] || NONE}
                    onValueChange={(value) =>
                      setSelection((prev) => {
                        const next = { ...prev };
                        if (value === NONE) delete next[vat.rate];
                        else next[vat.rate] = value;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Selecteer BTW-code..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Geen — Exact bepaalt zelf</SelectItem>
                      {vatCodes.map((code) => (
                        <SelectItem key={code.code} value={code.code}>
                          {code.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {missing.length > 0 && Object.keys(suggested).length > 0 && (
              <Button variant="outline" size="sm" onClick={applySuggestions} className="gap-2">
                <Sparkles className="h-4 w-4" /> Voorstel overnemen
              </Button>
            )}

            <div className="flex justify-end pt-2 border-t">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !hasChanges}>
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
