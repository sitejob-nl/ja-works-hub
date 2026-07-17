import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Copy, Save, RotateCcw, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { unwrap } from '@/lib/db';
import VacancyTextGeneratorDialog from '@/components/vacancies/VacancyTextGeneratorDialog';

interface Props {
  vacancy: any;
  canEdit: boolean;
}

// De 7 bewerkbare lange teksten (eerste-klas kolommen op vacancy_seo_content).
const EDITABLE_FIELDS: Array<{ key: string; label: string; rows: number; maxChars?: number }> = [
  { key: 'seo_title', label: 'SEO-titel (H1)', rows: 2 },
  { key: 'meta_description', label: 'Meta description', rows: 2, maxChars: 160 },
  { key: 'slug', label: 'Slug', rows: 1 },
  { key: 'body_markdown', label: 'Volledige vacaturetekst (website)', rows: 16 },
  { key: 'vacaturebank_variant', label: 'Vacaturebankvariant', rows: 8 },
  { key: 'social_text', label: 'Social media tekst', rows: 5 },
  { key: 'preview_text', label: 'Korte preview', rows: 3 },
];

const copy = (value: string) => {
  navigator.clipboard.writeText(value ?? '');
  toast.success('Gekopieerd');
};

const CopyButton = ({ value }: { value: string }) => (
  <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => copy(value)}>
    <Copy className="h-3.5 w-3.5" /> Kopiëren
  </Button>
);

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

const VacancyTextTab = ({ vacancy, canEdit }: Props) => {
  const qc = useQueryClient();
  const vacancyId = vacancy.id as string;
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: seo, isLoading } = useQuery({
    queryKey: ['vacancy-seo', vacancyId],
    queryFn: () => unwrap(
      supabase.from('vacancy_seo_content').select('*').eq('vacancy_id', vacancyId).maybeSingle(),
    ),
  });

  // Lokale bewerk-state voor de tekstvelden.
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!seo) return;
    const next: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) next[f.key] = ((seo as any)[f.key] ?? '') as string;
    setFields(next);
  }, [seo]);

  const dirty = seo
    ? EDITABLE_FIELDS.some((f) => (fields[f.key] ?? '') !== (((seo as any)[f.key] ?? '') as string))
    : false;

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string | null> = {};
      for (const f of EDITABLE_FIELDS) payload[f.key] = fields[f.key]?.trim() ? fields[f.key] : null;
      await unwrap(supabase.from('vacancy_seo_content').update(payload).eq('vacancy_id', vacancyId));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-seo', vacancyId] });
      toast.success('Wijzigingen opgeslagen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetFields = () => {
    if (!seo) return;
    const next: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) next[f.key] = ((seo as any)[f.key] ?? '') as string;
    setFields(next);
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Laden…</div>;

  // Nog geen tekst gegenereerd → lege staat.
  if (!seo) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <p className="font-medium">Nog geen vacaturetekst</p>
              <p className="text-sm text-muted-foreground max-w-md mt-1">
                Laat AI een complete, SEO-geoptimaliseerde vacaturetekst schrijven — inclusief meta description,
                slug, FAQ, JobPosting-schema, social- en vacaturebankvariant en een matchingprofiel.
              </p>
            </div>
            {canEdit && (
              <Button onClick={() => setDialogOpen(true)} className="gap-1.5 mt-1">
                <Sparkles className="h-4 w-4" /> Genereer vacaturetekst
              </Button>
            )}
          </CardContent>
        </Card>
        <VacancyTextGeneratorDialog open={dialogOpen} onOpenChange={setDialogOpen} vacancy={vacancy} />
      </>
    );
  }

  const content = ((seo as any).content ?? {}) as Record<string, any>;
  const matching = (content.matching_profile ?? {}) as Record<string, any>;
  const seoReasoning = (content.seo_reasoning ?? {}) as Record<string, any>;
  const generatedAt = (seo as any).generated_at
    ? new Date((seo as any).generated_at).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className="space-y-4">
      {/* Kopregel */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {generatedAt ? `Gegenereerd op ${generatedAt}` : 'Gegenereerd'}
          {(seo as any).model ? ` · ${(seo as any).model}` : ''}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {canEdit && dirty && (
            <>
              <Button variant="ghost" size="sm" onClick={resetFields} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" /> Herstellen
              </Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} className="gap-1.5">
                <Save className="h-3.5 w-3.5" /> {save.isPending ? 'Opslaan…' : 'Wijzigingen opslaan'}
              </Button>
            </>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Opnieuw genereren
            </Button>
          )}
        </div>
      </div>

      {/* Bewerkbare teksten */}
      {EDITABLE_FIELDS.map((f) => {
        const value = fields[f.key] ?? '';
        const over = f.maxChars ? value.length > f.maxChars : false;
        return (
          <Card key={f.key}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">{f.label}</CardTitle>
              <CopyButton value={value} />
            </CardHeader>
            <CardContent className="space-y-1">
              <Textarea
                value={value}
                onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))}
                rows={f.rows}
                readOnly={!canEdit}
                className="text-sm"
              />
              {f.maxChars && (
                <p className={`text-xs ${over ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                  {value.length} / {f.maxChars} tekens
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Titelvarianten */}
      {asArray(content.title_variants).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Titelvarianten</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {asArray(content.title_variants).map((t: string, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex-1 text-sm">{t}</span>
                <CopyButton value={t} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* FAQ */}
      {asArray(content.faq).length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">FAQ</CardTitle>
            <CopyButton value={asArray(content.faq).map((q: any) => `${q.vraag}\n${q.antwoord}`).join('\n\n')} />
          </CardHeader>
          <CardContent className="space-y-3">
            {asArray(content.faq).map((q: any, i: number) => (
              <div key={i}>
                <p className="text-sm font-medium">{q.vraag}</p>
                <p className="text-sm text-muted-foreground">{q.antwoord}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* CTA + zoekwoorden */}
      {(asArray(content.cta_variants).length > 0 || asArray(content.keywords).length > 0) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Call-to-action & zoekwoorden</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {asArray(content.cta_variants).length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Call-to-action varianten</Label>
                {asArray(content.cta_variants).map((c: string, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex-1 text-sm">{c}</span>
                    <CopyButton value={c} />
                  </div>
                ))}
              </div>
            )}
            {asArray(content.keywords).length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Zoekwoorden</Label>
                <div className="flex flex-wrap gap-1.5">
                  {asArray(content.keywords).map((k: string, i: number) => (
                    <Badge key={i} variant="secondary" className="font-normal">{k}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Matchingprofiel */}
      {(matching.ideale_kandidaat || asArray(matching.harde_selectiecriteria).length > 0) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">AI-matchingprofiel</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {matching.ideale_kandidaat && (
              <div><Label className="text-xs text-muted-foreground">Ideale kandidaat</Label><p>{matching.ideale_kandidaat}</p></div>
            )}
            {asArray(matching.harde_selectiecriteria).length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">Harde selectiecriteria</Label>
                <ul className="list-disc list-inside">{asArray(matching.harde_selectiecriteria).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {asArray(matching.zachte_voorkeuren).length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">Zachte voorkeuren</Label>
                <ul className="list-disc list-inside">{asArray(matching.zachte_voorkeuren).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {matching.niet_passend && (
              <div><Label className="text-xs text-muted-foreground">Niet passend</Label><p>{matching.niet_passend}</p></div>
            )}
          </CardContent>
        </Card>
      )}

      {/* SEO-onderbouwing */}
      {seoReasoning.primair_zoekwoord && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">SEO-onderbouwing</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Primair zoekwoord:</span> {seoReasoning.primair_zoekwoord}</p>
            {asArray(seoReasoning.secundaire_zoekwoorden).length > 0 && (
              <p><span className="text-muted-foreground">Secundair:</span> {asArray(seoReasoning.secundaire_zoekwoorden).join(', ')}</p>
            )}
            {seoReasoning.verwerking && <p className="text-muted-foreground">{seoReasoning.verwerking}</p>}
            {asArray(seoReasoning.vervolgacties).length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">Vervolgacties</Label>
                <ul className="list-disc list-inside">{asArray(seoReasoning.vervolgacties).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* JobPosting JSON-LD */}
      {content.job_posting_jsonld && Object.keys(content.job_posting_jsonld).length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">JobPosting JSON-LD</CardTitle>
            <CopyButton value={JSON.stringify(content.job_posting_jsonld, null, 2)} />
          </CardHeader>
          <CardContent>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(content.job_posting_jsonld, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <VacancyTextGeneratorDialog open={dialogOpen} onOpenChange={setDialogOpen} vacancy={vacancy} />
    </div>
  );
};

export default VacancyTextTab;
