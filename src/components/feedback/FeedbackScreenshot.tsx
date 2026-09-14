import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function FeedbackScreenshot({ url, number, onRetry, isFetching }: {
  url: string | null; number: number; onRetry: () => void; isFetching: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return <section className="space-y-2">
    <h3 className="font-medium text-sm">Bijgevoegde screenshot</h3>
    {url && !failed ? <>
      <a href={url} target="_blank" rel="noopener noreferrer" className="block" aria-label="Screenshot op volledige grootte openen">
        <img src={url} referrerPolicy="no-referrer" alt={`Screenshot bij melding #${number}`}
          onError={() => setFailed(true)} className="max-w-full h-auto rounded-md border" />
      </a>
      <p className="text-xs text-muted-foreground">Klik op de afbeelding om deze op volledige grootte te bekijken.</p>
    </> : <p role="status" className="text-sm text-muted-foreground">De screenshot kan nu niet worden geladen. Probeer het opnieuw.</p>}
    <Button variant="outline" size="sm" disabled={isFetching} onClick={onRetry}>Screenshot opnieuw laden</Button>
  </section>;
}
