import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Star, Trash2, Check, X } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

const ContactsTab = ({ companyId }: { companyId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: '', function_title: '', phone: '', email: '' });

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('company_contacts').select('*').eq('company_id', companyId).order('is_primary', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('company_contacts').insert({ ...form, company_id: companyId, organization_id: orgId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts', companyId] }); setAdding(false); setForm({ full_name: '', function_title: '', phone: '', email: '' }); toast.success('Contact toegevoegd'); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('company_contacts').update(form).eq('id', editId!);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts', companyId] }); setEditId(null); toast.success('Contact bijgewerkt'); },
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
    setForm({ full_name: c.full_name, function_title: c.function_title ?? '', phone: c.phone ?? '', email: c.email ?? '' });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Contactpersonen</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1"><Plus className="h-3.5 w-3.5" />Nieuw contact</Button>
      </div>
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Naam</TableHead>
              <TableHead>Functie</TableHead>
              <TableHead>Telefoon</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead className="w-20">Primair</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adding && (
              <TableRow>
                <TableCell><Input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="Naam" className="h-8" /></TableCell>
                <TableCell><Input value={form.function_title} onChange={(e) => set('function_title', e.target.value)} placeholder="Functie" className="h-8" /></TableCell>
                <TableCell><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="Telefoon" className="h-8" /></TableCell>
                <TableCell><Input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="E-mail" className="h-8" /></TableCell>
                <TableCell></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => addMutation.mutate()} disabled={!form.full_name}><Check className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setAdding(false)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {contacts.map((c: any) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => editId !== c.id && startEdit(c)}>
                {editId === c.id ? (
                  <>
                    <TableCell><Input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} className="h-8" onClick={(e) => e.stopPropagation()} /></TableCell>
                    <TableCell><Input value={form.function_title} onChange={(e) => set('function_title', e.target.value)} className="h-8" onClick={(e) => e.stopPropagation()} /></TableCell>
                    <TableCell><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} className="h-8" onClick={(e) => e.stopPropagation()} /></TableCell>
                    <TableCell><Input value={form.email} onChange={(e) => set('email', e.target.value)} className="h-8" onClick={(e) => e.stopPropagation()} /></TableCell>
                    <TableCell></TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateMutation.mutate()}><Check className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditId(null)}><X className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="font-medium">{c.full_name}</TableCell>
                    <TableCell>{c.function_title ?? '—'}</TableCell>
                    <TableCell>{c.phone ?? '—'}</TableCell>
                    <TableCell>{c.email ?? '—'}</TableCell>
                    <TableCell>
                      <button onClick={(e) => { e.stopPropagation(); setPrimary.mutate(c.id); }}>
                        <Star className={`h-4 w-4 ${c.is_primary ? 'fill-stat-orange text-stat-orange' : 'text-muted-foreground/30'}`} />
                      </button>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
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
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}
            {contacts.length === 0 && !adding && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nog geen contactpersonen</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default ContactsTab;
