// Talen-multiselect uit de canonieke LANGUAGES-lijst. Bouwt op MultiSelectCombobox.
// Tolerant: reeds opgeslagen talen die niet in de lijst staan blijven zichtbaar.
import MultiSelectCombobox, { type ComboboxOption } from '@/components/shared/MultiSelectCombobox';
import { LANGUAGES } from '@/lib/candidate-options';

type LanguageMultiSelectProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
};

const LanguageMultiSelect = ({
  value,
  onChange,
  placeholder = 'Kies talen',
}: LanguageMultiSelectProps) => {
  // Off-list waarden vooraan toevoegen zodat ze zichtbaar/deselecteerbaar blijven.
  const extra = value.filter((v) => !LANGUAGES.includes(v));
  const options: ComboboxOption[] = [...extra, ...LANGUAGES].map((l) => ({ value: l, label: l }));

  return (
    <MultiSelectCombobox
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder="Zoek taal..."
      emptyText="Geen taal gevonden."
    />
  );
};

export default LanguageMultiSelect;
