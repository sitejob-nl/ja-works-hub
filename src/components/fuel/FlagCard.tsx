import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AlertTriangle, CheckCircle2, StickyNote, Car, UserRound, CreditCard } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { displayPlate } from '@/lib/fuel-analysis';

export const FlagCard = ({ t, onReview, onSaveNote }: { t: any; onReview: () => void; onSaveNote: (n: string) => void }) => {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(t.flag_notes ?? '');
  const emp = t.employees?.candidates;
  const empName = emp ? `${emp.first_name} ${emp.last_name}` : null;

  // Count same-day transactions
  const sameDayCount = t.flag_multiple_same_day ? '2+' : null;

  const plate = displayPlate(t);

  return (
    <Card className="border-destructive/30">
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="font-medium">{formatDate(t.transaction_date)}</span>

          {t.vehicles ? (
            <Link to={`/transport/${t.vehicles.id}`} className="text-foreground hover:hover:underline font-mono font-semibold inline-flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5" />
              {plate}
            </Link>
          ) : plate ? (
            <span className="font-mono font-semibold text-foreground inline-flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5" />
              {plate}
              <span className="text-xs italic ml-1 font-normal text-muted-foreground">(geen voertuig-record)</span>
            </span>
          ) : (
            <span className="text-muted-foreground italic inline-flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" />
              Kaart {t.fuel_card_reference || '—'}
            </span>
          )}

          {empName && t.employees?.id ? (
            <Link to={`/medewerkers/${t.employees.id}`} className="hover:underline inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" />
              {empName}
            </Link>
          ) : (
            <span className="text-muted-foreground italic inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" />
              Geen toewijzing
            </span>
          )}

          <span className="ml-auto">{t.liters}L · {formatEUR(t.amount_eur)}</span>
          {t.station_name && <span className="text-xs text-muted-foreground">{t.station_name}</span>}
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-2">
          {t.flag_over_capacity && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Boven tankcapaciteit
              {t.vehicles?.tank_capacity_liters && <span className="font-normal ml-1">({t.liters}L / {t.vehicles.tank_capacity_liters}L)</span>}
            </Badge>
          )}
          {t.flag_multiple_same_day && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Meerdere keren per dag {sameDayCount && `(${sameDayCount})`}
            </Badge>
          )}
          {t.flag_excessive_consumption && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Overmatig verbruik
            </Badge>
          )}
        </div>

        {t.flag_notes && !noteOpen && <p className="text-xs text-muted-foreground bg-muted rounded p-2">{t.flag_notes}</p>}

        {noteOpen && (
          <div className="flex gap-2">
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Notitie…" className="flex-1" />
            <Button size="sm" onClick={() => { onSaveNote(note); setNoteOpen(false); }}>Opslaan</Button>
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onReview}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Bekeken</Button>
          <Button size="sm" variant="ghost" onClick={() => setNoteOpen(!noteOpen)}><StickyNote className="h-3.5 w-3.5 mr-1" /> Notitie</Button>
        </div>
      </CardContent>
    </Card>
  );
};
