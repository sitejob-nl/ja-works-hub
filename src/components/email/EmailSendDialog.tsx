import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOutlookInvoke } from '@/hooks/useOutlookAccounts';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Send, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { sanitizeHtml } from '@/lib/sanitize-html';
import { plaintextToHtml } from '@/lib/email-signature';

interface EmailSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId?: string;
  candidateEmail?: string;
  candidateData?: Record<string, any>;
  companyId?: string;
  companyContactId?: string;
  templateCategory?: string;
  extraVariables?: Record<string, string>;
  initialSubject?: string;
  initialBodyHtml?: string;
  onSent?: () => void | Promise<void>;
}

function buildVariableMap(candidate: Record<string, any> | undefined, orgName: string, extra?: Record<string, string>): Record<string, string> {
  if (!candidate) return {};
  return {
    '{{voornaam}}': candidate.first_name || '',
    '{{achternaam}}': candidate.last_name || '',
    '{{volledige_naam}}': [candidate.first_name, candidate.last_name].filter(Boolean).join(' '),
    '{{email}}': candidate.email || '',
    '{{telefoon}}': candidate.phone || '',
    '{{geboortedatum}}': candidate.date_of_birth ? format(new Date(candidate.date_of_birth), 'dd-MM-yyyy') : '',
    '{{nationaliteit}}': candidate.nationality || '',
    '{{medewerker_nummer}}': candidate.employee_number || '',
    '{{status}}': candidate.employee_status || candidate.status || '',
    '{{bsn}}': '', // Never include BSN in emails
    '{{straat}}': candidate.address_street || '',
    '{{postcode}}': candidate.address_postal || '',
    '{{stad}}': candidate.address_city || '',
    '{{organisatie_naam}}': orgName,
    '{{datum_vandaag}}': format(new Date(), 'dd-MM-yyyy'),
    ...(extra || {}),
  };
}

function replaceVars(text: string, vars: Record<string, string>): string {
  let result = text;
  Object.entries(vars).forEach(([key, val]) => {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), val);
  });
  return result;
}

function htmlToEditableText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function plaintextEmailToHtml(text: string): string {
  return plaintextToHtml(text.trimEnd()).replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
  );
}

const EmailSendDialog = ({
  open, onOpenChange, candidateId, candidateEmail, candidateData, companyId, companyContactId, templateCategory, extraVariables, initialSubject, initialBodyHtml, onSent,
}: EmailSendDialogProps) => {
  const callOutlook = useOutlookInvoke();
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  const qc = useQueryClient();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [toEmail, setToEmail] = useState(candidateEmail || '');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const previewHtml = useMemo(() => plaintextEmailToHtml(bodyText || 'Nog geen berichttekst.'), [bodyText]);

  // Fetch candidate if ID provided
  const { data: candidate } = useQuery({
    queryKey: ['candidate-for-email', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('first_name, last_name, email, phone, date_of_birth, nationality, employee_number, employee_status, status, address_street, address_postal, address_city')
        .eq('id', candidateId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!candidateId && !candidateData,
  });

  // Fetch org name
  const { data: org } = useQuery({
    queryKey: ['org-name', orgId],
    queryFn: async () => {
      const { data } = await supabase.from('organizations').select('name').eq('id', orgId!).single();
      return data;
    },
    enabled: !!orgId,
  });

  // Fetch templates
  const { data: templates = [] } = useQuery({
    queryKey: ['email-templates', orgId, templateCategory],
    queryFn: async () => {
      let q = supabase.from('email_templates' as any).select('*').eq('organization_id', orgId!).eq('is_active', true);
      if (templateCategory) q = q.eq('category', templateCategory);
      const { data, error } = await q.order('name');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const candidateRecord = useMemo(() => candidateData || candidate, [candidateData, candidate]);
  const variableMap = useMemo(
    () => buildVariableMap(candidateRecord, org?.name || '', extraVariables),
    [candidateRecord, org?.name, extraVariables],
  );

  // When candidate loads, set email
  useEffect(() => {
    if (candidateRecord?.email && !toEmail) {
      setToEmail(candidateRecord.email);
    }
  }, [candidateRecord, toEmail]);

  useEffect(() => {
    if (!open || selectedTemplateId) return;
    if (initialSubject) setSubject(initialSubject);
    if (initialBodyHtml) setBodyText(htmlToEditableText(initialBodyHtml));
  }, [initialBodyHtml, initialSubject, open, selectedTemplateId]);

  // When template selected, fill subject + body
  useEffect(() => {
    if (!selectedTemplateId) return;
    const tmpl = templates.find((t: any) => t.id === selectedTemplateId);
    if (tmpl) {
      setSubject(replaceVars(tmpl.subject, variableMap));
      setBodyText(htmlToEditableText(replaceVars(tmpl.body_html, variableMap)));
    }
  }, [selectedTemplateId, templates, variableMap]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!toEmail.trim()) throw new Error('Vul een e-mailadres in');
      if (!subject.trim()) throw new Error('Vul een onderwerp in');

      return callOutlook('outlook-send-mail', {
        to: [toEmail.trim()],
        subject,
        html: plaintextEmailToHtml(bodyText),
        candidate_id: candidateId,
        company_id: companyId,
        company_contact_id: companyContactId,
      });
    },
    onSuccess: async () => {
      await onSent?.();
      toast.success('E-mail verzonden');
      qc.invalidateQueries({ queryKey: ['outlook-emails'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      if (err.message !== 'REAUTH_REQUIRED') toast.error('Verzenden mislukt: ' + err.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>E-mail versturen</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-y-auto">
          {/* Template picker */}
          <div className="space-y-1">
            <Label>Template</Label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Kies een template (optioneel)" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* To */}
          <div className="space-y-1">
            <Label>Aan *</Label>
            <Input value={toEmail} onChange={e => setToEmail(e.target.value)} placeholder="email@voorbeeld.nl" />
          </div>

          {/* Subject */}
          <div className="space-y-1">
            <Label>Onderwerp *</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Onderwerp" />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Bericht</Label>
              <textarea
                value={bodyText}
                onChange={e => setBodyText(e.target.value)}
                rows={12}
                className="h-[300px] w-full resize-none rounded-md border p-3 text-sm focus:ring-2 focus:ring-ring"
                placeholder="Typ de mailtekst..."
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Preview</Label>
              <div className="h-[300px] overflow-auto rounded-md border bg-white p-4 dark:bg-zinc-950">
                <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(previewHtml) }} />
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            De ingestelde Outlook-handtekening van de afzender wordt automatisch toegevoegd bij verzenden.
          </p>
        </div>

        <div className="flex justify-between items-center pt-3 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
          <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending} className="gap-2">
            {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Verzenden
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EmailSendDialog;
