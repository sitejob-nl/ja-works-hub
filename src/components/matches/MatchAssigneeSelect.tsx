import { UserCheck } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { assigneeName, type AssigneeProfile } from '@/lib/match-assignee';
import { cn } from '@/lib/utils';

export const UNASSIGNED_VALUE = 'unassigned';

type MatchAssigneeSelectProps = {
  value?: string | null;
  options: AssigneeProfile[];
  /**
   * De toewijzing zoals opgeslagen (embed op de match). Zit die persoon niet in
   * `options` — gedeactiveerde collega, of een profiel met een portaalrol — dan zou
   * de Select terugvallen op de placeholder en dus als "niet toegewezen" lezen.
   * Met deze prop tonen we de bestaande toewijzing alsnog, gemarkeerd.
   */
  current?: { id?: string | null; full_name?: string | null; email?: string | null } | null;
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
  current,
  onChange,
  disabled = false,
  inline = false,
  ariaLabel = 'Accountmanager koppelen',
  className,
}: MatchAssigneeSelectProps) => {
  const orphanValue = value && !options.some((profile) => profile.id === value) ? value : null;
  // Naam alleen gebruiken als de meegegeven rij ook echt bij deze toewijzing hoort.
  const orphanProfile = current && (!current.id || current.id === orphanValue) ? current : null;
  const orphanLabel = `${assigneeName(orphanProfile)} (niet beschikbaar)`;

  return (
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
        {orphanValue && <SelectItem value={orphanValue}>{orphanLabel}</SelectItem>}
        {options.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {assigneeName(profile)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default MatchAssigneeSelect;
