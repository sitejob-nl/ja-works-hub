import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Copy, Search, FileText, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import EmailTemplateEditor from './EmailTemplateEditor';

const CATEGORY_LABELS: Record<string, string> = {
  general: 'Algemeen',
  onboarding: 'Onboarding',
  invitation: 'Uitnodiging',
  notification: 'Notificatie',
  campaign: 'Campagne',
  placement: 'Plaatsing',
};

const CATEGORY_COLORS: Record<string, string> = {
  general: 'bg-gray-100 text-gray-700',
  onboarding: 'bg-blue-100 text-blue-700',
  invitation: 'bg-green-100 text-green-700',
  notification: 'bg-yellow-100 text-yellow-700',
  campaign: 'bg-purple-100 text-purple-700',
  placement: 'bg-orange-100 text-orange-700',
};

const EmailTemplateList = () => {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formBodyHtml, setFormBodyHtml] = useState('');
  const [formBodyJson, setFormBodyJson] = useState('');
  const [formCategory, setFormCategory] = useState('general');

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['email-templates', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_templates' as any)
        .select('*')
        .eq('organization_id', orgId!)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const filtered = templates.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.subject.toLowerCase().includes(search.toLowerCase())
  );

  const openNew = () => {
    setEditing(null);
    setFormName('');
    setFormSubject('');
    setFormBodyHtml('');
    setFormBodyJson('');
    setFormCategory('general');
    setDialogOpen(true);
  };

  const openEdit = (template: any) => {
    setEditing(template);
    setFormName(template.name);
    setFormSubject(template.subject);
    setFormBodyHtml(template.body_html);
    setFormBodyJson(template.body_json || '');
    setFormCategory(template.category || 'general');
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!formName.trim() || !formSubject.trim()) throw new Error('Naam en onderwerp zijn verplicht');

      // Extract used variables
      const allText = formSubject + ' ' + formBodyHtml;
      const vars = Array.from(allText.matchAll(/\{\{(\w+)\}\}/g)).map(m => m[0]);
      const uniqueVars = [...new Set(vars)];

      const record = {
        name: formName,
        subject: formSubject,
        body_html: formBodyHtml,
        body_json: formBodyJson,
        category: formCategory,
        variables_used: uniqueVars,
        updated_at: new Date().toISOString(),
      };

      if (editing) {
        const { error } = await supabase.from('email_templates' as any).update(record).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('email_templates' as any).insert({
          ...record,
          organization_id: orgId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? 'Template bijgewerkt' : 'Template aangemaakt');
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      setDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('email_templates' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Template verwijderd');
      qc.invalidateQueries({ queryKey: ['email-templates'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (template: any) => {
      const { error } = await supabase.from('email_templates' as any).insert({
        organization_id: orgId,
        name: template.name + ' (kopie)',
        subject: template.subject,
        body_html: template.body_html,
        body_json: template.body_json,
        category: template.category,
        variables_used: template.variables_used,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Template gedupliceerd');
      qc.invalidateQueries({ queryKey: ['email-templates'] });
    },
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Zoek templates..." className="pl-9" />
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> Nieuw template
        </Button>
      </div>

      {/* Template list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>Geen email templates gevonden</p>
          <Button variant="outline" className="mt-3 gap-2" onClick={openNew}>
            <Plus className="h-4 w-4" /> Maak je eerste template
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(t => (
            <Card key={t.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => openEdit(t)}>
              <CardContent className="p-4 flex items-start gap-4">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="font-medium text-sm truncate">{t.name}</h3>
                    <Badge variant="secondary" className={cn('text-[10px] shrink-0', CATEGORY_COLORS[t.category] || '')}>
                      {CATEGORY_LABELS[t.category] || t.category}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{t.subject}</p>
                  <div className="flex items-center gap-3 mt-1">
                    {t.variables_used?.length > 0 && (
                      <span className="text-xs text-muted-foreground">{t.variables_used.length} variabelen</span>
                    )}
                    <span className="text-xs text-muted-foreground">{formatDate(t.updated_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => duplicateMutation.mutate(t)} title="Dupliceren">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(t.id)} title="Verwijderen">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit/Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editing ? 'Template bewerken' : 'Nieuw email template'}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-2">
            <EmailTemplateEditor
              name={formName}
              subject={formSubject}
              bodyHtml={formBodyHtml}
              bodyJson={formBodyJson}
              category={formCategory}
              onNameChange={setFormName}
              onSubjectChange={setFormSubject}
              onBodyChange={(html, json) => { setFormBodyHtml(html); setFormBodyJson(json); }}
              onCategoryChange={setFormCategory}
            />
          </ScrollArea>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Annuleren</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {editing ? 'Opslaan' : 'Aanmaken'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmailTemplateList;
