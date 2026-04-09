import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';

export interface FilterCriteria {
  status?: string[];
  skills?: string[];
  languages?: string[];
  compliance_status?: string[];
  city?: string;
  cv_search?: string;
}

interface PoolFilterBuilderProps {
  value: FilterCriteria;
  onChange: (filter: FilterCriteria) => void;
}

const STATUSES = [
  { value: 'nieuw', label: 'Nieuw' },
  { value: 'in_behandeling', label: 'In behandeling' },
  { value: 'beschikbaar', label: 'Beschikbaar' },
  { value: 'geplaatst', label: 'Geplaatst' },
  { value: 'inactief', label: 'Inactief' },
  { value: 'afgewezen', label: 'Afgewezen' },
];

const COMPLIANCE = [
  { value: 'compleet', label: 'Compleet' },
  { value: 'incompleet', label: 'Incompleet' },
  { value: 'verlopen', label: 'Verlopen' },
];

function MultiSelectField({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select
        value=""
        onValueChange={(v) => {
          if (v && !selected.includes(v)) onChange([...selected, v]);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={`Selecteer ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options
            .filter((o) => !selected.includes(o.value))
            .map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {selected.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1">
              {options.find((o) => o.value === v)?.label ?? v}
              <X className="h-3 w-3 cursor-pointer" onClick={() => onChange(selected.filter((s) => s !== v))} />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function TagInputField({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setInput('');
    }
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm"
        >
          +
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1">
              {v}
              <X className="h-3 w-3 cursor-pointer" onClick={() => onChange(values.filter((s) => s !== v))} />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PoolFilterBuilder({ value, onChange }: PoolFilterBuilderProps) {
  const update = (patch: Partial<FilterCriteria>) => {
    const next = { ...value, ...patch };
    // Clean empty arrays/strings
    if (next.status?.length === 0) delete next.status;
    if (next.skills?.length === 0) delete next.skills;
    if (next.languages?.length === 0) delete next.languages;
    if (next.compliance_status?.length === 0) delete next.compliance_status;
    if (!next.city) delete next.city;
    if (!next.cv_search) delete next.cv_search;
    onChange(next);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <MultiSelectField
        label="Status"
        options={STATUSES}
        selected={value.status ?? []}
        onChange={(status) => update({ status })}
      />

      <MultiSelectField
        label="Compliance"
        options={COMPLIANCE}
        selected={value.compliance_status ?? []}
        onChange={(compliance_status) => update({ compliance_status })}
      />

      <TagInputField
        label="Vaardigheden"
        placeholder="bijv. Lassen, TIG"
        values={value.skills ?? []}
        onChange={(skills) => update({ skills })}
      />

      <TagInputField
        label="Talen"
        placeholder="bijv. NL, PL, DE"
        values={value.languages ?? []}
        onChange={(languages) => update({ languages })}
      />

      <div className="space-y-1.5">
        <Label>Stad</Label>
        <Input
          value={value.city ?? ''}
          onChange={(e) => update({ city: e.target.value })}
          placeholder="bijv. Eindhoven"
        />
      </div>

      <div className="space-y-1.5">
        <Label>CV zoeken</Label>
        <Input
          value={value.cv_search ?? ''}
          onChange={(e) => update({ cv_search: e.target.value })}
          placeholder="bijv. heftruckcertificaat"
        />
      </div>
    </div>
  );
}
