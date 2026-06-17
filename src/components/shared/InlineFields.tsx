import { useEffect, useState, type ChangeEvent, type HTMLInputTypeAttribute, type KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, Loader2, Save, X, Eye, EyeOff } from 'lucide-react';
import TagInput from '@/components/ui/tag-input';
import SkillMultiSelect from '@/components/shared/SkillMultiSelect';
import LanguageMultiSelect from '@/components/shared/LanguageMultiSelect';
import NationalitySelect from '@/components/shared/NationalitySelect';

export const emptyToNull = (value: string) => value.trim() || null;
export const fieldShellClass = 'rounded-md border border-border/70 bg-background px-3 py-2 transition-colors hover:border-primary/40 hover:bg-muted/30';
export const emptyValue = '—';

export const maskSensitive = (value: string | null | undefined) => {
  if (!value) return emptyValue;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(trimmed.length - 4, 8))}${trimmed.slice(-4)}`;
};

export const InlineTextField = ({
  id,
  label,
  value,
  displayValue,
  type = 'text',
  placeholder,
  inputMode,
  multiline = false,
  onSave,
  onDirtyChange,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  displayValue?: string | null;
  type?: HTMLInputTypeAttribute;
  placeholder?: string;
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
  multiline?: boolean;
  onSave: (value: string | null) => Promise<void>;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saved, setSaved] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraft(value ?? '');
    setSaved(value ?? '');
  }, [editing, value]);

  const dirty = draft !== saved;
  const updateDraft = (next: string) => {
    setDraft(next);
    onDirtyChange(id, next !== saved);
  };

  const commit = async () => {
    if (!editing) return;
    if (!dirty) {
      setEditing(false);
      onDirtyChange(id, false);
      return;
    }
    setSaving(true);
    try {
      await onSave(emptyToNull(draft));
      setSaved(draft);
      setEditing(false);
      onDirtyChange(id, false);
    } catch {
      onDirtyChange(id, true);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(saved);
    setEditing(false);
    onDirtyChange(id, false);
  };

  if (editing) {
    const commonProps = {
      value: draft,
      autoFocus: true,
      onBlur: () => void commit(),
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateDraft(event.target.value),
      onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
        if (!multiline && event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (multiline && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          commit();
        }
      },
      className: 'mt-2',
    };

    return (
      <div className={fieldShellClass}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        {multiline ? (
          <Textarea {...commonProps} placeholder={placeholder} rows={3} />
        ) : (
          <Input {...commonProps} type={type} inputMode={inputMode} placeholder={placeholder} />
        )}
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5"
            disabled={saving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void commit()}
          >
            <Save className="h-3.5 w-3.5" />
            Opslaan
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={saving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={cancel}
          >
            <X className="h-3.5 w-3.5" />
            Annuleren
          </Button>
          <span className="text-xs text-muted-foreground">Enter slaat ook op</span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`group w-full text-left ${fieldShellClass}`}
    >
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <Pencil className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="block min-h-5 text-sm mt-1 whitespace-pre-wrap">{displayValue || value || emptyValue}</span>
    </button>
  );
};

export const InlineSensitiveField = ({
  id,
  label,
  value,
  loading,
  placeholder,
  inputMode = 'text',
  onSave,
  onDirtyChange,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  loading: boolean;
  placeholder?: string;
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
  onSave: (value: string | null) => Promise<void>;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saved, setSaved] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraft(value ?? '');
    setSaved(value ?? '');
  }, [editing, value]);

  const dirty = draft !== saved;
  const updateDraft = (next: string) => {
    setDraft(next);
    onDirtyChange(id, next !== saved);
  };

  const commit = async () => {
    if (!editing) return;
    if (!dirty) {
      setEditing(false);
      onDirtyChange(id, false);
      return;
    }
    setSaving(true);
    try {
      await onSave(emptyToNull(draft));
      setSaved(draft);
      setEditing(false);
      onDirtyChange(id, false);
    } catch {
      onDirtyChange(id, true);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(saved);
    setEditing(false);
    onDirtyChange(id, false);
  };

  if (loading) {
    return (
      <div className={fieldShellClass}>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Laden...
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className={fieldShellClass}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <Input
          value={draft}
          autoFocus
          className="mt-2 font-mono"
          placeholder={placeholder}
          inputMode={inputMode}
          onBlur={() => void commit()}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              void commit();
            }
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5"
            disabled={saving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void commit()}
          >
            <Save className="h-3.5 w-3.5" />
            Opslaan
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={saving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={cancel}
          >
            <X className="h-3.5 w-3.5" />
            Annuleren
          </Button>
        </div>
      </div>
    );
  }

  const hasValue = Boolean(value);
  return (
    <div className={fieldShellClass}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 min-h-5 font-mono text-sm">{hasValue && visible ? value : maskSensitive(value)}</p>
        </div>
        <div className="flex items-center gap-1">
          {hasValue && (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setVisible((current) => !current)}>
              {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export const InlineBooleanField = ({
  label,
  value,
  onSave,
}: {
  label: string;
  value: boolean | null | undefined;
  onSave: (value: boolean) => Promise<void>;
}) => {
  const [saving, setSaving] = useState(false);
  const save = async (next: boolean) => {
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className={`flex items-center justify-between gap-3 cursor-pointer ${fieldShellClass}`}>
      <span>
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <span className="block text-sm mt-1">{value == null ? 'Onbekend' : value ? 'Ja' : 'Nee'}</span>
      </span>
      <span className="flex items-center gap-2">
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Checkbox checked={value === true} onCheckedChange={(checked) => save(checked === true)} />
      </span>
    </label>
  );
};

export const InlineTagsField = ({
  id,
  label,
  value,
  onSave,
  onDirtyChange,
}: {
  id: string;
  label: string;
  value: string[];
  onSave: (value: string[]) => Promise<void>;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(value ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraft(value ?? []);
  }, [editing, value]);

  const save = async (next: string[]) => {
    setDraft(next);
    onDirtyChange(id, true);
    setSaving(true);
    try {
      await onSave(next);
      onDirtyChange(id, false);
    } catch {
      onDirtyChange(id, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={fieldShellClass}>
      <button type="button" onClick={() => setEditing(true)} className="group flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <Pencil className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
      </button>
      {editing ? (
        <div className="mt-1">
          <TagInput value={draft} onChange={save} placeholder="Typ + Enter om op te slaan" />
          {saving && <p className="text-xs text-muted-foreground mt-1">Opslaan...</p>}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1 mt-1">
          {value.length > 0
            ? value.map((tag) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)
            : <span className="text-sm text-muted-foreground">—</span>}
        </div>
      )}
    </div>
  );
};

export const InlineSelectField = ({
  label,
  value,
  displayValue,
  options,
  placeholder = 'Selecteer...',
  onSave,
}: {
  label: string;
  value: string | null | undefined;
  displayValue?: string | null;
  options: { value: string; label: string }[];
  placeholder?: string;
  onSave: (value: string) => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (next: string) => {
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className={fieldShellClass}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <Select value={value ?? ''} onValueChange={(next) => void save(next)}>
          <SelectTrigger className="mt-2"><SelectValue placeholder={placeholder} /></SelectTrigger>
          <SelectContent>
            {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            <X className="h-3.5 w-3.5" />
            Sluiten
          </Button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`group w-full text-left ${fieldShellClass}`}
    >
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <Pencil className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="block min-h-5 text-sm mt-1">{displayValue || value || emptyValue}</span>
    </button>
  );
};

type InlineMultiProps = {
  id: string;
  label: string;
  value: string[];
  onSave: (value: string[]) => Promise<void>;
  onDirtyChange: (id: string, dirty: boolean) => void;
};

// Gedeelde click-to-edit shell voor multi-select inline-velden (skills, talen).
const InlineMultiSelectShell = ({
  id,
  label,
  value,
  onSave,
  onDirtyChange,
  renderEditor,
}: InlineMultiProps & { renderEditor: (draft: string[], onChange: (next: string[]) => void) => JSX.Element }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(value ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraft(value ?? []);
  }, [editing, value]);

  const save = async (next: string[]) => {
    setDraft(next);
    onDirtyChange(id, true);
    setSaving(true);
    try {
      await onSave(next);
      onDirtyChange(id, false);
    } catch {
      onDirtyChange(id, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={fieldShellClass}>
      <button type="button" onClick={() => setEditing((e) => !e)} className="group flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <Pencil className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
      </button>
      {editing ? (
        <div className="mt-1 space-y-2">
          {renderEditor(draft, save)}
          {saving && <p className="text-xs text-muted-foreground">Opslaan...</p>}
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setEditing(false)}>
            <X className="h-3.5 w-3.5" />
            Sluiten
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1 mt-1">
          {value.length > 0
            ? value.map((tag) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)
            : <span className="text-sm text-muted-foreground">—</span>}
        </div>
      )}
    </div>
  );
};

export const InlineSkillsField = (props: InlineMultiProps) => (
  <InlineMultiSelectShell {...props} renderEditor={(draft, onChange) => <SkillMultiSelect value={draft} onChange={onChange} />} />
);

export const InlineLanguagesField = (props: InlineMultiProps) => (
  <InlineMultiSelectShell {...props} renderEditor={(draft, onChange) => <LanguageMultiSelect value={draft} onChange={onChange} />} />
);

export const InlineNationalityField = ({
  id,
  label,
  value,
  onSave,
  onDirtyChange,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  onSave: (value: string) => Promise<void>;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (next: string) => {
    onDirtyChange(id, true);
    setSaving(true);
    try {
      await onSave(next);
      onDirtyChange(id, false);
    } catch {
      onDirtyChange(id, true);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className={fieldShellClass}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="mt-2">
          <NationalitySelect value={value} onChange={(next) => void save(next)} />
        </div>
        <div className="mt-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" disabled={saving} onClick={() => setEditing(false)}>
            <X className="h-3.5 w-3.5" />
            Sluiten
          </Button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className={`group w-full text-left ${fieldShellClass}`}>
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <Pencil className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="block min-h-5 text-sm mt-1">{value || emptyValue}</span>
    </button>
  );
};
