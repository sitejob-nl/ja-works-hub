import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { toastError } from '@/lib/db';
import { invalidateTaskQueries, isTaskOpen } from '@/lib/tasks';

type StatusUpdate = { status: string; completed_at?: string | null };

interface UseTaskActionsOptions {
  /**
   * Alternatieve schrijver voor rollen die niet rechtstreeks mogen updaten
   * (facility gaat via een SECURITY DEFINER-RPC). Krijgt alleen open/done.
   */
  writeStatus?: (id: string, status: 'open' | 'done') => Promise<void>;
}

/**
 * Afronden, heropenen en negeren van een taak — gedeeld door /taken, /workbench en de
 * Taken-tab op detailpagina's.
 *
 * Waarom hier en niet per pagina: onder het standaardfilter "Openstaand" verdwijnt een
 * taak zodra je hem afvinkt. Zonder bevestiging voelt dat als "weg is weg" en is een
 * misklik niet terug te draaien. Elke actie geeft daarom een toast met "Ongedaan maken".
 */
export function useTaskActions(options: UseTaskActionsOptions = {}) {
  const qc = useQueryClient();

  const apply = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: StatusUpdate }) => {
      if (options.writeStatus) {
        if (updates.status !== 'open' && updates.status !== 'done') {
          throw new Error('Deze rol kan een taak alleen afronden of heropenen');
        }
        await options.writeStatus(id, updates.status);
        return;
      }
      const { error } = await supabase.from('recruiter_tasks' as any).update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateTaskQueries(qc),
    onError: (error) => toastError(error, 'Taak bijwerken mislukt'),
  });

  const reopen = (id: string) => apply.mutate({ id, updates: { status: 'open', completed_at: null } });

  /** Afvinken of heropenen, afhankelijk van de huidige status. */
  const toggle = (task: any) => {
    if (!isTaskOpen(task)) {
      apply.mutate({ id: task.id, updates: { status: 'open', completed_at: null } });
      toast.success('Taak heropend');
      return;
    }
    apply.mutate({ id: task.id, updates: { status: 'done', completed_at: new Date().toISOString() } });
    toast.success('Taak afgerond', {
      action: { label: 'Ongedaan maken', onClick: () => reopen(task.id) },
    });
  };

  const dismiss = (task: any) => {
    // Bij ongedaan maken terug naar de stand van vóór het negeren, niet blind naar 'open'.
    const previous = task.status === 'in_progress' ? 'in_progress' : 'open';
    apply.mutate({ id: task.id, updates: { status: 'dismissed' } });
    toast('Taak genegeerd', {
      action: {
        label: 'Ongedaan maken',
        onClick: () => apply.mutate({ id: task.id, updates: { status: previous, completed_at: null } }),
      },
    });
  };

  return { toggle, dismiss, isPending: apply.isPending };
}
