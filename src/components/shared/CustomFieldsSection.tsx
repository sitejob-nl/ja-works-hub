import { useState, useEffect } from 'react';
import { useCustomFieldDefinitions, useCustomFieldValues, useSaveCustomFieldValue, type CustomField } from '@/hooks/useCustomFields';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

interface Props {
  entityType: string;
  entityId: string;
}

const CustomFieldsSection = ({ entityType, entityId }: Props) => {
  const { data: fields = [] } = useCustomFieldDefinitions(entityType);
  const { data: values = {} } = useCustomFieldValues(entityType, entityId);
  const saveValue = useSaveCustomFieldValue();
  const [localValues, setLocalValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setLocalValues(values);
  }, [values]);

  if (fields.length === 0) return null;

  const handleBlur = (field: CustomField) => {
    const current = localValues[field.id] ?? '';
    const saved = values[field.id] ?? '';
    if (current !== saved) {
      saveValue.mutate(
        { fieldId: field.id, entityId, value: current },
        { onError: () => toast.error(`Fout bij opslaan ${field.field_label}`) }
      );
    }
  };

  const handleChange = (fieldId: string, value: string) => {
    setLocalValues(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleSelectOrCheckbox = (field: CustomField, value: string) => {
    setLocalValues(prev => ({ ...prev, [field.id]: value }));
    saveValue.mutate(
      { fieldId: field.id, entityId, value },
      { onError: () => toast.error(`Fout bij opslaan ${field.field_label}`) }
    );
  };

  const renderField = (field: CustomField) => {
    const val = localValues[field.id] ?? '';

    switch (field.field_type) {
      case 'text':
        return <Input value={val} onChange={(e) => handleChange(field.id, e.target.value)} onBlur={() => handleBlur(field)} />;
      case 'number':
        return <Input type="number" value={val} onChange={(e) => handleChange(field.id, e.target.value)} onBlur={() => handleBlur(field)} />;
      case 'date':
        return <Input type="date" value={val} onChange={(e) => handleChange(field.id, e.target.value)} onBlur={() => handleBlur(field)} />;
      case 'textarea':
        return <Textarea value={val} onChange={(e) => handleChange(field.id, e.target.value)} onBlur={() => handleBlur(field)} rows={2} />;
      case 'checkbox':
        return (
          <div className="flex items-center gap-2 pt-1">
            <Checkbox checked={val === 'true'} onCheckedChange={(v) => handleSelectOrCheckbox(field, v ? 'true' : 'false')} />
            <span className="text-sm">{val === 'true' ? 'Ja' : 'Nee'}</span>
          </div>
        );
      case 'select':
        return (
          <Select value={val} onValueChange={(v) => handleSelectOrCheckbox(field, v)}>
            <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
            <SelectContent>
              {field.options.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
            </SelectContent>
          </Select>
        );
      default:
        return <Input value={val} onChange={(e) => handleChange(field.id, e.target.value)} onBlur={() => handleBlur(field)} />;
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground">Extra velden</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map(field => (
          <div key={field.id} className="space-y-1.5">
            <Label className="text-xs">
              {field.field_label}
              {field.is_required && <span className="text-destructive ml-0.5">*</span>}
            </Label>
            {renderField(field)}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomFieldsSection;
