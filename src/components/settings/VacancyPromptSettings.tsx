import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FileText, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { unwrap } from '@/lib/db';

// Ruime bovengrens — de masterprompt is een volledige copywriting/SEO-instructie.
// De server (`_shared/sanitize-org-prompt.ts`, VACANCY_PROMPT_MAX_LENGTH) is autoritatief.
const PROMPT_MAX_LENGTH = 20000;

// Frontend-validatie spiegelt de server-side sanitizer — instant feedback voor de admin.
const FORBIDDEN_PROMPT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /<\|[^|]*\|>/, reason: 'control-tokens (<|...|>)' },
  { pattern: /\[\/?INST\]/i, reason: '[INST] tags' },
  { pattern: /<\/?(system|assistant|human|user)\b/i, reason: 'rol-tags' },
  { pattern: /\btool[\s_-]*choice\b/i, reason: '"tool choice"' },
  { pattern: /ignore (all |any |the )?(previous|prior|above)\s+instructions/i, reason: '"ignore previous instructions"' },
];

function detectForbiddenPatterns(text: string): string[] {
  const hits: string[] = [];
  for (const { pattern, reason } of FORBIDDEN_PROMPT_PATTERNS) {
    if (pattern.test(text)) hits.push(reason);
  }
  return hits;
}

const VacancyPromptSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  const { data: org } = useQuery({
    queryKey: ['organization-ai-settings', orgId],
    queryFn: () => unwrap(
      supabase.from('organizations').select('settings').eq('id', orgId).single(),
    ),
  });

  const settings = (org?.settings as Record<string, unknown> | null) ?? {};
  const savedPrompt = typeof settings.vacancy_generation_prompt === 'string'
    ? settings.vacancy_generation_prompt
    : '';

  const [prompt, setPrompt] = useState(savedPrompt);
  useEffect(() => setPrompt(savedPrompt), [savedPrompt]);

  const forbiddenHits = detectForbiddenPatterns(prompt);
  const overLimit = prompt.length > PROMPT_MAX_LENGTH;
  const dirty = prompt !== savedPrompt;
  const hasIssues = forbiddenHits.length > 0 || overLimit;

  const savePrompt = useMutation({
    mutationFn: async (next: string) => {
      const newSettings = { ...settings, vacancy_generation_prompt: next };
      await unwrap(supabase.from('organizations').update({ settings: newSettings }).eq('id', orgId));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization-ai-settings', orgId] });
      toast.success('Vacatureprompt opgeslagen');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" /> AI-vacaturetekstgenerator
        </CardTitle>
        <CardDescription>
          De masterprompt waarmee AI vacatureteksten schrijft (op de vacature onder “Vacaturetekst”).
          Model: Claude Sonnet. Verbruikt AI-saldo per generatie.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Eigen masterprompt</Label>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Laat dit veld <span className="font-medium">leeg</span> om de ingebouwde JA Werkt-standaardprompt te gebruiken.
            Vul je een eigen prompt in, dan is die leidend voor stijl, structuur en SEO.
            <br />
            <span className="font-medium">Veiligheid:</span> de kern-guardrails staan vast — de opdrachtgever
            wordt nooit genoemd, de lengte-limieten en het output-schema blijven afgedwongen. Niet-toegestane
            tekens en patronen worden automatisch gefilterd.
          </p>
        </div>

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Leeg = ingebouwde standaardprompt. Plak hier een eigen masterprompt om die te overschrijven."
          className="min-h-[220px] text-sm font-mono"
          maxLength={PROMPT_MAX_LENGTH + 500}
        />

        <div className="flex items-center justify-between text-xs">
          <span className={overLimit ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
            {prompt.length} / {PROMPT_MAX_LENGTH} tekens
          </span>
          <span className="text-muted-foreground">{dirty ? 'Niet opgeslagen' : 'Opgeslagen'}</span>
        </div>

        {forbiddenHits.length > 0 && (
          <div className="rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/20 p-3 text-xs">
            <p className="font-medium text-orange-700 dark:text-orange-400">
              Verboden patronen gevonden — deze worden automatisch gefilterd vóór gebruik:
            </p>
            <ul className="list-disc list-inside text-orange-700 dark:text-orange-400 mt-1">
              {forbiddenHits.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => savePrompt.mutate(prompt)}
            disabled={!dirty || hasIssues || savePrompt.isPending}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" /> Opslaan
          </Button>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setPrompt(savedPrompt)} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Annuleren
            </Button>
          )}
          {savedPrompt && !dirty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setPrompt(''); savePrompt.mutate(''); }}
              className="gap-1.5 text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Herstel standaard
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default VacancyPromptSettings;
