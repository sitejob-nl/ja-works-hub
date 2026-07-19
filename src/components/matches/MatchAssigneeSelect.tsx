import { UserCheck } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { assigneeName, type AssigneeProfile } from '@/lib/match-assignee';
import { cn } from '@/lib/utils';

export const UNASSIGNED_VALUE = 'unassigned';

type MatchAssigneeSelectProps = {
  value?: string | null;
  options: AssigneeProfile[];
  onChange: (assigneeId: string | null) => void;
  disabled?: boolean;
  /** Compacte variant voor in een matchrij; de volle variant staat in het matchdetail. */
  inline?: boolean;
  ariaLabel?: string;
  className?: string;
};

/**
 * Koppelt de accountmanager (`matches.assigned_to`) aan een match. Deze persoon
 * krijgt de opvolgtaken uit de publieke klant- en kandidaatreacties.
 */
const MatchAssigneeSelect = ({
  value,
  options,
  onChange,
  disabled = false,
  inline = false,
  ariaLabel = 'Accountmanager koppelen',
  className,
}: MatchAssigneeSelectProps) => (
  <Select
    value={value ?? UNASSIGNED_VALUE}
    onValueChange={(next) => onChange(next === UNASSIGNED_VALUE ? null : next)}
    disabled={disabled}
  >
    <SelectTrigger
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(inline && 'h-8 w-auto min-w-[9rem] max-w-[13rem] gap-1.5 px-2 text-xs', className)}
    >
      {inline && <UserCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <SelectValue placeholder="Accountmanager" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value={UNASSIGNED_VALUE}>Geen accountmanager</SelectItem>
      {options.map((profile) => (
        <SelectItem key={profile.id} value={profile.id}>
          {assigneeName(profile)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export default MatchAssigneeSelect;
