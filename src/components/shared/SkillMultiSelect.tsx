import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type SkillOption = {
  id: string;
  name: string;
};

type SkillMultiSelectProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
};

const SkillMultiSelect = ({
  value,
  onChange,
  placeholder = 'Kies vaardigheden',
  searchPlaceholder = 'Zoek vaardigheid...',
}: SkillMultiSelectProps) => {
  const orgId = useOrganizationId();
  const [open, setOpen] = useState(false);

  const { data: skillOptions = [] } = useQuery({
    queryKey: ['skill-options', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('skills')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const toggleSkill = (skillName: string) => {
    onChange(
      value.includes(skillName)
        ? value.filter((skill) => skill !== skillName)
        : [...value, skillName],
    );
  };

  const removeSkill = (skillName: string) => {
    onChange(value.filter((skill) => skill !== skillName));
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className={value.length > 0 ? 'text-foreground' : 'text-muted-foreground'}>
              {value.length > 0
                ? `${value.length} vaardigheid${value.length === 1 ? '' : 'en'} geselecteerd`
                : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>Geen vaardigheden gevonden.</CommandEmpty>
              <CommandGroup>
                {skillOptions.map((skill: SkillOption) => {
                  const selected = value.includes(skill.name);
                  return (
                    <CommandItem key={skill.id} value={skill.name} onSelect={() => toggleSkill(skill.name)}>
                      <Check className={`mr-2 h-4 w-4 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                      {skill.name}
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
          {value.map((skill) => (
            <Badge key={skill} variant="secondary" className="gap-1 text-xs">
              {skill}
              <button
                type="button"
                className="rounded-sm hover:text-destructive"
                onClick={() => removeSkill(skill)}
                aria-label={`${skill} verwijderen`}
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

export default SkillMultiSelect;
