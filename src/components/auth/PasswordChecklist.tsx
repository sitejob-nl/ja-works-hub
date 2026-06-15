import { Check, X } from 'lucide-react';
import { checkPassword, type PasswordChecks } from '@/lib/password-policy';

export interface PasswordChecklistLabels {
  length: string;
  lower: string;
  upper: string;
  digit: string;
  symbol: string;
}

const ORDER: (keyof PasswordChecks)[] = ['length', 'lower', 'upper', 'digit', 'symbol'];

/**
 * Live checklist of the password requirements, mirroring the Supabase Auth policy.
 * Render it under the password field so users see exactly what's needed instead of
 * hitting an opaque server rejection. Labels are passed in for i18n.
 */
export function PasswordChecklist({
  password,
  labels,
}: {
  password: string;
  labels: PasswordChecklistLabels;
}) {
  const checks = checkPassword(password);
  return (
    <ul className="space-y-1 text-xs" aria-live="polite">
      {ORDER.map((key) => {
        const ok = checks[key];
        return (
          <li
            key={key}
            className={`flex items-center gap-1.5 ${ok ? 'text-stat-green' : 'text-muted-foreground'}`}
          >
            {ok ? (
              <Check className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <X className="h-3.5 w-3.5 shrink-0 opacity-40" />
            )}
            <span>{labels[key]}</span>
          </li>
        );
      })}
    </ul>
  );
}
