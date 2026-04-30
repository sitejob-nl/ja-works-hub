import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Brain, Wallet, Cloud, Server, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

const formatEuro = (cents: number) =>
  (cents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });

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
    queryKey: ['organization-ai-settings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', orgId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: credits, isLoading: creditsLoading } = useQuery({
    queryKey: ['organization-credits', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_credits')
        .select('balance_cents, lifetime_topped_up_cents')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const settings = (org?.settings as Record<string, unknown> | null) ?? {};
  const provider = (settings.cv_ai_provider === 'cloud' ? 'cloud' : 'vps') as 'vps' | 'cloud';
  const savedAddendum = typeof settings.cv_prompt_addendum === 'string' ? settings.cv_prompt_addendum : '';

  // Lokale form-state voor het addendum (apart van saved value)
  const [addendum, setAddendum] = useState(savedAddendum);
  useEffect(() => setAddendum(savedAddendum), [savedAddendum]);

  const forbiddenHits = detectForbiddenPatterns(addendum);
  const overLimit = addendum.length > ORG_PROMPT_MAX_LENGTH;
  const dirty = addendum !== savedAddendum;
  const hasIssues = forbiddenHits.length > 0 || overLimit;

  const setProvider = useMutation({
    mutationFn: async (next: 'vps' | 'cloud') => {
      const newSettings = { ...settings, cv_ai_provider: next };
      const { error } = await supabase
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization-ai-settings', orgId] });
      toast.success('AI-provider opgeslagen');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveAddendum = useMutation({
    mutationFn: async (next: string) => {
      const newSettings = { ...settings, cv_prompt_addendum: next };
      const { error } = await supabase
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization-ai-settings', orgId] });
      toast.success('Prompt-addendum opgeslagen');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const balance = credits?.balance_cents ?? 0;
  const lifetime = credits?.lifetime_topped_up_cents ?? 0;
  const lowBalance = balance < 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4" /> AI CV-analyse
        </CardTitle>
        <CardDescription>
          Kies tussen onze eigen VPS (gratis, 1-3 min) en Cloud (sneller, ~10 sec, betaald per
          analyse)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <RadioGroup
          value={provider}
          onValueChange={(v) => setProvider.mutate(v as 'vps' | 'cloud')}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <Label
            htmlFor="provider-vps"
            className={`flex flex-col gap-2 rounded-lg border p-4 cursor-pointer transition ${
              provider === 'vps' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
            }`}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="vps" id="provider-vps" />
              <Server className="h-4 w-4" />
              <span className="font-medium">VPS</span>
              <span className="ml-auto text-xs text-muted-foreground">gratis</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Eigen Hetzner-server met Qwen3-14B. Resultaat na 1-3 minuten via realtime-update.
            </p>
          </Label>

          <Label
            htmlFor="provider-cloud"
            className={`flex flex-col gap-2 rounded-lg border p-4 cursor-pointer transition ${
              provider === 'cloud'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-accent'
            }`}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="cloud" id="provider-cloud" />
              <Cloud className="h-4 w-4" />
              <span className="font-medium">Cloud</span>
              <span className="ml-auto text-xs text-muted-foreground">betaald</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Anthropic Claude Haiku 4.5. Resultaat na ~10 seconden. Trekt credits.
            </p>
          </Label>
        </RadioGroup>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Cloud-saldo</span>
          </div>
          {creditsLoading ? (
            <p className="text-sm text-muted-foreground">Laden...</p>
          ) : (
            <div className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl font-bold ${
                    lowBalance ? 'text-orange-600' : 'text-foreground'
                  }`}
                >
                  {formatEuro(balance)}
                </span>
                <span className="text-xs text-muted-foreground">resterend</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Totaal ooit toegekend: {formatEuro(lifetime)}
              </p>
              {lowBalance && (
                <p className="text-xs text-orange-600 mt-2">
                  Saldo loopt op zijn eind. Neem contact op met info@sitejob.nl voor bijvullen.
                </p>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Bij saldo €0 is de Cloud-knop in CV-analyses uitgeschakeld. Intercedenten kunnen dan
          nog steeds VPS gebruiken (gratis, langzamer). Bijvullen gaat via SiteJob.
        </p>

        {/* Prompt-addendum (alleen Cloud-pad) */}
        <div className="border-t border-border pt-6 space-y-3">
          <div>
            <Label className="text-sm font-medium">Eigen prompt-aanvulling (alleen Cloud)</Label>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Deze tekst wordt als organisatie-context aan de standaard analyse-prompt toegevoegd.
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
