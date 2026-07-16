import { HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface HelpDotProps {
  /** Korte titel bovenaan de uitleg (meestal het veldlabel). */
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Klein vraagteken-icoon naast een label. Klik/tik opent een popover met uitleg.
 * Popover (niet Tooltip) zodat het ook op touch-apparaten werkt.
 */
const HelpDot = ({ title, children, className }: HelpDotProps) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label={title ? `Uitleg over ${title}` : 'Uitleg'}
        className={`inline-flex items-center justify-center align-middle text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full ${className ?? ''}`}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="start" className="max-w-[280px] w-auto text-sm leading-relaxed">
      {title && <p className="font-medium mb-1">{title}</p>}
      <div className="text-muted-foreground">{children}</div>
    </PopoverContent>
  </Popover>
);

export default HelpDot;
