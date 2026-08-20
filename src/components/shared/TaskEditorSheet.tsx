import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { priorityConfig, entityTypeLabels, TASK_ENTITY_TYPES, type TaskEntityType } from '@/lib/tasks';
import EntityPicker, { type EntitySelection } from '@/components/shared/EntityPicker';
import TaskAttachments from '@/components/shared/TaskAttachments';
import { uploadTaskFiles } from '@/lib/taskAttachments';
import { GuardedSheet, useDirtyForm } from '@/components/shared/UnsavedCloseGuard';

interface TaskEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bestaande taak → bewerk-modus. */
  task?: any;
  /** Vaste entiteit (bv. vanaf een detailpagina) — verbergt de entiteit-kiezer. */
  lockedEntity?: { type: TaskEntityType; id: string };
  /** Aangeroepen na succesvol opslaan zodat de ouder kan verversen. */
  onSaved?: () => void;
}

const isSelectableEntity = (t?: string | null): t is TaskEntityType =>
  !!t && TASK_ENTITY_TYPES.some((e) => e.value === t);

const emptyForm = { title: '', description: '', priority: 'medium', due_date: '', assigned_to: '' };

const TaskEditorSheet = ({ open, onOpenChange, task, lockedEntity, onSaved }: TaskEditorSheetProps) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEdit = !!task;

  const [form, setForm, formDirty] = useDirtyForm(emptyForm);
  const [entityType, setEntityType] = useState<TaskEntityType | 'none'>('none');
  const [entitySel, setEntitySel] = useState<EntitySelection | null>(null);
  const [staged, setStaged] = useState<File[]>([]);

  // Initialiseer bij openen (zowel create als edit).
  useEffect(() => {
    if (!open) return;
    if (task) {
      setForm({
        title: task.title ?? '',
        description: task.description ?? '',
        priority: task.priority ?? 'medium',
        due_date: task.due_date ?? '',
        assigned_to: task.assigned_to ?? 'unassigned',
      });
      if (isSelectableEntity(task.related_entity_type) && task.related_entity_id) {
        setEntityType(task.related_entity_type);
        setEntitySel({ id: task.related_entity_id, label: '' });
      } else {
        setEntityType('none');
        setEntitySel(null);
      }
    } else {
      setForm({ ...emptyForm, assigned_to: user?.id ?? 'unassigned' });
      setEntityType('none');
      setEntitySel(null);
    }
    setStaged([]);
  }, [open, task, user?.id]);

  const { data: assignees = [] } = useQuery({
    queryKey: ['task-assignees', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId && open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tasks-overview'] });
    qc.invalidateQueries({ queryKey: ['entity-tasks'] });
    qc.invalidateQueries({ queryKey: ['recruiter-tasks'] });
    qc.invalidateQueries({ queryKey: ['open-task-count'] });
  };

  const resolveRelated = () => {
    if (lockedEntity) return { type: lockedEntity.type, id: lockedEntity.id };
    if (entityType !== 'none' && entitySel?.id) return { type: entityType, id: entitySel.id };
    return { type: null as string | null, id: null as string | null };
  };

  const save = useMutation({
    mutationFn: async () => {
      const related = resolveRelated();
      const payload = {
        title: form.title.trim(),
        description: form.description || null,
        priority: form.priority,
        due_date: form.due_date || null,
        assigned_to: form.assigned_to === 'unassigned' ? null : form.assigned_to || null,
        related_entity_type: related.type,
        related_entity_id: related.id,
      };
      if (isEdit) {
        const { error } = await supabase.from('recruiter_tasks').update(payload).eq('id', task.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('recruiter_tasks')
          .insert({ ...payload, organization_id: orgId, status: 'open', ai_generated: false, created_by: user?.id ?? null })
          .select('id')
          .single();
        if (error) throw error;
        if (staged.length && data?.id) {
          await uploadTaskFiles(orgId, data.id, staged, user?.id ?? null);
        }
      }
    },
    onSuccess: () => {
      invalidate();
      onSaved?.();
      onOpenChange(false);
      toast.success(isEdit ? 'Taak bijgewerkt' : 'Taak aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const assignedValue = form.assigned_to || 'unassigned';

  return (
    <GuardedSheet open={open} onOpenChange={onOpenChange} dirty={formDirty}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Taak bewerken' : 'Nieuwe taak'}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label>Titel</Label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Wat moet er gebeuren?" />
          </div>
          <div>
            <Label>Beschrijving</Label>
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Prioriteit</Label>
              <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(priorityConfig).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Deadline</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>

          <div>
            <Label>Toewijzen aan</Label>
            <Select value={assignedValue} onValueChange={(v) => setForm((f) => ({ ...f, assigned_to: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Nog niet toegewezen</SelectItem>
                {assignees.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.id === user?.id ? 'Mijzelf' : (a.full_name || a.email)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!lockedEntity && (
            <div className="space-y-2">
              <Label>Koppelen aan</Label>
              <Select
                value={entityType}
                onValueChange={(v) => {
                  setEntityType(v as TaskEntityType | 'none');
                  setEntitySel(null);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Geen koppeling</SelectItem>
                  {TASK_ENTITY_TYPES.map((e) => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {entityType !== 'none' && (
                <EntityPicker entityType={entityType} value={entitySel} onChange={setEntitySel} />
              )}
            </div>
          )}
          {lockedEntity && (
            <p className="text-xs text-muted-foreground">
              Gekoppeld aan {(entityTypeLabels[lockedEntity.type] ?? 'entiteit').toLowerCase()}.
            </p>
          )}

          <Separator />

          <TaskAttachments taskId={isEdit ? task.id : null} staged={staged} setStaged={setStaged} />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button onClick={() => save.mutate()} disabled={!form.title.trim() || save.isPending}>
              {save.isPending ? 'Opslaan…' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </GuardedSheet>
  );
};

export default TaskEditorSheet;
