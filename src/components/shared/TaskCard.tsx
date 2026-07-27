import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Paperclip, Sparkles, X } from 'lucide-react';
import { formatDate } from '@/lib/format';
import {
  categoryIcon, categoryLabel, entityLinks, entityTypeLabels, isTaskOpen, isTaskOverdue,
  priorityConfig,
} from '@/lib/tasks';
import { cn } from '@/lib/utils';

interface TaskCardProps {
  task: any;
  /** Afvinken of heropenen. */
  onToggle: (task: any) => void;
  /** Klik op de taak opent de editor. Weglaten maakt de kaart niet-klikbaar (bv. facility). */
  onEdit?: (task: any) => void;
  /** Toont het kruisje om de taak te negeren. */
  onDismiss?: (task: any) => void;
  /** Toon aan wie de taak hangt — zinvol in team-weergaven, ruis in "mijn taken". */
  showAssignee?: boolean;
  /** Toon de gekoppelde entiteit (kandidaat, vacature, …). */
  showEntityLink?: boolean;
}

/**
 * Eén taakregel, gedeeld door /taken, /workbench en de Taken-tab op detailpagina's.
 * Alle drie toonden hier voorheen een eigen variant met net andere velden en acties.
 */
const TaskCard = ({
  task,
  onToggle,
  onEdit,
  onDismiss,
  showAssignee = false,
  showEntityLink = true,
}: TaskCardProps) => {
  const open = isTaskOpen(task);
  const prio = priorityConfig[task.priority] ?? priorityConfig.medium;
  const CatIcon = categoryIcon(task.category);
  const overdue = open && isTaskOverdue(task.due_date);
  const attachments = task.task_attachments?.[0]?.count ?? 0;
  const entityHref = showEntityLink && task.related_entity_type && task.related_entity_id
    ? entityLinks[task.related_entity_type]?.(task.related_entity_id)
    : null;
  const assigneeName = task.profiles?.full_name || task.profiles?.email || 'Nog niet toegewezen';

  const body = (
    <>
      <span className={cn('text-sm', !open && 'line-through text-muted-foreground')}>{task.title}</span>
      {open && task.description && (
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>
      )}
      {open && task.ai_reasoning && (
        <p className="text-[11px] text-muted-foreground/70 mt-1 italic line-clamp-2">💡 {task.ai_reasoning}</p>
      )}
      {open && (
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant="secondary" className={cn('text-[10px]', prio.color)}>{prio.label}</Badge>
          {task.category && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
              <CatIcon className="h-2.5 w-2.5" />{categoryLabel(task.category)}
            </Badge>
          )}
          {task.ai_generated && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-primary/30 text-stat-blue">
              <Sparkles className="h-2.5 w-2.5" />AI
            </Badge>
          )}
          {task.status === 'in_progress' && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary text-stat-blue">Bezig</Badge>
          )}
          {task.due_date && (
            <span className={cn('text-[10px]', overdue ? 'text-destructive font-medium' : 'text-muted-foreground')}>
              Deadline: {formatDate(task.due_date)}
            </span>
          )}
          {showAssignee && <span className="text-[10px] text-muted-foreground">→ {assigneeName}</span>}
          {attachments > 0 && (
            <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
              <Paperclip className="h-3 w-3" />{attachments}
            </span>
          )}
          {entityHref && (
            <Link
              to={entityHref}
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] hover:underline"
            >
              {entityTypeLabels[task.related_entity_type] ?? task.related_entity_type}
            </Link>
          )}
        </div>
      )}
    </>
  );

  return (
    <div
      className={cn(
        'flex items-start gap-3 bg-card rounded-lg border p-3',
        !open && 'opacity-60',
        open && task.status === 'in_progress' && 'border-primary/40 bg-primary/[0.05]',
      )}
    >
      <Checkbox
        // Alleen 'done' is afgevinkt; een genegeerde taak is gesloten maar niet afgerond.
        checked={task.status === 'done'}
        onCheckedChange={() => onToggle(task)}
        aria-label={open ? 'Taak afronden' : 'Taak heropenen'}
        className="mt-0.5"
      />
      {onEdit ? (
        <button type="button" onClick={() => onEdit(task)} className="flex-1 min-w-0 text-left">
          {body}
        </button>
      ) : (
        <div className="flex-1 min-w-0">{body}</div>
      )}
      {onDismiss && open && (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Taak negeren"
          className="h-7 w-7 p-0 text-muted-foreground shrink-0"
          onClick={() => onDismiss(task)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
};

export default TaskCard;
