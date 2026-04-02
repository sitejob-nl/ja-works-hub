import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronRight, Pencil, Check, X, Plus, Trash2, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import NotesSection from '@/components/shared/NotesSection';
import TasksSection from '@/components/shared/TasksSection';
import AddCandidateSheet from '@/components/talentpools/AddCandidateSheet';

const POOL_COLORS = [
  { label: 'Blauw', value: '#3b82f6' },
  { label: 'Groen', value: '#22c55e' },
  { label: 'Oranje', value: '#f97316' },
  { label: 'Paars', value: '#a855f7' },
  { label: 'Rood', value: '#ef4444' },
  { label: 'Geel', value: '#eab308' },
  { label: 'Roze', value: '#ec4899' },
  { label: 'Teal', value: '#14b8a6' },
];

const statusBadge: Record<string, string> = {
  nieuw: 'bg-muted text-muted-foreground border-0',
  in_behandeling: 'bg-yellow-100 text-yellow-700 border-0',
  beschikbaar: 'bg-stat-green/10 text-stat-green border-0',
  geplaatst: 'bg-blue-100 text-blue-700 border-0',
  inactief: 'bg-orange-100 text-orange-600 border-0',
  afgewezen: 'bg-red-100 text-red-600 border-0',
};

const statusLabel: Record<string, string> = {
  nieuw: 'Nieuw', in_behandeling: 'In behandeling', beschikbaar: 'Beschikbaar',
  geplaatst: 'Geplaatst', inactief: 'Inactief', afgewezen: 'Afgewezen',
};

const TalentpoolDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useOrganizationId();
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: '' });

  const { data: pool, isLoading } = useQuery({
    queryKey: ['talentpool-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('talentpools' as any)
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['talentpool-members', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('talentpool_members' as any)
        .select('*, candidates!talentpool_members_candidate_id_fkey(id, first_name, last_name, email, phone, status, skills)')
        .eq('talentpool_id', id!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
  });

  const startEdit = () => {
    if (!pool) return;
    setForm({
      name: pool.name ?? '',
      description: pool.description ?? '',
      color: pool.color ?? '#3b82f6',
    });
    setEditing(true);
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('talentpools' as any)
        .update({
          name: form.name,
          description: form.description || null,
          color: form.color || null,
        })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentpool-detail', id] });
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      setEditing(false);
      toast.success('Talentpool bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (candidateId: string) => {
      const { error } = await supabase
        .from('talentpool_members' as any)
        .delete()
        .eq('talentpool_id', id!)
        .eq('candidate_id', candidateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentpool-members', id] });
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      toast.success('Kandidaat verwijderd uit pool');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('talentpools' as any)
        .delete()
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      navigate('/talentpools');
      toast.success('Talentpool verwijderd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const existingMemberIds = members.map((m: any) => m.candidate_id);

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!pool) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/talentpools" className="hover:text-foreground transition-colors">Talentpools</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground truncate">{pool.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {pool.color && (
              <span className="h-4 w-4 rounded-full shrink-0" style={{ backgroundColor: pool.color }} />
            )}
            <h1 className="text-2xl font-semibold truncate">{pool.name}</h1>
          </div>
          {pool.description && (
            <p className="text-muted-foreground text-sm mt-1">{pool.description}</p>
          )}
          <p className="text-sm text-muted-foreground mt-1">{members.length} lid{members.length !== 1 ? 'en' : ''}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!editing && (
            <>
              <Button variant="outline" size="sm" onClick={startEdit} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> Bewerken
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                if (confirm('Weet je zeker dat je deze talentpool wilt verwijderen?')) {
                  deleteMutation.mutate();
                }
              }} className="gap-1.5 text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" /> Verwijderen
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="bg-card rounded-lg border p-6 space-y-4 max-w-2xl">
          <div className="space-y-1.5">
            <Label>Naam *</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Beschrijving</Label>
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Kleur</Label>
            <div className="flex gap-2 flex-wrap">
              {POOL_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, color: c.value }))}
                  className={`h-8 w-8 rounded-full border-2 transition-all ${form.color === c.value ? 'border-foreground scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={() => updateMutation.mutate()} disabled={!form.name.trim() || updateMutation.isPending} className="gap-1">
              <Check className="h-3.5 w-3.5" /> Opslaan
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="gap-1">
              <X className="h-3.5 w-3.5" /> Annuleren
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="leden" className="w-full">
        <TabsList>
          <TabsTrigger value="leden">Leden ({members.length})</TabsTrigger>
          <TabsTrigger value="notities">Notities</TabsTrigger>
          <TabsTrigger value="taken">Taken</TabsTrigger>
        </TabsList>

        <TabsContent value="leden" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> Kandidaat toevoegen
            </Button>
          </div>

          {members.length === 0 ? (
            <div className="bg-card rounded-lg border p-8 text-center text-muted-foreground">
              <p>Nog geen leden in deze pool.</p>
              <Button onClick={() => setAddOpen(true)} variant="outline" size="sm" className="mt-3 gap-1.5">
                <Plus className="h-4 w-4" /> Voeg kandidaten toe
              </Button>
            </div>
          ) : (
            <div className="bg-card rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Naam</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Telefoon</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Vaardigheden</TableHead>
                    <TableHead>Toegevoegd</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m: any, i: number) => {
                    const c = m.candidates;
                    if (!c) return null;
                    const skills = c.skills ?? [];
                    return (
                      <TableRow key={m.candidate_id} className={i % 2 === 1 ? 'bg-background' : ''}>
                        <TableCell>
                          <Link to={`/kandidaten/${c.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                            {c.first_name} {c.last_name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusBadge[c.status] ?? ''}>
                            {statusLabel[c.status] ?? c.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{c.phone ?? '—'}</TableCell>
                        <TableCell>{c.email ?? '—'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {skills.slice(0, 2).map((s: string) => (
                              <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                            ))}
                            {skills.length > 2 && <Badge variant="outline" className="text-xs">+{skills.length - 2}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(m.added_at).toLocaleDateString('nl-NL')}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeMutation.mutate(m.candidate_id)}
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="notities"><NotesSection entityId={id!} entityType="talentpool" /></TabsContent>
        <TabsContent value="taken"><TasksSection entityId={id!} entityType="talentpool" /></TabsContent>
      </Tabs>

      <AddCandidateSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        talentpoolId={id!}
        existingMemberIds={existingMemberIds}
      />
    </div>
  );
};

export default TalentpoolDetail;
