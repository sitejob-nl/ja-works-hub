// Doorzoekbare single-select voor nationaliteit (canonieke NATIONALITIES-lijst).
// Tolerant: een reeds opgeslagen off-list waarde wordt vooraan toegevoegd en getoond.
import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NATIONALITIES } from '@/lib/candidate-options';

type NationalitySelectProps = {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

const NationalitySelect = ({
  value,
  onChange,
  placeholder = 'Kies nationaliteit',
  className,
}: NationalitySelectProps) => {
  const [open, setOpen] = useState(false);
  const current = (value ?? '').trim();
  const inList = NATIONALITIES.some((o) => o.value === current);
  const options = current && !inList
    ? [{ value: current, label: current }, ...NATIONALITIES]
    : NATIONALITIES;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className={`w-full justify-between font-normal ${className ?? ''}`}>
          <span className={current ? 'text-foreground' : 'text-muted-foreground'}>
            {current || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Zoek nationaliteit..." />
          <CommandList>
            <CommandEmpty>Geen nationaliteit gevonden.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onChange(option.value === current ? '' : option.value);
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${option.value === current ? 'opacity-100' : 'opacity-0'}`} />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default NationalitySelect;
