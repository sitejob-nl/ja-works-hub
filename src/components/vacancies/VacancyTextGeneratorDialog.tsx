import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { unwrap } from '@/lib/db';
import { VACANCY_ANSWER_FIELDS, buildVacancyPrefill, type VacancyAnswers } from '@/lib/vacancy-generator';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancy: any; // vacancies-rij incl. companies-join (id, name)
}

// Leest de body-boodschap uit een FunctionsHttpError zodat we de Nederlandse
// foutmelding van de edge function (bv. "Saldo onvoldoende…") kunnen tonen.
async function friendlyInvokeError(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return body.error as string;
  } catch {
    /* geen JSON-body */
  }
  return error?.message ?? 'Genereren mislukt';
}

const VacancyTextGeneratorDialog = ({ open, onOpenChange, vacancy }: Props) => {
  const qc = useQueryClient();
  const companyId = vacancy?.company_id ?? (vacancy?.companies as any)?.id ?? null;

  // Extra opdrachtgevervelden voor de prefill (website/KvK/cao) — alleen als context.
  const { data: company } = useQuery({
    queryKey: ['vacancy-generator-company', companyId],
    queryFn: () => unwrap(
      supabase.from('companies').select('name, website, kvk_number, cao').eq('id', companyId).maybeSingle(),
    ),
    enabled: open && !!companyId,
  });

  const prefill = useMemo(
    () => buildVacancyPrefill(vacancy ?? {}, company ?? { name: (vacancy?.companies as any)?.name }),
    [vacancy, company],
  );

  const [answers, setAnswers] = useState<VacancyAnswers>(prefill);

  // Herlaad de prefill telkens als de dialog opent of de opdrachtgevercontext binnenkomt.
  useEffect(() => {
    if (open) setAnswers(prefill);
  }, [open, prefill]);

  const setField = (key: string, value: string) => setAnswers((a) => ({ ...a, [key]: value }));

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('generate-vacancy', {
        body: { vacancy_id: vacancy.id, answers },
      });
      if (error) throw new Error(await friendlyInvokeError(error));
      if (!data?.success) throw new Error(data?.error ?? 'Genereren mislukt');
      return data.result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-seo', vacancy.id] });
      toast.success('Vacaturetekst gegenereerd');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-stat-blue" /> AI-vacaturetekst genereren
          </DialogTitle>
          <DialogDescription>
            De velden zijn voor je ingevuld op basis van de vacature en opdrachtgever. Vul de gaten aan
            (werktijden, toeslagen, huisvesting, taaleisen, zware kanten) en genereer. Onbekend? Laat leeg of vul
            “n.v.t.” in. De opdrachtgever wordt nooit in de tekst genoemd.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-4 py-1">
          {VACANCY_ANSWER_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor={`vac-${field.key}`} className="text-sm">{field.label}</Label>
                {field.internal && (
                  <Badge variant="secondary" className="gap-1 text-[10px] font-normal bg-muted text-muted-foreground border-0">
                    <Lock className="h-3 w-3" /> intern
                  </Badge>
                )}
              </div>
              {field.multiline ? (
                <Textarea
                  id={`vac-${field.key}`}
                  value={answers[field.key] ?? ''}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="min-h-[64px] text-sm"
                />
              ) : (
                <Input
                  id={`vac-${field.key}`}
                  value={answers[field.key] ?? ''}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="text-sm"
                />
              )}
              {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
            </div>
          ))}
        </div>

        <DialogFooter className="border-t border-border pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={generate.isPending}>Annuleren</Button>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending} className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            {generate.isPending ? 'AI schrijft…' : 'Genereer vacaturetekst'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VacancyTextGeneratorDialog;
