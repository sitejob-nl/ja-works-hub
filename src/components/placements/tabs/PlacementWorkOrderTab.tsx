import { Link } from 'react-router-dom';
import type { ElementType, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, BriefcaseBusiness, Building2, CalendarClock, Clock3, Euro, FileText, Home, MapPin, ShieldCheck, User, WalletCards } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { unwrapList } from '@/lib/db';
import { formatDate, formatEUR } from '@/lib/format';
import { qk } from '@/lib/query-keys';

type PlacementWorkOrderTabProps = {
  placement: any;
  candidate: any;
  company: any;
  onEdit?: () => void;
  showFinanceActions?: boolean;
};

const statusLabel: Record<string, string> = {
  gepland: 'Gepland',
  actief: 'Actief',
  afgerond: 'Afgerond',
  voortijdig_beeindigd: 'Voortijdig beëindigd',
};

const housingPaymentLabel: Record<string, string> = {
  betaald: 'Betaald door medewerker',
  inhouding: 'Inhouding via payroller',
  gratis: 'Gratis huisvesting',
};

const clientApprovalLabel = (value: boolean | null | undefined) => {
  if (value === true) return 'Klant akkoord';
  if (value === false) return 'Klant afgekeurd';
  return 'Nog geen klantakkoord';
};

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Fact({ icon, label, value }: { icon: ElementType; label: string; value: ReactNode }) {
  const Icon = icon;
  return (
    <div className="flex items-start gap-3 rounded-md border bg-background px-3 py-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium break-words">{value || '—'}</div>
      </div>
    </div>
  );
}

export default function PlacementWorkOrderTab({ placement, candidate, company, onEdit, showFinanceActions = false }: PlacementWorkOrderTabProps) {
  const { data: operations } = useQuery({
    queryKey: qk.placements.workOrderOps(placement.id),
    queryFn: async () => {
      const [timesheets, hourTypes, travelTypes, allowances] = await Promise.all([
        unwrapList<any>(supabase
          .from('timesheets')
          .select('id, status, hours, overtime_hours, travel_km, client_approved, invoice_line_id')
          .eq('placement_id', placement.id)),
        unwrapList<any>(supabase
          .from('placement_hour_types')
          .select('id')
          .eq('placement_id', placement.id)),
        unwrapList<any>(supabase
          .from('placement_travel_types')
          .select('id')
          .eq('placement_id', placement.id)),
        unwrapList<any>(supabase
          .from('placement_allowances')
          .select('id')
          .eq('placement_id', placement.id)),
      ]);

      const rows = timesheets;
      const approved = rows.filter((row: any) => row.status === 'goedgekeurd').length;
      const attention = rows.filter((row: any) => ['oranje', 'rood', 'afgekeurd'].includes(row.status)).length;
      const invoiced = rows.filter((row: any) => row.invoice_line_id).length;
      const clientPending = rows.filter((row: any) => row.client_approved == null && row.status !== 'concept').length;
      const totalHours = rows.reduce((sum: number, row: any) => sum + Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0), 0);

      return {
        timesheetCount: rows.length,
        approved,
        attention,
        invoiced,
        clientPending,
        totalHours,
        hourTypeCount: hourTypes.length,
        travelTypeCount: travelTypes.length,
        allowanceCount: allowances.length,
      };
    },
  });

  const billRate = Number(placement.client_hourly_rate ?? 0);
  const payRate = Number(placement.hourly_rate ?? 0);
  const margin = billRate > 0 ? billRate - payRate : null;
  const marginPct = billRate > 0 && margin != null ? Math.round((margin / billRate) * 1000) / 10 : null;
  const timesheetProgress = operations?.timesheetCount
    ? Math.round((operations.approved / operations.timesheetCount) * 100)
    : 0;

  const workDays = Array.isArray(placement.work_days) && placement.work_days.length > 0
    ? placement.work_days.join(', ')
    : 'Nog niet vastgelegd';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Werkorder</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {candidate ? `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim() : 'Onbekende medewerker'} bij {company?.name ?? 'onbekende opdrachtgever'}
                </p>
              </div>
              <Badge variant="secondary">{statusLabel[placement.status] ?? placement.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact icon={BriefcaseBusiness} label="Functie" value={placement.function_name} />
              <Fact icon={Building2} label="Opdrachtgever" value={company?.id ? <Link className="hover:underline" to={`/opdrachtgevers/${company.id}`}>{company.name}</Link> : company?.name} />
              <Fact icon={User} label="Medewerker" value={placement.candidate_id ? <Link className="hover:underline" to={`/kandidaten/${placement.candidate_id}`}>{candidate?.first_name} {candidate?.last_name}</Link> : '—'} />
              <Fact icon={CalendarClock} label="Periode" value={`${formatDate(placement.start_date)} - ${formatDate(placement.expected_end_date || placement.end_date) || 'heden'}`} />
              <Fact icon={MapPin} label="Werklocatie" value={placement.work_location || company?.address_city} />
              <Fact icon={Clock3} label="Werkpatroon" value={`${placement.cao_hours ?? '—'} uur/week · ${workDays}`} />
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Urenstroom</div>
                  <div className="text-xs text-muted-foreground">
                    {operations?.timesheetCount ?? 0} registraties · {operations?.totalHours.toFixed(2) ?? '0.00'} uur
                  </div>
                </div>
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <Link to={`/uren?placement_id=${placement.id}`}>
                    Open uren <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
              <Progress value={timesheetProgress} className="h-2" />
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                <span>{operations?.approved ?? 0} goedgekeurd</span>
                <span>{operations?.attention ?? 0} aandacht</span>
                <span>{operations?.clientPending ?? 0} klant open</span>
                <span>{operations?.invoiced ?? 0} gefactureerd</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pay & bill</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Metric label="Medewerker" value={formatEUR(placement.hourly_rate)} hint="uurtarief" />
              <Metric label="Opdrachtgever" value={placement.client_hourly_rate ? formatEUR(placement.client_hourly_rate) : 'Nog niet vastgelegd'} hint="factuurtarief" />
              <Metric label="Marge indicatie" value={margin != null ? `${formatEUR(margin)} / uur` : '—'} hint={marginPct != null ? `${marginPct}% op factuurtarief` : 'Factuurtarief ontbreekt'} />
              <Metric label="Overwerk" value={placement.overtime_rate ? formatEUR(placement.overtime_rate) : '—'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Operationele checks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" />Compliance</span>
                <Badge variant="secondary" className={placement.compliance_check_passed ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-orange-100 text-orange-700 border-0'}>
                  {placement.compliance_check_passed ? 'Akkoord' : 'Controle nodig'}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2"><WalletCards className="h-4 w-4 text-muted-foreground" />Uurtypes</span>
                <span className="text-muted-foreground">{operations?.hourTypeCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />Reistypes</span>
                <span className="text-muted-foreground">{operations?.travelTypeCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2"><Euro className="h-4 w-4 text-muted-foreground" />Vergoedingen</span>
                <span className="text-muted-foreground">{operations?.allowanceCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2"><Home className="h-4 w-4 text-muted-foreground" />Huisvesting</span>
                <span className="text-muted-foreground">{placement.housing_payment_type ? housingPaymentLabel[placement.housing_payment_type] : 'Niet vastgelegd'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-muted-foreground" />Klanturen</span>
                <span className="text-muted-foreground">{clientApprovalLabel(operations?.clientPending === 0 && (operations?.timesheetCount ?? 0) > 0 ? true : null)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Vervolgacties</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {showFinanceActions && <Button asChild variant="outline" size="sm">
            <Link to={`/uren?placement_id=${placement.id}`}>Bekijk uren</Link>
          </Button>}
          {showFinanceActions && <Button asChild variant="outline" size="sm">
            <Link to={`/facturatie?placement_id=${placement.id}`}>Naar facturatie</Link>
          </Button>}
          {placement.vacancy_id && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/vacatures/${placement.vacancy_id}`}>Vacature</Link>
            </Button>
          )}
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              Werkorder bijwerken
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link to={`/plaatsingen/${placement.id}?tab=taken`}>
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              Taken
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
