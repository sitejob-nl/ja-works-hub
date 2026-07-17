// src/components/whatsapp/TemplatePicker.tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Search, RefreshCw, Loader2, ArrowLeft, Send } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: any[];
}

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onSend: (template: { name: string; language: string; components?: any[] }) => void;
  isSending: boolean;
}

type Step = 'list' | 'params' | 'preview';

const LANGUAGE_LABELS: Record<string, string> = {
  nl: 'NL',
  en: 'EN',
  en_US: 'EN',
  en_GB: 'EN',
  pl: 'PL',
  ro: 'RO',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  pt: 'PT',
  pt_PT: 'PT',
  pt_BR: 'BR',
  uk: 'UK',
  ru: 'RU',
};

function extractBodyText(components: any[]): string {
  const body = components?.find((c: any) => c.type === 'BODY');
  return body?.text ?? '';
}

function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? [];
  return [...new Set(matches)];
}

function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => values[n] ?? `{{${n}}}`);
}

export function TemplatePicker({ open, onOpenChange, orgId, onSend, isSending }: TemplatePickerProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState('all');
  const [step, setStep] = useState<Step>('list');
  const [selected, setSelected] = useState<WhatsAppTemplate | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['whatsapp-templates', orgId],
    queryFn: async (): Promise<WhatsAppTemplate[]> => {
      const { data, error } = await (supabase as any)
        .from('whatsapp_templates')
        .select('*')
        .eq('organization_id', orgId)
        .eq('status', 'APPROVED')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId && open,
  });

  const filtered = templates.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (langFilter !== 'all') {
      const tLang = t.language.toLowerCase().replace('_', '');
      const fLang = langFilter.toLowerCase();
      if (!tLang.startsWith(fLang)) return false;
    }
    return true;
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('whatsapp-templates-sync', {
        body: { organization_id: orgId },
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-templates', orgId] });
      toast.success('Templates gesynchroniseerd');
    } catch (err: any) {
      toast.error('Synchronisatie mislukt: ' + (err.message ?? 'Onbekende fout'));
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectTemplate = (template: WhatsAppTemplate) => {
    setSelected(template);
    setParamValues({});
    const bodyText = extractBodyText(template.components);
    const vars = extractVariables(bodyText);
    if (vars.length === 0) {
      setStep('preview');
    } else {
      setStep('params');
    }
  };

  const handleSend = () => {
    if (!selected) return;

    const bodyText = extractBodyText(selected.components);
    const vars = extractVariables(bodyText);
    const components: any[] = [];

    if (vars.length > 0) {
      components.push({
        type: 'body',
        parameters: vars.map((v) => {
          const idx = v.replace(/\{\{|\}\}/g, '');
          return { type: 'text', text: paramValues[idx] ?? '' };
        }),
      });
    }

    onSend({
      name: selected.name,
      language: selected.language,
      components: components.length > 0 ? components : undefined,
    });
    handleClose();
  };

  const handleClose = () => {
    setStep('list');
    setSelected(null);
    setParamValues({});
    onOpenChange(false);
  };

  const bodyText = selected ? extractBodyText(selected.components) : '';
  const vars = extractVariables(bodyText);
  const preview = fillVariables(bodyText, paramValues);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step !== 'list' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 -ml-1"
                onClick={() => setStep('list')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>
              {step === 'list' && 'Template kiezen'}
              {step === 'params' && 'Variabelen invullen'}
              {step === 'preview' && 'Voorbeeld & versturen'}
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Step: list */}
        {step === 'list' && (
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Zoek template..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleSync}
                disabled={syncing}
                title="Synchroniseer templates van Meta"
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>

            <Tabs value={langFilter} onValueChange={setLangFilter}>
              <TabsList className="w-full h-8">
                <TabsTrigger value="all" className="text-xs flex-1">Alle</TabsTrigger>
                <TabsTrigger value="nl" className="text-xs flex-1">NL</TabsTrigger>
                <TabsTrigger value="en" className="text-xs flex-1">EN</TabsTrigger>
                <TabsTrigger value="pl" className="text-xs flex-1">PL</TabsTrigger>
                <TabsTrigger value="ro" className="text-xs flex-1">RO</TabsTrigger>
              </TabsList>
            </Tabs>

            <ScrollArea className="flex-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {templates.length === 0
                    ? 'Geen goedgekeurde templates. Synchroniseer eerst.'
                    : 'Geen resultaten'}
                </div>
              ) : (
                <div className="space-y-1 pr-2">
                  {filtered.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTemplate(t)}
                      className="w-full text-left p-3 rounded-md border hover:bg-muted/50 transition-colors space-y-1"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium flex-1 truncate">{t.name}</span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {LANGUAGE_LABELS[t.language] ?? t.language.toUpperCase()}
                        </Badge>
                        <Badge variant="secondary" className="text-xs shrink-0 capitalize">
                          {t.category?.toLowerCase()}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {extractBodyText(t.components)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Step: params */}
        {step === 'params' && selected && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Vul de variabelen in voor <strong>{selected.name}</strong>:
            </p>
            <div className="space-y-3">
              {vars.map((v) => {
                const idx = v.replace(/\{\{|\}\}/g, '');
                return (
                  <div key={idx} className="space-y-1">
                    <Label className="text-xs">{`Variabele ${idx}`}</Label>
                    <Input
                      placeholder={`Waarde voor {{${idx}}}`}
                      value={paramValues[idx] ?? ''}
                      onChange={(e) =>
                        setParamValues((prev) => ({ ...prev, [idx]: e.target.value }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            <Button
              onClick={() => setStep('preview')}
              disabled={vars.some((v) => {
                const idx = v.replace(/\{\{|\}\}/g, '');
                return !paramValues[idx]?.trim();
              })}
            >
              Volgende: voorbeeld
            </Button>
          </div>
        )}

        {/* Step: preview */}
        {step === 'preview' && selected && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">Voorbeeld van het bericht:</p>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-sm whitespace-pre-wrap">{preview || bodyText}</p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setStep(vars.length > 0 ? 'params' : 'list')}>
                Terug
              </Button>
              <Button
                onClick={handleSend}
                disabled={isSending}
                className="gap-2"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Versturen
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
