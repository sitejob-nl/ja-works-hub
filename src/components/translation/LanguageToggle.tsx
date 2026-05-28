import { Globe, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PlatformLanguage } from '@/contexts/translation-context';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

const languages: Array<{ value: PlatformLanguage; label: string; short: string }> = [
  { value: 'nl', label: 'Nederlands', short: 'NL' },
  { value: 'en', label: 'English', short: 'EN' },
];

interface LanguageToggleProps {
  compact?: boolean;
  className?: string;
}

export function LanguageToggle({ compact = false, className }: LanguageToggleProps) {
  const { language, isTranslating, setLanguage } = useTranslation();
  const active = languages.find((item) => item.value === language) ?? languages[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          className={cn(compact ? 'h-8 w-8' : 'gap-1.5', className)}
          title="Taal wisselen"
          data-no-translate="true"
        >
          {isTranslating ? <Languages className="h-4 w-4 animate-pulse" /> : <Globe className="h-4 w-4" />}
          {!compact && <span className="text-xs font-semibold">{active.short}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-no-translate="true">
        {languages.map((item) => (
          <DropdownMenuItem
            key={item.value}
            onClick={() => setLanguage(item.value)}
            className={cn(item.value === language && 'font-semibold')}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
