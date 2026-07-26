import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pencil, Check, X, Star } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { PhoneLink } from '@/components/ui/contact-links';
import { MailButton } from '@/components/ui/mail-button';
import { toast } from 'sonner';
import CandidateCommunicationTab from '@/components/candidates/tabs/CandidateCommunicationTab';

const ContactDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const orgId = useOrganizationId();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    function_title: '',
    phone: '',
    email: '',
    notes: '',
  });

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_contacts')
        .select(`
          *,
          companies!company_contacts_company_id_fkey(id, name)
        `)
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const startEdit = () => {
    if (!contact) return;
    setForm({
      first_name: contact.first_name ?? '',
      last_name: contact.last_name ?? '',
      function_title: contact.function_title ?? '',
      phone: contact.phone ?? '',
      email: contact.email ?? '',
      notes: contact.notes ?? '',
    });
    setEditing(true);
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      const full_name = [form.first_name, form.last_name].filter(Boolean).join(' ');
      const { error } = await supabase
        .from('company_contacts')
        .update({
          first_name: form.first_name || null,
          last_name: form.last_name || null,
          full_name: full_name || contact?.full_name || '',
          function_title: form.function_title || null,
          phone: form.phone || null,
          email: form.email || null,
          notes: form.notes || null,
        })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-detail', id] });
      qc.invalidateQueries({ queryKey: ['all-contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      setEditing(false);
      toast.success('Contact bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['contact-tasks', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recruiter_tasks')
        .select('*')
        .eq('related_entity_type', 'contactpersoon')
        .eq('related_entity_id', id!)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!contact) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <PageHeader
        breadcrumbs={[{ label: 'Contacten', to: '/contacten' }, { label: contact.full_name }]}
        title={contact.full_name}
        actions={!editing ? (
          <Button variant="outline" size="sm" onClick={startEdit} className="gap-1.5 shrink-0">
            <Pencil className="h-3.5 w-3.5" /> Bewerken
          </Button>
        ) : undefined}
      >
        {contact.is_primary && (
          <div className="mt-2">
            <Badge variant="default" className="bg-stat-orange/10 text-stat-orange border-0 gap-1">
              <Star className="h-3 w-3 fill-current" /> Primair contact
            </Badge>
          </div>
        )}
        {contact.function_title && (
          <p className="text-muted-foreground text-sm mt-1">{contact.function_title}</p>
        )}
        {contact.companies && (
          <p className="text-sm mt-1">
            <Link to={`/opdrachtgevers/${contact.companies.id}`} className="hover:underline">
              {contact.companies.name}
            </Link>
          </p>
        )}
      </PageHeader>

      {/* Tabs */}
      <Tabs defaultValue="profiel" className="w-full">
        <TabsList>
          <TabsTrigger value="profiel">Profiel</TabsTrigger>
          <TabsTrigger value="communicatie">Communicatie</TabsTrigger>
          <TabsTrigger value="taken">Taken ({tasks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="profiel" className="mt-4">
          {editing ? (
            <div className="bg-card rounded-lg border p-6 space-y-4 max-w-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Voornaam</Label>
                  <Input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Achternaam</Label>
                  <Input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Functie</Label>
                  <Input value={form.function_title} onChange={(e) => set('function_title', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefoon</Label>
                  <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>E-mail</Label>
                  <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notities</Label>
                <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={4} />
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="gap-1">
                  <Check className="h-3.5 w-3.5" /> Opslaan
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="gap-1">
                  <X className="h-3.5 w-3.5" /> Annuleren
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-card rounded-lg border p-6 max-w-2xl">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Voornaam</dt>
                  <dd className="mt-0.5 text-sm">{contact.first_name || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Achternaam</dt>
                  <dd className="mt-0.5 text-sm">{contact.last_name || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Functie</dt>
                  <dd className="mt-0.5 text-sm">{contact.function_title || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Telefoon</dt>
                  <dd className="mt-0.5 text-sm"><PhoneLink phone={contact.phone} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">E-mail</dt>
                  <dd className="mt-0.5 text-sm"><MailButton email={contact.email} asText /></dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Bedrijf</dt>
                  <dd className="mt-0.5 text-sm">
                    {contact.companies ? (
                      <Link to={`/opdrachtgevers/${contact.companies.id}`} className="hover:underline">
                        {contact.companies.name}
                      </Link>
                    ) : '—'}
                  </dd>
                </div>
              </dl>
              {contact.notes && (
                <div className="mt-6 pt-4 border-t">
                  <dt className="text-xs text-muted-foreground mb-1">Notities</dt>
                  <dd className="text-sm whitespace-pre-wrap">{contact.notes}</dd>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="communicatie" className="mt-4">
          <CandidateCommunicationTab
            entityType="contact"
            entityId={id!}
            companyId={contact.company_id}
            companyContactId={id!}
            recipients={[{
              id: `contact:${id}`,
              label: contact.full_name,
              email: contact.email,
              phone: contact.phone,
              companyContactId: id!,
            }]}
          />
        </TabsContent>

        <TabsContent value="taken" className="mt-4">
          {tasks.length === 0 ? (
            <div className="bg-card rounded-lg border p-8 text-center text-muted-foreground">
              Geen taken gekoppeld aan dit contact.
            </div>
          ) : (
            <div className="bg-card rounded-lg border divide-y">
              {tasks.map((task: any) => (
                <div key={task.id} className="px-4 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    {task.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{task.description}</p>}
                  </div>
                  <Badge variant="secondary" className="shrink-0 capitalize">{task.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ContactDetail;
