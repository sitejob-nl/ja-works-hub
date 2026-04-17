import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatEUR } from '@/lib/format';
import { CheckCircle2, XCircle } from 'lucide-react';

const VacancyDetailsTab = ({ vacancy }: { vacancy: any }) => {
  const company = vacancy.companies as any;
  const primaryContact = (vacancy.company_contacts as any[])?.find((c: any) => c.is_primary);

  return (
    <div className="space-y-6 mt-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Vacature gegevens</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Titel</span><span>{vacancy.title}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Locatie</span><span>{vacancy.location ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Aantal nodig</span><span>{vacancy.required_count}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Urgentie</span><span>{vacancy.urgency}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Startdatum</span><span>{formatDate(vacancy.start_date)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Einddatum</span><span>{formatDate(vacancy.end_date)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Uurtarief</span><span>{vacancy.hourly_rate ? formatEUR(vacancy.hourly_rate) : '—'}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Vereisten</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <span className="text-muted-foreground block mb-1">Vaardigheden</span>
              <div className="flex gap-1 flex-wrap">
                {(vacancy.required_skills ?? []).length > 0
                  ? vacancy.required_skills.map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)
                  : <span className="text-muted-foreground">—</span>}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1">Certificaten</span>
              <div className="flex gap-1 flex-wrap">
                {(vacancy.required_certifications ?? []).length > 0
                  ? vacancy.required_certifications.map((c: string) => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)
                  : <span className="text-muted-foreground">—</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Rijbewijs vereist</span>
              {vacancy.requires_drivers_license ? <CheckCircle2 className="h-4 w-4 text-stat-green" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardContent>
        </Card>
      </div>

      {vacancy.description && (
        <Card>
          <CardHeader><CardTitle className="text-base">Beschrijving</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{vacancy.description}</p>
          </CardContent>
        </Card>
      )}

      {company && (
        <Card>
          <CardHeader><CardTitle className="text-base">Opdrachtgever</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bedrijf</span>
              <Link to={`/opdrachtgevers/${company.id}`} className="text-primary hover:underline">{company.name}</Link>
            </div>
            {primaryContact && (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Contactpersoon</span><span>{primaryContact.full_name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Telefoon</span><span>{primaryContact.phone ?? company.phone ?? '—'}</span></div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default VacancyDetailsTab;
