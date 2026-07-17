import type { ReactNode } from 'react';
import { AlertTriangle, MessageSquare } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type MatchOutboundDialogProps = {
  open: boolean;
  title: string;
  description: string;
  channelLabel: string;
  selectedCount: number;
  missingContactCount?: number;
  paused?: boolean;
  pausedLabel?: string;
  message: string;
  pending?: boolean;
  onMessageChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  /** Optionele extra sectie (bv. template-keuze voor kandidaten buiten het 24u-venster). */
  extra?: ReactNode;
  /** Als false is versturen geblokkeerd ondanks geldige invoer (bv. template vereist maar niet gekozen). */
  canConfirm?: boolean;
};

const MatchOutboundDialog = ({
  open,
  title,
  description,
  channelLabel,
  selectedCount,
  missingContactCount = 0,
  paused = false,
  pausedLabel = 'Uitgaande communicatie staat op pauze.',
  message,
  pending = false,
  onMessageChange,
  onCancel,
  onConfirm,
  extra,
  canConfirm = true,
}: MatchOutboundDialogProps) => (
  <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !pending) onCancel(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Kanaal</p>
            <p className="font-medium">{channelLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Geselecteerd</p>
            <p className="font-medium">{selectedCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Zonder contact</p>
            <p className="font-medium">{missingContactCount}</p>
          </div>
        </div>

        {paused && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Versturen gepauzeerd</AlertTitle>
            <AlertDescription>{pausedLabel}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="match-outbound-message">Bericht</Label>
          <Textarea
            id="match-outbound-message"
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            Controleer ontvangers en inhoud voordat je verstuurt. Bewaakte sendpaden respecteren de outbound kill-switch.
          </p>
        </div>

        {extra}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>Annuleren</Button>
        <Button onClick={onConfirm} disabled={pending || paused || !message.trim() || selectedCount === 0 || !canConfirm}>
          <MessageSquare className="h-3.5 w-3.5" /> {pending ? 'Versturen...' : 'Bevestig en verstuur'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default MatchOutboundDialog;
