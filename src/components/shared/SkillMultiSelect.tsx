// Vaardigheden-multiselect uit de org-skillcatalogus. Bouwt op MultiSelectCombobox.
// Default: haalt de actieve skills zelf op via useOrganizationId (interne schermen).
// Voor publieke (anon) pagina's kun je `options` direct meegeven — dan wordt er niet
// gefetcht en is useOrganizationId niet nodig.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import MultiSelectCombobox from '@/components/shared/MultiSelectCombobox';

type SkillMultiSelectProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Optionele vaste optielijst (skillnamen). Meegeven op publieke pagina's waar
   *  de catalogus niet via RLS opgehaald kan worden. */
  options?: string[];
};

const SkillMultiSelect = ({
  value,
  onChange,
  placeholder = 'Kies vaardigheden',
  searchPlaceholder = 'Zoek vaardigheid...',
  options,
}: SkillMultiSelectProps) => {
  return options
    ? <SkillMultiSelectStatic value={value} onChange={onChange} options={options} placeholder={placeholder} searchPlaceholder={searchPlaceholder} />
    : <SkillMultiSelectFetched value={value} onChange={onChange} placeholder={placeholder} searchPlaceholder={searchPlaceholder} />;
};

const SkillMultiSelectStatic = ({
  value, onChange, options, placeholder, searchPlaceholder,
}: Required<Pick<SkillMultiSelectProps, 'value' | 'onChange' | 'placeholder' | 'searchPlaceholder'>> & { options: string[] }) => (
  <MultiSelectCombobox
    value={value}
    onChange={onChange}
    options={options.map((name) => ({ value: name, label: name }))}
    placeholder={placeholder}
    searchPlaceholder={searchPlaceholder}
    emptyText="Geen vaardigheden gevonden."
  />
);

const SkillMultiSelectFetched = ({
  value, onChange, placeholder, searchPlaceholder,
}: Required<Pick<SkillMultiSelectProps, 'value' | 'onChange' | 'placeholder' | 'searchPlaceholder'>>) => {
  const orgId = useOrganizationId();
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
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!orgId,
  });

  return (
    <MultiSelectCombobox
      value={value}
      onChange={onChange}
      options={skillOptions.map((s) => ({ value: s.name, label: s.name }))}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyText="Geen vaardigheden gevonden."
    />
  );
};

export default SkillMultiSelect;
