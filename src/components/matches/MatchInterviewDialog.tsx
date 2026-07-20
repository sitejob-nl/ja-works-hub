import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getMatchStatusMeta } from '@/lib/match-status';

type MatchInterviewDialogProps = {
  open: boolean;
  toStatus?: string | null;
  candidateName?: string | null;
  value: string;
  pending?: boolean;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

/**
 * Datum en tijd bij een afspraakfase. Zonder datum is "Gesprek gepland" een lege
 * huls — je ziet dat er iets staat maar niet wanneer. Vult `matches.interview_date`,
 * dezelfde kolom die de publieke reactiepagina zet wanneer een klant zelf een moment
 * kiest, zodat beide routes op één plek uitkomen.
 */
const MatchInterviewDialog = ({
  open,
  toStatus,
  candidateName,
  value,
  pending = false,
  onValueChange,
  onCancel,
  onSubmit,
}: MatchInterviewDialogProps) => {
  const meta = getMatchStatusMeta(toStatus);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{meta.label}</DialogTitle>
          <DialogDescription>
            Wanneer is het gesprek {candidateName ? `met ${candidateName}` : ''}? De match gaat pas
            naar {meta.label} zodra hier een moment staat.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="match-interview-date">Datum en tijd *</Label>
          <Input
            id="match-interview-date"
            type="datetime-local"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>Annuleren</Button>
          <Button onClick={onSubmit} disabled={pending || !value}>
            {pending ? 'Opslaan...' : 'Vastleggen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MatchInterviewDialog;
