import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Brain, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import AiCreditsPanel from '@/components/settings/AiCreditsPanel';
import { qk } from '@/lib/query-keys';
import { unwrap } from '@/lib/db';
import { toFriendlyError } from '@/lib/errorMessages';

const ORG_PROMPT_MAX_LENGTH = 2000;

// Frontend-validatie spiegelt de server-side sanitizer (`_shared/sanitize-org-prompt.ts`).
// De server is altijd autoritatief; deze regex geeft de admin direct feedback.
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

const AiCvProviderSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  const { data: org } = useQuery({
    queryKey: qk.aiSettings(orgId),
    queryFn: () => unwrap(supabase
        .from('organizations')
        .select('settings')
        .eq('id', orgId)
        .single()),
  });

  const settings = (org?.settings as Record<string, unknown> | null) ?? {};
  const savedAddendum = typeof settings.candidate_analysis_prompt === 'string'
    ? settings.candidate_analysis_prompt
    : typeof settings.cv_prompt_addendum === 'string'
      ? settings.cv_prompt_addendum
      : '';

  // Lokale form-state voor het addendum (apart van saved value)
  const [addendum, setAddendum] = useState(savedAddendum);
  useEffect(() => setAddendum(savedAddendum), [savedAddendum]);

  const forbiddenHits = detectForbiddenPatterns(addendum);
  const overLimit = addendum.length > ORG_PROMPT_MAX_LENGTH;
  const dirty = addendum !== savedAddendum;
  const hasIssues = forbiddenHits.length > 0 || overLimit;

  const saveAddendum = useMutation({
    mutationFn: async (next: string) => {
      const newSettings = { ...settings, candidate_analysis_prompt: next, cv_prompt_addendum: next };
      await unwrap(supabase
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', orgId));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.aiSettings(orgId) });
      toast.success('Analyseprompt opgeslagen');
    },
    onError: (error) => toast.error(toFriendlyError(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4" /> AI kandidaatdossier-analyse
        </CardTitle>
        <CardDescription>
          Analyseer CV, documenten en interne notities via Gemini.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Provider</span>
            <span className="ml-auto text-sm font-medium">Gemini</span>
          </div>
        </div>

        <AiCreditsPanel orgId={orgId} />

        {/* Prompt-addendum voor Gemini */}
        <div className="border-t border-border pt-6 space-y-3">
          <div>
            <Label className="text-sm font-medium">Eigen analyseprompt</Label>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Deze tekst wordt als organisatie-context aan de standaard analyseprompt toegevoegd
              en gaat mee naar Gemini.
              Handig voor sector-specifieke focus, voorkeursfuncties of klant-specifieke nuances.
              <br />
              <span className="font-medium">Veiligheid:</span> de kerninstructies en het JSON-schema
              zijn vast — je kunt ze niet overschrijven. Niet-toegestane tekens en patronen worden
              automatisch gefilterd.
            </p>
          </div>

          <Textarea
            value={addendum}
            onChange={(e) => setAddendum(e.target.value)}
            placeholder="Bijvoorbeeld: 'Wij focussen op productiemedewerkers in de voedingsmiddelen­industrie. Geef extra aandacht aan HACCP-ervaring en ploegen­bereidheid.'"
            className="min-h-[120px] text-sm font-mono"
            maxLength={ORG_PROMPT_MAX_LENGTH + 200}
          />

          <div className="flex items-center justify-between text-xs">
            <span
              className={`${
                overLimit ? 'text-red-600 font-medium' : 'text-muted-foreground'
              }`}
            >
              {addendum.length} / {ORG_PROMPT_MAX_LENGTH} tekens
            </span>
            <span className="text-muted-foreground">
              {dirty ? 'Niet opgeslagen' : 'Opgeslagen'}
            </span>
          </div>

          {forbiddenHits.length > 0 && (
            <div className="rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/20 p-3 text-xs">
              <p className="font-medium text-orange-700 dark:text-orange-400">
                Verboden patronen gevonden — deze worden automatisch gefilterd vóór gebruik:
              </p>
              <ul className="list-disc list-inside text-orange-700 dark:text-orange-400 mt-1">
                {forbiddenHits.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="text-orange-700 dark:text-orange-400 mt-2">
                Tip: schrijf instructies in normale woorden, zonder LLM-control-tokens.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => saveAddendum.mutate(addendum)}
              disabled={!dirty || hasIssues || saveAddendum.isPending}
              className="gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              Opslaan
            </Button>
            {dirty && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAddendum(savedAddendum)}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Annuleren
              </Button>
            )}
            {savedAddendum && !dirty && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAddendum('');
                  saveAddendum.mutate('');
                }}
                className="gap-1.5 text-muted-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Wissen
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AiCvProviderSettings;
