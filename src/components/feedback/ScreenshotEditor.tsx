import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { screenshotDataUrl } from '@/lib/feedback-screenshot';

interface Props {
  source: string; disabled?: boolean; onChange: (image: string) => void;
  confirmed: boolean; onConfirm: (value: boolean) => void; onRemove: () => void;
}
export default function ScreenshotEditor({ source, disabled, onChange, confirmed, onConfirm, onRemove }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const before = useRef<ImageData | null>(null);
  const [redacting, setRedacting] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled || !ref.current) return;
      const canvas = ref.current;
      setExportError('');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
    };
    img.src = source;
    return () => { cancelled = true; };
  }, [source]);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget, rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)) };
  };
  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!start.current || !before.current) return;
    const ctx = event.currentTarget.getContext('2d')!, end = point(event);
    ctx.putImageData(before.current, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.min(start.current.x, end.x), Math.min(start.current.y, end.y), Math.abs(end.x - start.current.x), Math.abs(end.y - start.current.y));
  };
  return <div className="space-y-3 rounded-md border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium">Controleer je screenshot</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={redacting ? 'default' : 'outline'} disabled={disabled} aria-pressed={redacting} onClick={() => setRedacting(!redacting)}>Zwartmaken</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>Verwijderen</Button>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">{redacting ? 'Sleep een vlak over gegevens die je wilt verbergen.' : 'Controleer op namen, BSN, bankgegevens en andere persoonlijke informatie.'}</p>
    <canvas ref={ref} role="img" aria-label="Voorbeeld van het screenshot" className={`block h-auto max-h-[35vh] max-w-full border object-contain ${redacting ? 'cursor-crosshair touch-none' : ''}`}
      onPointerDown={e => {
        if (!redacting || disabled) return;
        start.current = point(e);
        const canvas = e.currentTarget;
        before.current = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
        canvas.setPointerCapture(e.pointerId);
        onConfirm(false);
      }}
      onPointerMove={draw}
      onPointerUp={e => {
        if (!start.current) return;
        draw(e); start.current = null; before.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        try { onChange(screenshotDataUrl(e.currentTarget)); setExportError(''); }
        catch { setExportError('De bewerking kon niet worden opgeslagen. Verwijder dit screenshot en kies een kleinere afbeelding.'); }
      }}
      onPointerCancel={e => {
        if (before.current) e.currentTarget.getContext('2d')!.putImageData(before.current, 0, 0);
        start.current = null; before.current = null;
      }} />
    {exportError && <p role="alert" className="text-xs text-destructive">{exportError}</p>}
    <div className="flex items-start gap-2">
      <Checkbox id="feedback-screenshot-confirm" checked={confirmed} disabled={disabled || !!exportError} onCheckedChange={v => onConfirm(v === true)} />
      <Label htmlFor="feedback-screenshot-confirm" className="text-xs leading-5">Ik heb het screenshot gecontroleerd en wil dit met SiteJob delen.</Label>
    </div>
  </div>;
}
