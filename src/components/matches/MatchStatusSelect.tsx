import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MATCH_STATUS_FLOW_OPTIONS, getMatchStatusMeta } from '@/lib/match-status';
import { cn } from '@/lib/utils';

type MatchStatusSelectProps = {
  value: string;
  onChange: (status: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  compact?: boolean;
};

const MatchStatusSelect = ({
  value,
  onChange,
  disabled = false,
  ariaLabel = 'Matchstatus wijzigen',
  compact = false,
}: MatchStatusSelectProps) => {
  const meta = getMatchStatusMeta(value);
  const hasCurrentOption = MATCH_STATUS_FLOW_OPTIONS.some((status) => status.key === value);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          'w-full text-xs',
          compact ? 'h-8 min-w-0 rounded-md' : 'h-10 min-w-40 sm:w-44',
          meta.badgeClass
        )}
      >
        <SelectValue placeholder={meta.label} />
      </SelectTrigger>
      <SelectContent>
        {!hasCurrentOption && (
          <SelectItem value={meta.key} disabled className="text-xs">
            {meta.label}
          </SelectItem>
        )}
        {MATCH_STATUS_FLOW_OPTIONS.map((status) => (
          <SelectItem key={status.key} value={status.key} className="text-xs">
            {status.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default MatchStatusSelect;
