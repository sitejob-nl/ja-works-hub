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
  const [tool, setTool] = useState<'none' | 'redact' | 'circle'>('none');
  const [undo, setUndo] = useState<string | null>(null);
  const lastOutput = useRef<string | null>(null);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled || !ref.current) return;
      const canvas = ref.current;
      setExportError('');
      if (source !== lastOutput.current) setUndo(null);
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
    const x = Math.min(start.current.x, end.x), y = Math.min(start.current.y, end.y);
    const width = Math.abs(end.x - start.current.x), height = Math.abs(end.y - start.current.y);
    if (tool === 'circle') {
      if (width < 1 || height < 1) return;
      const lineWidth = Math.max(3, Math.min(event.currentTarget.width, event.currentTarget.height) / 150);
      ctx.beginPath(); ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lineWidth + 2; ctx.stroke();
      ctx.strokeStyle = '#dc2626'; ctx.lineWidth = lineWidth; ctx.stroke();
    } else {
      ctx.fillStyle = '#000000'; ctx.fillRect(x, y, width, height);
    }
  };
  return <div className="space-y-3 rounded-md border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium">Controleer je screenshot</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={tool === 'circle' ? 'default' : 'outline'} disabled={disabled} aria-pressed={tool === 'circle'} onClick={() => setTool(tool === 'circle' ? 'none' : 'circle')}>Omcirkelen</Button>
        <Button type="button" size="sm" variant={tool === 'redact' ? 'default' : 'outline'} disabled={disabled} aria-pressed={tool === 'redact'} onClick={() => setTool(tool === 'redact' ? 'none' : 'redact')}>Zwartmaken</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || !undo} onClick={() => {
          if (!undo) return;
          lastOutput.current = undo; onChange(undo); setUndo(null); onConfirm(false);
        }}>Ongedaan maken</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>Verwijderen</Button>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">{tool === 'circle' ? 'Sleep een cirkel om het deel dat je wilt aanwijzen.' : tool === 'redact' ? 'Sleep een vlak over gegevens die je wilt verbergen.' : 'Omcirkel wat je wilt aanwijzen of maak persoonlijke gegevens zwart.'}</p>
    <canvas ref={ref} role="img" aria-label="Voorbeeld van het screenshot" className={`block h-auto max-h-[35vh] max-w-full border object-contain ${tool !== 'none' ? 'cursor-crosshair touch-none' : ''}`}
      onPointerDown={e => {
        if (tool === 'none' || disabled) return;
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
        try {
          const image = screenshotDataUrl(e.currentTarget);
          lastOutput.current = image; setUndo(source); onChange(image); setExportError('');
        }
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
