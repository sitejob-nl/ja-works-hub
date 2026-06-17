// Presentational multi-select combobox (Popover + Command + badges).
// Géén data-fetch en géén useOrganizationId, zodat dit ook op publieke (anon)
// pagina's bruikbaar is. SkillMultiSelect en LanguageMultiSelect bouwen hierop.
//
// TOLERANT: reeds geselecteerde waarden die niet in `options` voorkomen worden
// alsnog als badge getoond en zijn deselecteerbaar (nooit stil verloren).
import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type ComboboxOption = { value: string; label: string };

type MultiSelectComboboxProps = {
  value: string[];
  onChange: (value: string[]) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
};

const MultiSelectCombobox = ({
  value,
  onChange,
  options,
  placeholder = 'Selecteer...',
  searchPlaceholder = 'Zoeken...',
  emptyText = 'Niets gevonden.',
  disabled = false,
}: MultiSelectComboboxProps) => {
  const [open, setOpen] = useState(false);

  const toggle = (item: string) => {
    onChange(value.includes(item) ? value.filter((v) => v !== item) : [...value, item]);
  };
  const remove = (item: string) => onChange(value.filter((v) => v !== item));

  const labelFor = (val: string) => options.find((o) => o.value === val)?.label ?? val;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" disabled={disabled} className="w-full justify-between font-normal">
            <span className={value.length > 0 ? 'text-foreground' : 'text-muted-foreground'}>
              {value.length > 0 ? `${value.length} geselecteerd` : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const selected = value.includes(option.value);
                  return (
                    <CommandItem key={option.value} value={option.label} onSelect={() => toggle(option.value)}>
                      <Check className={`mr-2 h-4 w-4 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                      {option.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item) => (
            <Badge key={item} variant="secondary" className="gap-1 text-xs">
              {labelFor(item)}
              <button
                type="button"
                className="rounded-sm hover:text-destructive"
                onClick={() => remove(item)}
                aria-label={`${labelFor(item)} verwijderen`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};

export default MultiSelectCombobox;
