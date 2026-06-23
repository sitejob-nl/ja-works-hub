import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Eye, FileText, Mail, MessageSquare, Search, Send, Settings2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { renderBrandedEmailPreview, resolvePreviewBrand, sampleContentForFlow } from '@/lib/email-brand-preview';

type FlowStatus = 'beheerbaar' | 'juridisch' | 'gedeeltelijk' | 'gegenereerd' | 'extern';
type FlowSource = 'email_templates' | 'contract_templates' | 'whatsapp_templates' | 'generated_html' | 'mixed';

interface MailFlowDefinition {
  id: string;
  name: string;
  trigger: string;
  sender: string;
  source: FlowSource;
  status: FlowStatus;
  templateSource: string;
  codePath: string;
  emailCategories?: string[];
  contractTypes?: string[];
  note?: string;
}

const FLOW_DEFINITIONS: MailFlowDefinition[] = [
  {
    id: 'manual-email',
    name: 'Handmatige e-mail',
    trigger: 'Gebruiker kiest ontvanger en eventueel template',
    sender: 'Outlook Graph via outlook-send-mail',
    source: 'email_templates',
    status: 'beheerbaar',
    templateSource: 'Alle actieve e-mailtemplates, optioneel gefilterd per scherm',
    codePath: 'src/components/email/EmailSendDialog.tsx',
    note: 'Afzender is de gekozen of standaard Outlook mailbox met mail_send recht.',
  },
  {
    id: 'employee-portal-invite',
    name: 'Medewerkerportaal uitnodiging',
    trigger: 'Portaaltoegang activeren bij medewerker/kandidaat',
    sender: 'Outlook Graph via outlook-send-mail',
    source: 'email_templates',
    status: 'gedeeltelijk',
    templateSource: 'Laatste actieve e-mailtemplate met categorie Uitnodiging; fallback HTML als er geen template is',
    codePath: 'src/components/employees/PortalActivateSheet.tsx',
    emailCategories: ['invitation'],
  },
  {
    id: 'client-portal-invite',
    name: 'Opdrachtgeverportaal uitnodiging',
    trigger: 'Portaaltoegang activeren bij contactpersoon/opdrachtgever',
    sender: 'Outlook Graph via outlook-send-mail',
    source: 'generated_html',
    status: 'gegenereerd',
    templateSource: 'Vaste HTML in de component',
    codePath: 'src/components/companies/ClientPortalActivateSheet.tsx',
    note: 'Nog niet gekoppeld aan email_templates.',
  },
  {
    id: 'birthday-loyalty',
    name: 'Verjaardagsmail en bonus',
    trigger: 'Dagelijkse birthday-loyalty-cron rond 07:00 lokale tijd',
    sender: 'Outlook Graph via sendViaOutlookAccount',
    source: 'email_templates',
    status: 'beheerbaar',
    templateSource: 'Gekozen birthday_email_template_id in engagement-instellingen; fallback HTML als niets is gekozen',
    codePath: 'supabase/functions/birthday-loyalty-cron/index.ts',
  },
  {
    id: 'campaigns',
    name: 'Bulkcampagnes',
    trigger: 'Campagneprocessor voor geselecteerde doelgroep',
    sender: 'Outlook Graph via sendViaOutlookAccount',
    source: 'email_templates',
    status: 'beheerbaar',
    templateSource: 'bulk_campaigns.email_template_id naar email_templates',
    codePath: 'supabase/functions/email-campaign-processor/index.ts',
    emailCategories: ['campaign'],
  },
  {
    id: 'placement-client',
    name: 'Plaatsingsbevestiging opdrachtgever',
    trigger: 'Plaatsing bevestigen en e-mail naar opdrachtgever aanvinken',
    sender: 'Outlook Graph via sendViaOutlookAccount; concept in communications bij fallback',
    source: 'contract_templates',
    status: 'juridisch',
    templateSource: 'Actieve contract_template placement_confirmation_client plus general_terms',
    codePath: 'supabase/functions/send-placement-confirmation/index.ts',
    contractTypes: ['placement_confirmation_client', 'general_terms'],
  },
  {
    id: 'placement-employee',
    name: 'Plaatsingsbevestiging medewerker',
    trigger: 'Plaatsing bevestigen en e-mail naar medewerker aanvinken',
    sender: 'Outlook Graph via sendViaOutlookAccount; concept in communications bij fallback',
    source: 'contract_templates',
    status: 'juridisch',
    templateSource: 'Actieve contract_template placement_confirmation_employee',
    codePath: 'supabase/functions/send-placement-confirmation/index.ts',
    contractTypes: ['placement_confirmation_employee'],
  },
  {
    id: 'legal-signing',
    name: 'Contracten en ondertekening',
    trigger: 'Contract genereren/versturen vanuit medewerker of woning',
    sender: 'Signing-flow en communicatiehistorie',
    source: 'contract_templates',
    status: 'juridisch',
    templateSource: 'Contracttemplates: arbeid, huisregels, voertuig, inhuur, onderhuur',
    codePath: 'src/components/settings/ContractTemplatesSettings.tsx',
    contractTypes: ['employment_contract', 'house_rules', 'vehicle_agreement', 'rental_in', 'rental_sublet'],
  },
  {
    id: 'ai-analysis',
    name: 'AI-analyse delen',
    trigger: 'CV/AI-analyse delen per e-mail',
    sender: 'Outlook Graph via sendViaOutlookAccount',
    source: 'generated_html',
    status: 'gegenereerd',
    templateSource: 'HTML wordt opgebouwd uit analysegegevens',
    codePath: 'supabase/functions/send-ai-analysis/index.ts',
  },
  {
    id: 'match-proposal',
    name: 'Matchvoorstel',
    trigger: 'Kandidaat voorstellen aan opdrachtgever',
    sender: 'Outlook Graph via sendViaOutlookAccount',
    source: 'generated_html',
    status: 'gegenereerd',
    templateSource: 'HTML wordt opgebouwd uit match/vacature/kandidaatgegevens',
    codePath: 'supabase/functions/send-match-proposal/index.ts',
  },
  {
    id: 'damage-report',
    name: 'Schade- of pechmelding',
    trigger: 'Schademelding versturen naar ingestelde interne route',
    sender: 'Outlook Graph via sendViaOutlookAccount',
    source: 'generated_html',
    status: 'gegenereerd',
    templateSource: 'HTML wordt opgebouwd uit voertuig, bestuurder, schade en foto-informatie',
    codePath: 'supabase/functions/send-damage-report/index.ts',
  },
  {
    id: 'timesheet-approval',
    name: 'Uren ter goedkeuring',
    trigger: 'Urenbrief/uren ter goedkeuring verzenden',
    sender: 'Outlook Graph via sendViaOutlookAccount',
    source: 'generated_html',
    status: 'gegenereerd',
    templateSource: 'HTML wordt opgebouwd uit uren, plaatsing en opdrachtgever',
    codePath: 'supabase/functions/send-timesheet-approval/index.ts',
  },
  {
    id: 'sick-report',
    name: 'Ziekmelding notificatie',
    trigger: 'Ziekmelding vanuit portaal of interne workflow',
    sender: 'Outlook Graph en optioneel WhatsApp',
    source: 'mixed',
    status: 'gedeeltelijk',
    templateSource: 'Vaste HTML/tekst in sick-report-handler; WhatsApp apart via Meta',
    codePath: 'supabase/functions/_shared/sick-report-handler.ts',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp templates',
    trigger: 'WhatsApp chat, campagnes en plaatsingsbericht',
    sender: 'Meta WhatsApp Cloud API',
    source: 'whatsapp_templates',
    status: 'extern',
    templateSource: 'whatsapp_templates en Meta-templatebeheer, los van e-mailtemplates',
    codePath: 'src/components/whatsapp/TemplateManager.tsx',
  },
];

const STATUS_LABELS: Record<FlowStatus, string> = {
  beheerbaar: 'Beheerbaar',
  juridisch: 'Juridisch template',
  gedeeltelijk: 'Gedeeltelijk',
  gegenereerd: 'Gegenereerde HTML',
  extern: 'Extern kanaal',
};

const STATUS_CLASSES: Record<FlowStatus, string> = {
  beheerbaar: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  juridisch: 'bg-blue-100 text-blue-800 border-blue-200',
  gedeeltelijk: 'bg-amber-100 text-amber-800 border-amber-200',
  gegenereerd: 'bg-slate-100 text-slate-700 border-slate-200',
  extern: 'bg-purple-100 text-purple-800 border-purple-200',
};

const CATEGORY_LABELS: Record<string, string> = {
  general: 'Algemeen',
  onboarding: 'Onboarding',
  invitation: 'Uitnodiging',
  notification: 'Notificatie',
  campaign: 'Campagne',
  placement: 'Plaatsing',
};

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  employment_contract: 'Arbeidsovereenkomst',
  placement_confirmation: 'Plaatsingsbevestiging',
  placement_confirmation_client: 'Plaatsingsbevestiging opdrachtgever',
  placement_confirmation_employee: 'Plaatsingsbevestiging medewerker',
  general_terms: 'Algemene voorwaarden',
  house_rules: 'Huisregels',
  vehicle_agreement: 'Voertuigovereenkomst',
  rental_in: 'Inhuurcontract',
  rental_sublet: 'Onderhuurcontract',
};

function activeContract(template: any) {
  return template?.is_active && template?.template_status === 'actief' && !template?.is_placeholder;
}

// Waar de inhoud van deze flow beheerd wordt + de bijbehorende actie/route.
function flowSourceHint(flow: MailFlowDefinition): { note: string; to?: string; buttonLabel?: string } {
  switch (flow.source) {
    case 'email_templates': {
      const cats = flow.emailCategories?.map((c) => CATEGORY_LABELS[c] ?? c).join(', ');
      return { note: `Inhoud beheer je in de e-mailtemplate-lijst onderaan deze pagina${cats ? ` (categorie: ${cats})` : ''}.` };
    }
    case 'contract_templates':
      return { note: 'De inhoud komt uit de juridische contract-templates.', to: '/instellingen', buttonLabel: 'Naar contract-templates' };
    case 'whatsapp_templates':
      return { note: 'WhatsApp loopt via Meta-templates, los van de e-mailhuisstijl.', to: '/whatsapp', buttonLabel: 'Naar WhatsApp-templates' };
    default:
      return { note: 'De inhoud zit in de code; logo en accentkleur passen zich automatisch aan. Pas die aan via de huisstijl-instellingen.', to: '/instellingen', buttonLabel: 'Naar huisstijl-instellingen' };
  }
}

function TemplateBadges({ flow, emailTemplates, contractTemplates, birthdayTemplateId }: {
  flow: MailFlowDefinition;
  emailTemplates: any[];
  contractTemplates: any[];
  birthdayTemplateId?: string | null;
}) {
  if (flow.id === 'birthday-loyalty') {
    const selected = birthdayTemplateId
      ? emailTemplates.find((template) => template.id === birthdayTemplateId)
      : null;
    return selected ? (
      <Badge variant="outline" className="max-w-full truncate">
        {selected.name}
      </Badge>
    ) : (
      <span className="text-xs text-muted-foreground">Geen specifieke verjaardags-template gekozen</span>
    );
  }

  if (flow.source === 'email_templates') {
    if (!flow.emailCategories?.length) {
      const activeCount = emailTemplates.filter((template) => template.is_active).length;
      return <span className="text-xs text-muted-foreground">{activeCount} actieve e-mailtemplates beschikbaar</span>;
    }

    const matches = emailTemplates.filter((template) =>
      template.is_active && flow.emailCategories?.includes(template.category),
    );
    if (matches.length === 0) {
      return <span className="text-xs text-muted-foreground">Geen actieve template in deze categorie</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {matches.slice(0, 3).map((template) => (
          <Badge key={template.id} variant="outline" className="max-w-[180px] truncate">
            {template.name}
          </Badge>
        ))}
        {matches.length > 3 && <Badge variant="secondary">+{matches.length - 3}</Badge>}
      </div>
    );
  }

  if (flow.source === 'contract_templates') {
    const matches = contractTemplates.filter((template) =>
      flow.contractTypes?.includes(template.template_type),
    );
    if (matches.length === 0) {
      return <span className="text-xs text-muted-foreground">Nog geen contracttemplates aangemaakt</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {matches.slice(0, 4).map((template) => (
          <Badge
            key={template.id}
            variant="outline"
            className={cn('max-w-[180px] truncate', activeContract(template) ? 'border-emerald-300 text-emerald-800' : '')}
          >
            {template.name}
          </Badge>
        ))}
        {matches.length > 4 && <Badge variant="secondary">+{matches.length - 4}</Badge>}
      </div>
    );
  }

  if (flow.source === 'whatsapp_templates') {
    return <span className="text-xs text-muted-foreground">Zie WhatsApp templatebeheer</span>;
  }

  return <span className="text-xs text-muted-foreground">Geen beheerbaar template gekoppeld</span>;
}

const EmailTemplateFlowOverview = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const orgId = profile?.organization_id;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedFlow, setSelectedFlow] = useState<MailFlowDefinition | null>(null);

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['email-template-flow-overview', 'email', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_templates' as any)
        .select('id, name, subject, category, is_active, updated_at')
        .eq('organization_id', orgId!)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const { data: contractTemplates = [] } = useQuery({
    queryKey: ['email-template-flow-overview', 'contract', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contract_templates' as any)
        .select('id, name, template_type, template_status, is_active, is_placeholder, updated_at')
        .eq('organization_id', orgId!)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const { data: orgSettings } = useQuery({
    queryKey: ['email-template-flow-overview', 'org-settings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('name, logo_url, settings')
        .eq('id', orgId!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!orgId,
  });

  const birthdayTemplateId = (orgSettings?.settings as any)?.engagement_settings?.birthday_email_template_id ?? null;
  const previewBrand = useMemo(() => resolvePreviewBrand(orgSettings), [orgSettings]);

  const filteredFlows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return FLOW_DEFINITIONS.filter((flow) => {
      const matchesStatus = status === 'all' || flow.status === status || flow.source === status;
      const matchesSearch = !needle || [
        flow.name,
        flow.trigger,
        flow.sender,
        flow.templateSource,
        flow.codePath,
      ].some((value) => value.toLowerCase().includes(needle));
      return matchesStatus && matchesSearch;
    });
  }, [search, status]);

  const activeEmailCount = emailTemplates.filter((template) => template.is_active).length;
  const activeContractCount = contractTemplates.filter(activeContract).length;
  const generatedCount = FLOW_DEFINITIONS.filter((flow) => flow.source === 'generated_html').length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center">
              <Send className="h-4 w-4 text-stat-blue" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Verzendkanaal</p>
              <p className="text-sm font-medium">Outlook Graph</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-emerald-100 flex items-center justify-center">
              <Mail className="h-4 w-4 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Actieve e-mailtemplates</p>
              <p className="text-sm font-medium">{activeEmailCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-blue-100 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4 text-blue-700" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Actieve juridische templates</p>
              <p className="text-sm font-medium">{activeContractCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-slate-100 flex items-center justify-center">
              <Settings2 className="h-4 w-4 text-slate-700" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Nog gegenereerde flows</p>
              <p className="text-sm font-medium">{generatedCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4" />
                Mailflows en templatebronnen
              </CardTitle>
              <CardDescription>
                Alle automatische uitnodigingen, bevestigingen en notificaties met hun verzendroute en templatebron.
                Klik op een flow voor een voorbeeld in de huisstijl.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Zoek flow..."
                  className="pl-9 w-full sm:w-[220px]"
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full sm:w-[190px]">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle flows</SelectItem>
                  <SelectItem value="beheerbaar">Beheerbaar</SelectItem>
                  <SelectItem value="juridisch">Juridisch</SelectItem>
                  <SelectItem value="gedeeltelijk">Gedeeltelijk</SelectItem>
                  <SelectItem value="gegenereerd">Gegenereerd</SelectItem>
                  <SelectItem value="extern">Extern</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[240px]">Flow</TableHead>
                  <TableHead className="min-w-[230px]">Verzending</TableHead>
                  <TableHead className="min-w-[260px]">Templatebron</TableHead>
                  <TableHead className="min-w-[220px]">Gekoppeld</TableHead>
                  <TableHead className="min-w-[220px]">Codepad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFlows.map((flow) => (
                  <TableRow
                    key={flow.id}
                    className="align-top cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelectedFlow(flow)}
                  >
                    <TableCell>
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          {flow.source === 'whatsapp_templates' ? (
                            <MessageSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          ) : flow.source === 'contract_templates' ? (
                            <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium leading-tight">{flow.name}</p>
                            <p className="text-xs text-muted-foreground mt-1">{flow.trigger}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className={cn('w-fit', STATUS_CLASSES[flow.status])}>
                          {STATUS_LABELS[flow.status]}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{flow.sender}</p>
                      {flow.note && <p className="text-xs text-muted-foreground mt-1">{flow.note}</p>}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{flow.templateSource}</p>
                      {flow.emailCategories?.length ? (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {flow.emailCategories.map((category) => (
                            <Badge key={category} variant="secondary">
                              {CATEGORY_LABELS[category] ?? category}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      {flow.contractTypes?.length ? (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {flow.contractTypes.map((type) => (
                            <Badge key={type} variant="secondary">
                              {CONTRACT_TYPE_LABELS[type] ?? type}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <TemplateBadges
                        flow={flow}
                        emailTemplates={emailTemplates}
                        contractTemplates={contractTemplates}
                        birthdayTemplateId={birthdayTemplateId}
                      />
                    </TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground break-all">{flow.codePath}</code>
                      <div className="mt-2 flex items-center gap-1 text-xs text-stat-blue">
                        <Eye className="h-3.5 w-3.5" /> Voorbeeld
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {filteredFlows.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Geen flows gevonden voor deze filter.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          Verzonden e-mails worden in <span className="font-medium text-foreground">communications</span> gelogd met ontvanger,
          onderwerp, body, afzender en tijdstip. Outlook-rechten en mailboxkeuze staan onder de Outlook-instellingen; persoonlijke
          mailboxen blijven alleen zichtbaar wanneer de gebruiker daarvoor recht heeft.
          {emailTemplates[0]?.updated_at ? (
            <span> Laatste e-mailtemplate wijziging: {formatDate(emailTemplates[0].updated_at)}.</span>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={!!selectedFlow} onOpenChange={(open) => !open && setSelectedFlow(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> {selectedFlow?.name}
            </DialogTitle>
            <DialogDescription>{selectedFlow?.trigger}</DialogDescription>
          </DialogHeader>
          {selectedFlow && (
            <div className="flex-1 overflow-y-auto space-y-3">
              <p className="text-xs text-muted-foreground">
                Voorbeeld in de huisstijl — representatief, niet de exacte productiemail.
              </p>
              <iframe
                title={`Voorbeeld ${selectedFlow.name}`}
                sandbox=""
                className="w-full rounded-md border bg-white"
                style={{ height: 460 }}
                srcDoc={renderBrandedEmailPreview(previewBrand, sampleContentForFlow(selectedFlow.id, previewBrand))}
              />
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className={cn('w-fit', STATUS_CLASSES[selectedFlow.status])}>
                    {STATUS_LABELS[selectedFlow.status]}
                  </Badge>
                </div>
                <p className="text-muted-foreground">{flowSourceHint(selectedFlow).note}</p>
                {flowSourceHint(selectedFlow).to && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => { const to = flowSourceHint(selectedFlow).to!; setSelectedFlow(null); navigate(to); }}
                  >
                    {flowSourceHint(selectedFlow).buttonLabel}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmailTemplateFlowOverview;
