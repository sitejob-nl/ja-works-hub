import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MATCH_STATUS_FLOW_OPTIONS, getMatchStatusMeta } from '@/lib/match-status';

type MatchStatusSelectProps = {
  value: string;
  onChange: (status: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

const MatchStatusSelect = ({
  value,
  onChange,
  disabled = false,
  ariaLabel = 'Matchstatus wijzigen',
}: MatchStatusSelectProps) => {
  const meta = getMatchStatusMeta(value);
  const hasCurrentOption = MATCH_STATUS_FLOW_OPTIONS.some((status) => status.key === value);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel} className={`h-10 w-full min-w-40 text-xs sm:w-44 ${meta.badgeClass}`}>
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
