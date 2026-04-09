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
import ExportPoolButton from '@/components/talentpools/ExportPoolButton';
import PoolFilterBuilder, { type FilterCriteria } from '@/components/talentpools/PoolFilterBuilder';
import FilterPreviewSheet from '@/components/talentpools/FilterPreviewSheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CampaignWizard } from '@/components/campaigns/CampaignWizard';
import VacancyMatchSheet from '@/components/talentpools/VacancyMatchSheet';
import { Filter, RefreshCw, Save, Send, Sparkles } from 'lucide-react';

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
  werkzoekend: 'bg-stat-green/10 text-stat-green border-0',
  in_screening: 'bg-yellow-100 text-yellow-700 border-0',
  geplaatst: 'bg-blue-100 text-blue-700 border-0',
  niet_beschikbaar: 'bg-orange-100 text-orange-600 border-0',
  uitgeschreven: 'bg-red-100 text-red-600 border-0',
};

const statusLabel: Record<string, string> = {
  nieuw: 'Nieuw', werkzoekend: 'Werkzoekend', in_screening: 'In screening',
  geplaatst: 'Geplaatst', niet_beschikbaar: 'Niet beschikbaar', uitgeschreven: 'Uitgeschreven',
};

const TalentpoolDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useOrganizationId();
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [filterCriteria, setFilterCriteria] = useState<FilterCriteria>({});
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
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

  const saveFiltersMutation = useMutation({
    mutationFn: async (criteria: FilterCriteria) => {
      const { error } = await supabase
        .from('talentpools' as any)
        .update({ filter_criteria: Object.keys(criteria).length > 0 ? criteria : null })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentpool-detail', id] });
      toast.success('Filters opgeslagen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Sync filter state from pool data
  const poolFilterCriteria = pool?.filter_criteria ?? {};
  const activeFilter = Object.keys(filterCriteria).length > 0 ? filterCriteria : poolFilterCriteria;

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
              {members.length > 0 && (
                <ExportPoolButton members={members} poolName={pool.name} />
              )}
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

      {/* Smart Filters */}
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            Slimme filters
            {Object.keys(activeFilter).length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px]">
                {Object.keys(activeFilter).length}
              </Badge>
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <div className="bg-card rounded-lg border p-4 space-y-4">
            <PoolFilterBuilder
              value={Object.keys(filterCriteria).length > 0 ? filterCriteria : poolFilterCriteria}
              onChange={setFilterCriteria}
            />
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => saveFiltersMutation.mutate(filterCriteria)}
                disabled={saveFiltersMutation.isPending}
              >
                <Save className="h-3.5 w-3.5" /> Filters opslaan
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => setPreviewOpen(true)}
                disabled={Object.keys(activeFilter).length === 0}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Ververs kandidaten
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Tabs */}
      <Tabs defaultValue="leden" className="w-full">
        <TabsList>
          <TabsTrigger value="leden">Leden ({members.length})</TabsTrigger>
          <TabsTrigger value="notities">Notities</TabsTrigger>
          <TabsTrigger value="taken">Taken</TabsTrigger>
        </TabsList>

        <TabsContent value="leden" className="mt-4">
          <div className="flex justify-end gap-2 mb-3 flex-wrap">
            {members.length > 0 && (
              <>
                <Button size="sm" variant="outline" onClick={() => setMatchOpen(true)} className="gap-1.5">
                  <Sparkles className="h-4 w-4" /> Match met vacature
                </Button>
                <Button size="sm" variant="outline" onClick={() => setCampaignOpen(true)} className="gap-1.5">
                  <Send className="h-4 w-4" /> Campagne starten
                </Button>
              </>
            )}
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

      <FilterPreviewSheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        filter={activeFilter}
        talentpoolId={id!}
        existingMemberIds={existingMemberIds}
      />

      <CampaignWizard
        open={campaignOpen}
        onOpenChange={setCampaignOpen}
        onComplete={() => setCampaignOpen(false)}
        talentpoolId={id!}
        talentpoolName={pool.name}
      />

      <VacancyMatchSheet
        open={matchOpen}
        onOpenChange={setMatchOpen}
        members={members}
      />
    </div>
  );
};

export default TalentpoolDetail;
