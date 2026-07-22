import { Globe, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PLATFORM_LANGUAGES, languageOption } from '@/lib/platform-languages';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface LanguageToggleProps {
  compact?: boolean;
  className?: string;
}

export function LanguageToggle({ compact = false, className }: LanguageToggleProps) {
  const { language, isTranslating, setLanguage } = useTranslation();
  const active = languageOption(language);
  const title = language === 'nl' ? 'Taal wisselen' : 'Change language';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          className={cn(compact ? 'h-8 w-8' : 'gap-1.5', className)}
          title={title}
          data-no-translate="true"
        >
          {isTranslating ? <Languages className="h-4 w-4 animate-pulse" /> : <Globe className="h-4 w-4" />}
          {!compact && <span className="text-xs font-semibold">{active.short}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-no-translate="true">
        {PLATFORM_LANGUAGES.map((item) => (
          <DropdownMenuItem
            key={item.value}
            onClick={() => setLanguage(item.value)}
            className={cn('gap-2', item.value === language && 'font-semibold')}
          >
            <span aria-hidden>{item.flag}</span>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
