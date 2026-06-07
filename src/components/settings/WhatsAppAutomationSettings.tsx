import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { DEFAULT_WHATSAPP_AUTOMATION_SETTINGS, normalizeWhatsAppAutomationSettings } from '@/lib/whatsapp-automation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const parseDays = (value: string) =>
  value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isFinite(day) && day >= 0)
    .filter((day, index, all) => all.indexOf(day) === index)
    .sort((a, b) => a - b);

const formatDays = (days: number[]) => days.join(', ');

const WhatsAppAutomationSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(DEFAULT_WHATSAPP_AUTOMATION_SETTINGS);
  const [onboardingDays, setOnboardingDays] = useState(formatDays(DEFAULT_WHATSAPP_AUTOMATION_SETTINGS.onboarding_reminder_days));
  const [documentDays, setDocumentDays] = useState(formatDays(DEFAULT_WHATSAPP_AUTOMATION_SETTINGS.document_expiry_days));

  const { data: org } = useQuery({
    queryKey: ['whatsapp-automation-settings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('settings').eq('id', orgId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  useEffect(() => {
    const next = normalizeWhatsAppAutomationSettings((org?.settings as any)?.whatsapp_automation_settings);
    setDraft(next);
    setOnboardingDays(formatDays(next.onboarding_reminder_days));
    setDocumentDays(formatDays(next.document_expiry_days));
  }, [org?.settings]);

  const setValue = (key: keyof typeof DEFAULT_WHATSAPP_AUTOMATION_SETTINGS, value: any) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveSettings = useMutation({
    mutationFn: async () => {
      const next = normalizeWhatsAppAutomationSettings({
        ...draft,
        onboarding_reminder_days: parseDays(onboardingDays),
        document_expiry_days: parseDays(documentDays),
      });
      const settings = (org?.settings && typeof org.settings === 'object') ? org.settings as Record<string, unknown> : {};
      const { error } = await supabase
        .from('organizations')
        .update({ settings: { ...settings, whatsapp_automation_settings: next } as any })
        .eq('id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-automation-settings', orgId] });
      toast.success('Communicatie-instellingen opgeslagen');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4 text-green-600" /> WhatsApp automatiseringen
        </CardTitle>
        <CardDescription>Beheer bulkcommunicatie, reminders, documentmeldingen, plaatsingsbevestigingen en ziekmeldingen.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border p-3 flex items-center justify-between gap-3">
            <div>
              <Label>Bulkcommunicatie actief</Label>
              <p className="text-xs text-muted-foreground">Campagnes vullen automatisch ontvangers op basis van segmentfilters.</p>
            </div>
            <Switch checked={draft.bulk_enabled} onCheckedChange={(v) => setValue('bulk_enabled', v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Per minuut</Label>
              <Input type="number" min={1} value={draft.bulk_rate_limit_per_minute} onChange={(e) => setValue('bulk_rate_limit_per_minute', Number(e.target.value))} />
            </div>
            <div>
              <Label>Per uur</Label>
              <Input type="number" min={1} value={draft.bulk_rate_limit_per_hour} onChange={(e) => setValue('bulk_rate_limit_per_hour', Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 md:col-span-2">
            <div>
              <Label>Batchgrootte</Label>
              <Input type="number" min={1} value={draft.bulk_batch_size} onChange={(e) => setValue('bulk_batch_size', Number(e.target.value))} />
            </div>
            <div>
              <Label>Parallel</Label>
              <Input type="number" min={1} value={draft.bulk_max_concurrent} onChange={(e) => setValue('bulk_max_concurrent', Number(e.target.value))} />
            </div>
            <div>
              <Label>Pauze ms</Label>
              <Input type="number" min={0} value={draft.bulk_delay_between_batches_ms} onChange={(e) => setValue('bulk_delay_between_batches_ms', Number(e.target.value))} />
            </div>
          </div>

          <div className="rounded-md border p-3 flex items-center justify-between gap-3">
            <div>
              <Label>Onboarding-reminders</Label>
              <p className="text-xs text-muted-foreground">Dagelijkse WhatsApp reminder voor open onboarding-links.</p>
            </div>
            <Switch checked={draft.onboarding_reminders_enabled} onCheckedChange={(v) => setValue('onboarding_reminders_enabled', v)} />
          </div>
          <div>
            <Label>Reminder dagen</Label>
            <Input value={onboardingDays} onChange={(e) => setOnboardingDays(e.target.value)} placeholder="1, 3, 7" />
          </div>

          <div className="rounded-md border p-3 flex items-center justify-between gap-3">
            <div>
              <Label>Documentverval via WhatsApp</Label>
              <p className="text-xs text-muted-foreground">0 betekent: op of na verloopdatum.</p>
            </div>
            <Switch checked={draft.document_expiry_enabled} onCheckedChange={(v) => setValue('document_expiry_enabled', v)} />
          </div>
          <div>
            <Label>Document dagen</Label>
            <Input value={documentDays} onChange={(e) => setDocumentDays(e.target.value)} placeholder="30, 14, 7, 0" />
          </div>

          <div className="rounded-md border p-3 flex items-center justify-between gap-3">
            <div>
              <Label>Plaatsing naar medewerker</Label>
              <p className="text-xs text-muted-foreground">Stuurt WhatsApp naast de bestaande plaatsingsbevestiging.</p>
            </div>
            <Switch checked={draft.placement_employee_whatsapp_enabled} onCheckedChange={(v) => setValue('placement_employee_whatsapp_enabled', v)} />
          </div>
          <div className="rounded-md border p-3 flex items-center justify-between gap-3">
            <div>
              <Label>Plaatsing naar opdrachtgever</Label>
              <p className="text-xs text-muted-foreground">Gebruikt primair contactnummer of bedrijfsnummer.</p>
            </div>
            <Switch checked={draft.placement_client_whatsapp_enabled} onCheckedChange={(v) => setValue('placement_client_whatsapp_enabled', v)} />
          </div>

          <div className="rounded-md border p-3 flex items-center justify-between gap-3">
            <div>
              <Label>Ziekmelding via WhatsApp</Label>
              <p className="text-xs text-muted-foreground">Verifieert op telefoonnummer en vraagt optioneel de reden.</p>
            </div>
            <Switch checked={draft.sick_report_enabled} onCheckedChange={(v) => setValue('sick_report_enabled', v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Deadline</Label>
              <Input type="time" value={draft.sick_report_deadline_time} onChange={(e) => setValue('sick_report_deadline_time', e.target.value)} />
            </div>
            <div>
              <Label>Na deadline prioriteit</Label>
              <Select value={draft.sick_report_after_deadline_task_priority} onValueChange={(v) => setValue('sick_report_after_deadline_task_priority', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normaal</SelectItem>
                  <SelectItem value="high">Hoog</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="rounded-md border p-3 flex items-center justify-between gap-3 md:col-span-2">
            <div>
              <Label>Vraag reden bij ziekmelding</Label>
              <p className="text-xs text-muted-foreground">Start een korte WhatsApp flow voordat het ticket wordt aangemaakt.</p>
            </div>
            <Switch checked={draft.sick_report_ask_reason} onCheckedChange={(v) => setValue('sick_report_ask_reason', v)} />
          </div>
        </div>

        <div className="grid gap-4">
          <div>
            <Label>Documentbericht</Label>
            <Textarea value={draft.document_expiry_message} onChange={(e) => setValue('document_expiry_message', e.target.value)} rows={2} />
          </div>
          <div>
            <Label>Plaatsingsbericht medewerker</Label>
            <Textarea value={draft.placement_employee_message} onChange={(e) => setValue('placement_employee_message', e.target.value)} rows={2} />
          </div>
          <div>
            <Label>Plaatsingsbericht opdrachtgever</Label>
            <Textarea value={draft.placement_client_message} onChange={(e) => setValue('placement_client_message', e.target.value)} rows={2} />
          </div>
          <div>
            <Label>Ziekmelding bevestiging</Label>
            <Textarea value={draft.sick_report_confirmation_message} onChange={(e) => setValue('sick_report_confirmation_message', e.target.value)} rows={2} />
          </div>
          <p className="text-xs text-muted-foreground">
            Variabelen: {'{{first_name}}'}, {'{{document_name}}'}, {'{{expiry_text}}'}, {'{{function_name}}'}, {'{{company_name}}'}, {'{{start_date}}'}, {'{{work_location}}'}, {'{{employee_name}}'}, {'{{contact_name}}'}.
          </p>
        </div>

        <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending} className="gap-2">
          <Save className="h-4 w-4" /> Automatiseringen opslaan
        </Button>
      </CardContent>
    </Card>
  );
};

export default WhatsAppAutomationSettings;
