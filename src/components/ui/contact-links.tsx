import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const stop = (enabled: boolean) => (e: { stopPropagation: () => void }) => {
  if (enabled) e.stopPropagation();
};

interface PhoneLinkProps {
  phone?: string | null;
  className?: string;
  stopPropagation?: boolean;
  /** Tekst om te tonen; default het telefoonnummer zelf. */
  children?: ReactNode;
}

/** Telefoonnummer als tap-to-call (`tel:`). Valt terug op een streepje wanneer leeg. */
export function PhoneLink({ phone, className, stopPropagation = true, children }: PhoneLinkProps) {
  if (!phone) return <span className="text-muted-foreground">—</span>;
  const tel = phone.replace(/[^\d+]/g, '');
  return (
    <a href={`tel:${tel}`} onClick={stop(stopPropagation)} className={cn('hover:underline', className)}>
      {children ?? phone}
    </a>
  );
}

export default PhoneLink;
