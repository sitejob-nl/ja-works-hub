import { useState } from 'react';
import { toast } from 'sonner';
import { QrCode, Plus, Download, Copy, Trash2, Edit, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useWhatsAppQuery, useWhatsAppMutation } from '@/hooks/useWhatsAppApi';

// ── Types ──────────────────────────────────────────────────────────────────

interface QRCode {
  id: string;
  prefilled_message: string;
  deep_link_url?: string;
  qr_image_url?: string;
  qr_image?: string; // base64
}

type ImageFormat = 'SVG' | 'PNG';

// ── Create dialog ──────────────────────────────────────────────────────────

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateDialog({ open, onOpenChange }: CreateDialogProps) {
  const [message, setMessage] = useState('');
  const [format, setFormat] = useState<ImageFormat>('PNG');

  const createMutation = useWhatsAppMutation('create_qr_code');

  const handleCreate = async () => {
    if (!message.trim()) {
      toast.error('Vul een vooringevuld bericht in');
      return;
    }
    try {
      await createMutation.mutateAsync({ prefilled_message: message.trim(), format });
      toast.success('QR code aangemaakt');
      setMessage('');
      setFormat('PNG');
      onOpenChange(false);
    } catch {
      // error already shown by mutation's onError
    }
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setMessage('');
      setFormat('PNG');
    }
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nieuwe QR code aanmaken</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="qr-message">Vooringevuld bericht</Label>
            <Textarea
              id="qr-message"
              placeholder="Hallo, ik heb een vraag over..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Dit bericht wordt automatisch ingevuld wanneer iemand de QR code scant.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Afbeeldingsformaat</Label>
            <div className="flex gap-2">
              {(['PNG', 'SVG'] as ImageFormat[]).map((f) => (
                <Button
                  key={f}
                  type="button"
                  variant={format === f ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFormat(f)}
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Annuleren
          </Button>
          <Button onClick={handleCreate} disabled={createMutation.isPending} className="gap-2">
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Aanmaken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit dialog ────────────────────────────────────────────────────────────

interface EditDialogProps {
  qrCode: QRCode | null;
  onOpenChange: (open: boolean) => void;
}

function EditDialog({ qrCode, onOpenChange }: EditDialogProps) {
  const [message, setMessage] = useState(qrCode?.prefilled_message ?? '');

  const updateMutation = useWhatsAppMutation('update_qr_code');

  // Sync message when qrCode changes (dialog opens for a different item)
  if (qrCode && message !== qrCode.prefilled_message && !updateMutation.isPending) {
    setMessage(qrCode.prefilled_message);
  }

  const handleSave = async () => {
    if (!qrCode) return;
    if (!message.trim()) {
      toast.error('Vul een vooringevuld bericht in');
      return;
    }
    try {
      await updateMutation.mutateAsync({ qr_id: qrCode.id, prefilled_message: message.trim() });
      toast.success('QR code bijgewerkt');
      onOpenChange(false);
    } catch {
      // error already shown by mutation's onError
    }
  };

  return (
    <Dialog open={!!qrCode} onOpenChange={(val) => !val && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>QR code bewerken</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="qr-edit-message">Vooringevuld bericht</Label>
            <Textarea
              id="qr-edit-message"
              placeholder="Hallo, ik heb een vraag over..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-2">
            {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Opslaan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── QR Code card ───────────────────────────────────────────────────────────

interface QRCodeCardProps {
  qrCode: QRCode;
  onEdit: (qrCode: QRCode) => void;
  onDelete: (qrCode: QRCode) => void;
}

function QRCodeCard({ qrCode, onEdit, onDelete }: QRCodeCardProps) {
  const deepLink = qrCode.deep_link_url ?? qrCode.qr_image_url ?? '';

  const handleCopy = () => {
    if (!deepLink) {
      toast.error('Geen link beschikbaar');
      return;
    }
    navigator.clipboard.writeText(deepLink).then(() => toast.success('Link gekopieerd'));
  };

  const handleDownload = () => {
    const src = qrCode.qr_image;
    if (!src) {
      toast.error('Geen QR afbeelding beschikbaar');
      return;
    }
    // src can be a base64 data URI or a URL
    const a = document.createElement('a');
    a.href = src.startsWith('data:') ? src : `data:image/png;base64,${src}`;
    a.download = `qr-code-${qrCode.id}.png`;
    a.click();
  };

  // Determine image src
  const imageSrc = qrCode.qr_image
    ? qrCode.qr_image.startsWith('data:')
      ? qrCode.qr_image
      : `data:image/png;base64,${qrCode.qr_image}`
    : null;

  return (
    <Card className="flex flex-col overflow-hidden">
      {/* QR image area */}
      <div className="bg-muted flex items-center justify-center p-6 border-b min-h-[180px]">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt="QR code"
            className="w-36 h-36 object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <QrCode className="h-16 w-16 opacity-30" />
            <span className="text-xs">Geen afbeelding</span>
          </div>
        )}
      </div>

      <CardContent className="flex flex-col gap-3 p-4 flex-1">
        {/* Prefilled message */}
        <div>
          <p className="text-xs text-muted-foreground mb-1">Vooringevuld bericht</p>
          <p className="text-sm line-clamp-3">{qrCode.prefilled_message || '—'}</p>
        </div>

        {/* Deep link */}
        {deepLink && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Deep link</p>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-xs font-mono truncate max-w-[160px]">
                {deepLink}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={handleCopy}
                title="Kopieer link"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <a href={deepLink} target="_blank" rel="noopener noreferrer">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  title="Open link"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </a>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 mt-auto pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 flex-1"
            onClick={handleDownload}
            disabled={!qrCode.qr_image}
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 flex-1"
            onClick={() => onEdit(qrCode)}
          >
            <Edit className="h-3.5 w-3.5" />
            Bewerken
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => onDelete(qrCode)}
            title="Verwijderen"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function QRCodeManager() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<QRCode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QRCode | null>(null);

  const { data, isLoading } = useWhatsAppQuery('list_qr_codes');
  const deleteMutation = useWhatsAppMutation('delete_qr_code');

  // Normalize API response — Meta wraps results in data.data
  const qrCodes: QRCode[] = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data)
    ? data
    : [];

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ qr_id: deleteTarget.id });
      toast.success('QR code verwijderd');
    } catch {
      // error already shown by mutation's onError
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold">QR Codes</h2>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Nieuwe QR code
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : qrCodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <QrCode className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">Nog geen QR codes</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Maak een QR code aan zodat klanten je eenvoudig kunnen bereiken.
            </p>
          </div>
          <Button size="sm" className="gap-1.5 mt-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Eerste QR code aanmaken
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {qrCodes.map((qr) => (
            <QRCodeCard
              key={qr.id}
              qrCode={qr}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Edit dialog */}
      <EditDialog qrCode={editTarget} onOpenChange={(open) => !open && setEditTarget(null)} />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>QR code verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Deze actie kan niet ongedaan worden gemaakt. De QR code en de bijbehorende link
              worden permanent verwijderd.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Verwijderen'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
