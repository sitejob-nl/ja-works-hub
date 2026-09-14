import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Camera, Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { feedbackApi } from '@/lib/feedback-api';
import { captureFeedbackScreen, normalizeScreenshot } from '@/lib/feedback-screenshot';
import { toFriendlyError } from '@/lib/errorMessages';
import { feedbackReceiptMessage, validateFeedbackInput, type FeedbackDiagnostics, type FeedbackInput, type FeedbackKind, type FeedbackReceipt } from '../../../supabase/functions/_shared/feedback-contract';
import ScreenshotEditor from './ScreenshotEditor';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; diagnostics: FeedbackDiagnostics; onNewReport: () => void; onComplete: () => void }
export default function FeedbackDialog({ open, onOpenChange, diagnostics, onNewReport, onComplete }: Props) {
  const [id, setId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [title, setTitle] = useState(''), [description, setDescription] = useState('');
  const [steps, setSteps] = useState(''), [expected, setExpected] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [imageBusy, setImageBusy] = useState(false), [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  // Freeze the exact payload on first submission. A retry after a lost response
  // reuses both ID and content, so it can never create a duplicate notification.
  const attempt = useRef<FeedbackInput | null>(null);
  const mutation = useMutation({
    mutationFn: (report: FeedbackInput) => feedbackApi<FeedbackReceipt>({ action: 'submit', report }),
    retry: false,
    onError: e => setError(toFriendlyError(e)),
  });
  const locked = !!attempt.current || mutation.isPending;
  const receipt = mutation.data;
  const reset = () => {
    attempt.current = null; mutation.reset(); setId(crypto.randomUUID());
    setTitle(''); setDescription(''); setSteps(''); setExpected(''); setScreenshot(null); setConfirmed(false); setError('');
    onNewReport();
  };
  const addImage = async (file: Blob) => {
    setImageBusy(true); setError('');
    try { setScreenshot(await normalizeScreenshot(file)); setConfirmed(false); }
    catch (e) { setError(toFriendlyError(e)); }
    finally { setImageBusy(false); }
  };
  const capture = async () => {
    setCapturing(true); setImageBusy(true); setError('');
    try { setScreenshot(await captureFeedbackScreen()); setConfirmed(false); }
    catch (e) { if ((e as Error).name !== 'NotAllowedError') setError(toFriendlyError(e)); }
    finally { setCapturing(false); setImageBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (imageBusy || mutation.isPending) return;
    if (screenshot && !confirmed) { setError('Controleer het screenshot en vink aan dat je het wilt delen.'); return; }
    try {
      attempt.current ??= validateFeedbackInput({ id, kind, title, description, steps, expected,
        diagnostics, screenshot: screenshot?.split(',')[1] ?? null });
      mutation.mutate(attempt.current);
    } catch (e) { setError(toFriendlyError(e)); }
  };
  return <Dialog open={open && !capturing} onOpenChange={v => { if (!mutation.isPending && !imageBusy) onOpenChange(v); }}>
    <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto" onPaste={event => {
      if (locked || imageBusy) return;
      const item = Array.from(event.clipboardData.items).find(i => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { event.preventDefault(); void addImage(file); }
    }}>
      <DialogHeader>
        <DialogTitle>Bug of idee melden</DialogTitle>
        <DialogDescription>Je melding gaat naar SiteJob via info@sitejob.nl. Bij afronden krijg je een persoonlijke notificatie in het systeem.</DialogDescription>
      </DialogHeader>
      <Link to="/feedback" className="text-sm underline" onClick={() => onOpenChange(false)}>Mijn meldingen en terugkoppeling</Link>
      {receipt ? <div className="space-y-4" role="status">
        <CheckCircle2 className="h-8 w-8 text-primary" />
        <p>{feedbackReceiptMessage(receipt)}</p>
        {receipt.has_screenshot && !receipt.screenshot_path && <p className="text-sm text-destructive">Het screenshot is nog niet opgeslagen. Probeer de melding opnieuw af te ronden.</p>}
        <div className="flex gap-2 flex-wrap">
          {['failed', 'paused', 'pending'].includes(receipt.email_status) && <Button disabled={mutation.isPending} onClick={() => mutation.mutate(attempt.current!)}>Opnieuw proberen</Button>}
          <Button variant="outline" onClick={onComplete}>Sluiten</Button>
          <Button variant="ghost" onClick={reset}>Nieuwe melding</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div> : <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={locked || imageBusy} className="space-y-4">
          <div className="flex gap-2" role="group" aria-label="Soort melding">
            <Button type="button" variant={kind === 'bug' ? 'default' : 'outline'} aria-pressed={kind === 'bug'} onClick={() => setKind('bug')}>Bug melden</Button>
            <Button type="button" variant={kind === 'idea' ? 'default' : 'outline'} aria-pressed={kind === 'idea'} onClick={() => setKind('idea')}>Verbeteridee</Button>
          </div>
          <div className="space-y-1.5"><Label htmlFor="feedback-title">Onderwerp *</Label><Input id="feedback-title" required minLength={3} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === 'bug' ? 'Bijvoorbeeld: kandidaat opslaan lukt niet' : 'Bijvoorbeeld: sneller zoeken in vacatures'} /></div>
          <div className="space-y-1.5"><Label htmlFor="feedback-description">{kind === 'bug' ? 'Wat gaat er mis? *' : 'Wat wil je kunnen en waarom? *'}</Label><Textarea id="feedback-description" required minLength={3} maxLength={5000} rows={3} value={description} onChange={e => setDescription(e.target.value)} /></div>
          {kind === 'bug' && <>
            <div className="space-y-1.5"><Label htmlFor="feedback-steps">Wat deed je vlak daarvoor?</Label><Textarea id="feedback-steps" maxLength={3000} rows={2} value={steps} onChange={e => setSteps(e.target.value)} placeholder="Bijvoorbeeld: kandidaat openen → gegevens aanpassen → opslaan" /></div>
            <div className="space-y-1.5"><Label htmlFor="feedback-expected">Wat had je verwacht?</Label><Textarea id="feedback-expected" maxLength={2000} rows={2} value={expected} onChange={e => setExpected(e.target.value)} /></div>
          </>}
          <div className="space-y-2">
            <p className="text-sm font-medium">Screenshot (optioneel)</p>
            <div className="flex gap-2 flex-wrap">
              {navigator.mediaDevices?.getDisplayMedia && <Button type="button" variant="outline" size="sm" onClick={() => void capture()}><Camera className="h-4 w-4 mr-2" />Scherm vastleggen</Button>}
              <Button type="button" variant="outline" size="sm" onClick={() => upload.current?.click()}><Upload className="h-4 w-4 mr-2" />Afbeelding uploaden</Button>
              <input ref={upload} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Screenshot uploaden" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) void addImage(file); e.target.value = ''; }} />
            </div>
            <p className="text-xs text-muted-foreground">Je kunt hier ook een screenshot plakken met Ctrl+V of ⌘V.</p>
          </div>
        </fieldset>
        {imageBusy && <p role="status" className="text-sm">Screenshot verwerken…</p>}
        {screenshot && <ScreenshotEditor source={screenshot} disabled={locked || imageBusy} onChange={setScreenshot} confirmed={confirmed} onConfirm={setConfirmed} onRemove={() => { setScreenshot(null); setConfirmed(false); }} />}
        <details className="rounded-md bg-muted/50 p-3 text-xs">
          <summary className="cursor-pointer font-medium">Welke gegevens sturen we mee?</summary>
          <p className="mt-2">Je naam, e-mailadres en organisatie, de pagina, het tijdstip, je browser, schermgrootte en appversie{kind === 'bug' ? ', plus maximaal vijf recente technische fouten' : ''}. Controleer je tekst en screenshot op persoonlijke gegevens.</p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ ...diagnostics, errors: kind === 'bug' ? diagnostics.errors : [] }, null, 2)}</pre>
        </details>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={mutation.isPending || imageBusy} onClick={() => onOpenChange(false)}>Later verder</Button>
          <Button type="submit" disabled={mutation.isPending || imageBusy || (!!screenshot && !confirmed)}>{mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{attempt.current ? 'Opnieuw proberen' : 'Melding versturen'}</Button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
