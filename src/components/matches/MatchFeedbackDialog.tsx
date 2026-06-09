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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { getMatchStatusMeta, requiresMatchFeedbackReason } from '@/lib/match-status';

type FeedbackReason = {
  id: string;
  reason?: string | null;
  label?: string | null;
  name?: string | null;
  applies_to?: string | null;
};

type MatchFeedbackDialogProps = {
  open: boolean;
  toStatus?: string | null;
  count?: number;
  reasons: FeedbackReason[];
  reasonId: string;
  notes: string;
  pending?: boolean;
  onReasonChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

const reasonLabel = (reason: FeedbackReason) => reason.reason ?? reason.label ?? reason.name ?? reason.id;

const MatchFeedbackDialog = ({
  open,
  toStatus,
  count = 1,
  reasons,
  reasonId,
  notes,
  pending = false,
  onReasonChange,
  onNotesChange,
  onCancel,
  onSubmit,
}: MatchFeedbackDialogProps) => {
  const meta = getMatchStatusMeta(toStatus);
  const required = requiresMatchFeedbackReason(toStatus);
  const scopedReasons = reasons.filter((reason) => !reason.applies_to || reason.applies_to === toStatus);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Feedback vastleggen</DialogTitle>
          <DialogDescription>
            Leg vast waarom {count === 1 ? 'deze match' : `${count} matches`} naar {meta.label} gaat.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="match-feedback-reason">Reden{required ? ' *' : ''}</Label>
            <Select value={reasonId} onValueChange={onReasonChange}>
              <SelectTrigger id="match-feedback-reason">
                <SelectValue placeholder="Kies een reden" />
              </SelectTrigger>
              <SelectContent>
                {scopedReasons.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Geen redenen geconfigureerd</div>
                )}
                {scopedReasons.map((reason) => (
                  <SelectItem key={reason.id} value={reason.id}>{reasonLabel(reason)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="match-feedback-notes">Notitie</Label>
            <Textarea
              id="match-feedback-notes"
              value={notes}
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Optionele toelichting"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>Annuleren</Button>
          <Button onClick={onSubmit} disabled={pending || (required && !reasonId)}>
            {pending ? 'Opslaan...' : 'Status bijwerken'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MatchFeedbackDialog;
