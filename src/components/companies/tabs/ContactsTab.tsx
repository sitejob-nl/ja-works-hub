import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Star, Trash2, Check, X, KeyRound } from 'lucide-react';
import ClientPortalActivateSheet from '@/components/companies/ClientPortalActivateSheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';

const CONTACT_ROLES = [
  { value: 'administratie', label: 'Administratie' },
  { value: 'plaatsing', label: 'Plaatsing' },
  { value: 'hr', label: 'HR' },
  { value: 'overig', label: 'Overig' },
] as const;

type ContactRole = Database['public']['Enums']['contact_role'];

const ROLE_COLORS: Record<string, string> = {
  administratie: 'bg-blue-50 text-blue-700',
  admin: 'bg-blue-50 text-blue-700',
  plaatsing: 'bg-green-50 text-green-700',
  hr: 'bg-purple-50 text-purple-700',
  overig: 'bg-gray-50 text-gray-600',
};

const roleLabel = (role: string) => {
  if (role === 'admin') return 'Administratie';
  return CONTACT_ROLES.find(r => r.value === role)?.label ?? role;
};

interface FormState {
  full_name: string;
  first_name: string;
  last_name: string;
  function_title: string;
  role: ContactRole;
  phone: string;
  email: string;
  linkedin_url: string;
  notes: string;
}

const emptyForm: FormState = { full_name: '', first_name: '', last_name: '', function_title: '', role: 'overig', phone: '', email: '', linkedin_url: '', notes: '' };

const ContactsTab = ({ companyId }: { companyId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showExtra, setShowExtra] = useState(false);
  const [portalContact, setPortalContact] = useState<any>(null);

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('company_contacts').select('*').eq('company_id', companyId).order('is_primary', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const buildPayload = () => {
    const full_name = [form.first_name, form.last_name].filter(Boolean).join(' ') || form.full_name;
    return {
      full_name,
      first_name: form.first_name || null,
      last_name: form.last_name || null,
      function_title: form.function_title || null,
      role: form.role || 'overig',
      phone: form.phone || null,
      email: form.email || null,
      linkedin_url: form.linkedin_url || null,
      notes: form.notes || null,
    };
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      const { error } = await supabase.from('company_contacts').insert({ ...payload, company_id: companyId, organization_id: orgId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts', companyId] });
      setAdding(false);
      setForm(emptyForm);
      setShowExtra(false);
      toast.success('Contact toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      const { error } = await supabase.from('company_contacts').update(payload).eq('id', editId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts', companyId] });
      qc.invalidateQueries({ queryKey: ['all-contacts'] });
      setEditId(null);
      setShowExtra(false);
      toast.success('Contact bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('company_contacts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts', companyId] }); toast.success('Contact verwijderd'); },
  });

  const setPrimary = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('company_contacts').update({ is_primary: false }).eq('company_id', companyId);
      const { error } = await supabase.from('company_contacts').update({ is_primary: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts', companyId] }); toast.success('Primair contact bijgewerkt'); },
  });

  const startEdit = (c: any) => {
    setEditId(c.id);
    setForm({
      full_name: c.full_name,
      first_name: c.first_name ?? '',
      last_name: c.last_name ?? '',
      function_title: c.function_title ?? '',
      role: c.role === 'admin' ? 'administratie' : c.role ?? 'overig',
      phone: c.phone ?? '',
      email: c.email ?? '',
      linkedin_url: c.linkedin_url ?? '',
      notes: c.notes ?? '',
    });
    setShowExtra(!!(c.linkedin_url || c.notes));
  };

  const hasName = form.first_name || form.last_name || form.full_name;

  const renderFormFields = (isInline: boolean) => (
    <>
      <TableCell><Input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} placeholder="Voornaam" className="h-8" onClick={(e) => e.stopPropagation()} /></TableCell>
      <TableCell><Input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} placeholder="Achternaam" className="h-8" onClick={(e) => e.stopPropagation()} /></TableCell>
      <TableCell>
        <Select value={form.role} onValueChange={(v) => set('role', v as ContactRole)}>
          <SelectTrigger className="h-8" onClick={(e) => e.stopPropagation()}><SelectValue /></SelectTrigger>
          <SelectContent>
            {CONTACT_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell><Input value={form.function_title} onChange={(e) => set('function_title', e.target.value)} placeholder="Functie" className="h-8" onClick={(e) => e.stopPropagation()} /></TableCell>
      <TableCell><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="Telefoon" className="h-8" onClick={(e) => e.stopPropagation()} /></TableCell>
      <TableCell><Input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="E-mail" className="h-8" onClick={(e) => e.stopPropagation()} /></TableCell>
      <TableCell></TableCell>
      <TableCell>
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => isInline ? updateMutation.mutate() : addMutation.mutate()} disabled={!hasName}><Check className="h-3.5 w-3.5" /></Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              if (isInline) setEditId(null);
              else setAdding(false);
              setShowExtra(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </>
  );

  const renderExtraFields = () => (
    <TableRow>
      <TableCell colSpan={8} className="pt-0 pb-3" onClick={(e) => e.stopPropagation()}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl pl-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">LinkedIn</label>
            <Input value={form.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/..." className="h-8" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Notities</label>
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="min-h-[2rem]" />
          </div>
        </div>
        {!showExtra && (
          <button className="text-xs text-stat-blue mt-1 ml-2 hover:underline" onClick={() => setShowExtra(true)}>+ LinkedIn &amp; notities</button>
        )}
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Contactpersonen</h3>
        <Button size="sm" variant="outline" onClick={() => { setAdding(true); setForm(emptyForm); setShowExtra(false); }} className="gap-1"><Plus className="h-3.5 w-3.5" />Nieuw contact</Button>
      </div>
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Voornaam</TableHead>
              <TableHead>Achternaam</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Functie</TableHead>
              <TableHead>Telefoon</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead className="w-20">Primair</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adding && (
              <>
                <TableRow>{renderFormFields(false)}</TableRow>
                {renderExtraFields()}
              </>
            )}
            {contacts.map((c: any) => (
              editId === c.id ? (
                <React.Fragment key={c.id}>
                  <TableRow className="cursor-pointer">{renderFormFields(true)}</TableRow>
                  {renderExtraFields()}
                </React.Fragment>
              ) : (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => startEdit(c)}>
                  <TableCell className="font-medium">
                    <Link to={`/contacten/${c.id}`} className="text-foreground hover:text-stat-blue transition-colors" onClick={(e) => e.stopPropagation()}>
                      {c.first_name || c.full_name?.split(' ')[0] || '—'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link to={`/contacten/${c.id}`} className="text-foreground hover:text-stat-blue transition-colors" onClick={(e) => e.stopPropagation()}>
                      {c.last_name || '—'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {c.role ? (
                      <Badge variant="secondary" className={`text-[10px] ${ROLE_COLORS[c.role] || ''}`}>
                        {roleLabel(c.role)}
                      </Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell>{c.function_title ?? '—'}</TableCell>
                  <TableCell>{c.phone ?? '—'}</TableCell>
                  <TableCell>{c.email ?? '—'}</TableCell>
                  <TableCell>
                    <button onClick={(e) => { e.stopPropagation(); setPrimary.mutate(c.id); }}>
                      <Star className={`h-4 w-4 ${c.is_primary ? 'fill-stat-orange text-stat-orange' : 'text-muted-foreground/30'}`} />
                    </button>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                    {c.email && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Portaal activeren" onClick={() => setPortalContact(c)}>
                        <KeyRound className={`h-3.5 w-3.5 ${c.portal_enabled ? 'text-stat-green' : 'text-muted-foreground'}`} />
                      </Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Contact verwijderen?</AlertDialogTitle>
                          <AlertDialogDescription>Dit kan niet ongedaan worden gemaakt.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuleren</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(c.id)}>Verwijderen</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              )
            ))}
            {contacts.length === 0 && !adding && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nog geen contactpersonen</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {portalContact && (
        <ClientPortalActivateSheet
          open={!!portalContact}
          onOpenChange={(open) => { if (!open) setPortalContact(null); }}
          contactId={portalContact.id}
          companyId={companyId}
          contactEmail={portalContact.email}
          contactName={portalContact.full_name || `${portalContact.first_name ?? ''} ${portalContact.last_name ?? ''}`.trim()}
        />
      )}
    </div>
  );
};

export default ContactsTab;
