import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { taskEntityConfig, type TaskEntityType } from '@/lib/tasks';

export interface EntitySelection {
  id: string;
  label: string;
}

interface EntityPickerProps {
  entityType: TaskEntityType;
  value: EntitySelection | null;
  onChange: (value: EntitySelection | null) => void;
  disabled?: boolean;
}

const EntityPicker = ({ entityType, value, onChange, disabled }: EntityPickerProps) => {
  const orgId = useOrganizationId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const config = taskEntityConfig(entityType);

  // Zoekresultaten — server-side filteren zodat grote datasets blijven werken.
  const { data: results = [], isLoading } = useQuery({
    queryKey: ['entity-picker', entityType, orgId, search],
    queryFn: async () => {
      if (!config) return [];
      let q = (supabase as any).from(config.table).select(config.select).eq('organization_id', orgId);
      if (config.applyFilter) q = config.applyFilter(q);
      const term = search.trim();
      if (term) {
        const esc = term.replace(/[%,]/g, ' ');
        q = q.or(config.searchColumns.map((c) => `${c}.ilike.%${esc}%`).join(','));
      }
      q = q.order('created_at', { ascending: false }).limit(25);
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) ?? [];
    },
    enabled: open && !!orgId && !!config,
  });

  // Label van de huidige selectie ophalen wanneer alleen het id bekend is (bij bewerken).
  const { data: resolved } = useQuery({
    queryKey: ['entity-picker-label', entityType, value?.id],
    queryFn: async () => {
      if (!config || !value?.id) return null;
      const { data, error } = await (supabase as any)
        .from(config.table)
        .select(config.select)
        .eq('id', value.id)
        .maybeSingle();
      if (error) throw error;
      return data ? config.getLabel(data) : null;
    },
    enabled: !!config && !!value?.id && !value?.label,
  });

  const displayLabel = value?.label || resolved || (value?.id ? 'Laden…' : null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1.5">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className={cn('flex-1 justify-between font-normal', !displayLabel && 'text-muted-foreground')}
          >
            <span className="truncate">{displayLabel ?? `Kies ${config?.label.toLowerCase() ?? 'item'}…`}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        {value && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-muted-foreground"
            onClick={() => onChange(null)}
            title="Koppeling wissen"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={`Zoek ${config?.label.toLowerCase() ?? ''}...`} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{isLoading ? 'Laden…' : 'Niets gevonden'}</CommandEmpty>
            <CommandGroup>
              {results.map((row) => {
                const label = config!.getLabel(row);
                return (
                  <CommandItem
                    key={row.id}
                    value={row.id}
                    onSelect={() => {
                      onChange({ id: row.id, label });
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value?.id === row.id ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default EntityPicker;
