import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, Pencil, Plus, Tags, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { normalizeSkillName } from '@/lib/matching';

type Skill = {
  id: string;
  name: string;
  normalized_name: string;
  category: string | null;
  is_active: boolean;
};

type SkillAlias = {
  id: string;
  skill_id: string;
  alias: string;
  normalized_alias: string;
  is_active: boolean;
};

const SkillCatalogSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const [newSkill, setNewSkill] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [aliasSkillId, setAliasSkillId] = useState('');
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editingSkillName, setEditingSkillName] = useState('');

  const { data: skills = [], isLoading: skillsLoading } = useQuery({
    queryKey: ['skills-settings', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('skills')
        .select('*')
        .eq('organization_id', orgId)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const { data: aliases = [] } = useQuery({
    queryKey: ['skill-aliases-settings', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('skill_aliases')
        .select('*')
        .eq('organization_id', orgId)
        .order('alias');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['skills-settings'] });
    queryClient.invalidateQueries({ queryKey: ['skill-aliases-settings'] });
    queryClient.invalidateQueries({ queryKey: ['vacancy-canonical-skills'] });
    queryClient.invalidateQueries({ queryKey: ['available-candidates-for-vacancy'] });
  };

  const addSkillMutation = useMutation({
    mutationFn: async () => {
      const name = newSkill.trim();
      if (!name) throw new Error('Vul een vaardigheid in');
      const normalized = normalizeSkillName(name);
      const { error } = await (supabase as any).from('skills').insert({
        organization_id: orgId,
        name,
        normalized_name: normalized,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewSkill('');
      invalidate();
      toast.success('Vaardigheid toegevoegd');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateSkillMutation = useMutation({
    mutationFn: async ({ skill, name }: { skill: Skill; name: string }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Vul een vaardigheid in');
      const { error } = await (supabase as any).from('skills')
        .update({ name: trimmed, normalized_name: normalizeSkillName(trimmed) })
        .eq('id', skill.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingSkillId(null);
      setEditingSkillName('');
      invalidate();
      toast.success('Vaardigheid aangepast');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleSkillMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await (supabase as any).from('skills').update({ is_active: isActive }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const addAliasMutation = useMutation({
    mutationFn: async () => {
      const alias = newAlias.trim();
      if (!alias || !aliasSkillId) throw new Error('Kies een vaardigheid en alias');
      const { error } = await (supabase as any).from('skill_aliases').insert({
        organization_id: orgId,
        skill_id: aliasSkillId,
        alias,
        normalized_alias: normalizeSkillName(alias),
        source: 'manual',
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewAlias('');
      invalidate();
      toast.success('Alias toegevoegd');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleAliasMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await (supabase as any).from('skill_aliases').update({ is_active: isActive }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteAliasMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('skill_aliases').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Alias verwijderd');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (skillsLoading) return <div className="text-sm text-muted-foreground">Laden...</div>;

  const activeSkills = skills.filter((skill: Skill) => skill.is_active);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4" /> Vaardigheden
        </CardTitle>
        <CardDescription>Beheer de skillcatalogus en aliassen voor vacaturematching</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newSkill}
            onChange={(event) => setNewSkill(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addSkillMutation.mutate();
            }}
            placeholder="Nieuwe vaardigheid"
          />
          <Button onClick={() => addSkillMutation.mutate()} disabled={!newSkill.trim() || addSkillMutation.isPending} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Toevoegen
          </Button>
        </div>

        <div className="space-y-2">
          {skills.map((skill: Skill) => (
            <div key={skill.id} className="flex items-center gap-2 rounded-md border p-2">
              {editingSkillId === skill.id ? (
                <Input value={editingSkillName} onChange={(event) => setEditingSkillName(event.target.value)} className="h-8" />
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{skill.name}</span>
                    <Badge variant="outline" className="text-[10px]">{skill.normalized_name}</Badge>
                  </div>
                </div>
              )}
              <Switch checked={skill.is_active} onCheckedChange={(checked) => toggleSkillMutation.mutate({ id: skill.id, isActive: checked })} />
              {editingSkillId === skill.id ? (
                <>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => updateSkillMutation.mutate({ skill, name: editingSkillName })}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingSkillId(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingSkillId(skill.id); setEditingSkillName(skill.name); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Tags className="h-4 w-4" /> Aliassen
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={aliasSkillId} onValueChange={setAliasSkillId}>
              <SelectTrigger className="sm:w-[220px]">
                <SelectValue placeholder="Vaardigheid" />
              </SelectTrigger>
              <SelectContent>
                {activeSkills.map((skill: Skill) => (
                  <SelectItem key={skill.id} value={skill.id}>{skill.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={newAlias} onChange={(event) => setNewAlias(event.target.value)} placeholder="Alias, bijv. MIG/MAG" />
            <Button onClick={() => addAliasMutation.mutate()} disabled={!newAlias.trim() || !aliasSkillId || addAliasMutation.isPending} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Alias
            </Button>
          </div>

          <div className="space-y-2">
            {aliases.map((alias: SkillAlias) => {
              const skill = skills.find((item: Skill) => item.id === alias.skill_id);
              return (
                <div key={alias.id} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{alias.alias}</span>
                    <span className="text-xs text-muted-foreground"> {'->'} {skill?.name ?? 'Onbekende vaardigheid'}</span>
                  </div>
                  <Switch checked={alias.is_active} onCheckedChange={(checked) => toggleAliasMutation.mutate({ id: alias.id, isActive: checked })} />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => deleteAliasMutation.mutate(alias.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SkillCatalogSettings;
