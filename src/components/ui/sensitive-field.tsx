import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface SensitiveFieldProps {
  label: string;
  value: string | null | undefined;
  loading?: boolean;
}

/** Masks a value showing only the last 3 characters */
function mask(val: string): string {
  if (val.length <= 3) return '•••';
  return '•'.repeat(val.length - 3) + val.slice(-3);
}

const SensitiveField = ({ label, value, loading }: SensitiveFieldProps) => {
  const [visible, setVisible] = useState(false);

  const displayValue = loading
    ? '...'
    : !value
      ? '—'
      : visible
        ? value
        : mask(value);

  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1.5 mt-0.5">
        <p className="text-sm font-mono">{displayValue}</p>
        {value && !loading && (
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={visible ? 'Verberg' : 'Toon'}
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
};

export default SensitiveField;
