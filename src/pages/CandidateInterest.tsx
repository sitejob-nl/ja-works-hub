// Publieke kandidaat-interesse-pagina (/baan/interesse/:token) — de medewerker reageert
// op een baanvoorstel uit de kandidaat-voorstelmail. Geen login; het token is het geheim.
// De links in de mail preselecteren het antwoord (?a=ja|nee) maar bevestiging gebeurt
// altijd expliciet met een knop — zo kan een mail-scanner die links prefetcht nooit
// per ongeluk een match verschuiven.
import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, XCircle, Clock, AlertTriangle, Briefcase, MapPin, Loader2 } from 'lucide-react';

type InterestData = {
  status: 'ok' | 'used' | 'expired' | 'invalid' | 'done';
  response?: string | null;
  vacancy_title?: string | null;
  vacancy_location?: string | null;
  first_name?: string | null;
  org_name?: string | null;
  org_logo_url?: string | null;
  org_email?: string | null;
  org_phone?: string | null;
};

const CandidateInterest = () => {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const isPreview = params.has('preview');
  const preselected = params.get('a') === 'nee' ? 'nee' : params.get('a') === 'ja' ? 'ja' : null;

  const [data, setData] = useState<InterestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<'ja' | 'nee' | null>(preselected);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { data: res, error: invErr } = await supabase.functions.invoke('candidate-interest', {
          body: { token, action: 'get' },
        });
        if (invErr) throw invErr;
        setData(res as InterestData);
        if ((res as InterestData)?.status === 'used') setDone((res as InterestData).response ?? null);
      } catch {
        setError('Kon het voorstel niet laden. Probeer het later opnieuw.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const respond = async (value: 'ja' | 'nee') => {
    if (!token || isPreview) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data: res, error: invErr } = await supabase.functions.invoke('candidate-interest', {
        body: { token, action: 'respond', answer: value },
      });
      if (invErr) throw invErr;
      const r = res as InterestData;
      if (r.status === 'done' || r.status === 'used') setDone(r.response ?? value);
      else if (r.status === 'expired') setData((d) => (d ? { ...d, status: 'expired' } : d));
      else setError('Kon je reactie niet verwerken. Probeer het opnieuw.');
    } catch {
      setError('Kon je reactie niet verwerken. Probeer het opnieuw.');
    } finally {
      setSubmitting(false);
    }
  };

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="p-6 sm:p-8">
          {data?.org_logo_url ? (
            <img src={data.org_logo_url} alt={data?.org_name ?? ''} className="h-10 mb-6 object-contain" />
          ) : (
            data?.org_name && <p className="mb-6 text-lg font-semibold">{data.org_name}</p>
          )}
          {children}
        </CardContent>
      </Card>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.status === 'invalid') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-10 w-10 text-orange-500" />
          <h1 className="text-lg font-semibold">Link niet geldig</h1>
          <p className="text-sm text-muted-foreground">Deze link klopt niet of is al gebruikt. Neem contact op met je recruiter.</p>
        </div>
      </Shell>
    );
  }

  if (data.status === 'expired') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-center">
          <Clock className="h-10 w-10 text-orange-500" />
          <h1 className="text-lg font-semibold">Link verlopen</h1>
          <p className="text-sm text-muted-foreground">
            Dit voorstel is verlopen. Interesse in {data.vacancy_title ?? 'de baan'}? Neem contact op
            {data.org_phone ? ` via ${data.org_phone}` : data.org_email ? ` via ${data.org_email}` : ' met je recruiter'}.
          </p>
        </div>
      </Shell>
    );
  }

  if (done) {
    const wasYes = done === 'ja';
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-center">
          {wasYes ? <CheckCircle2 className="h-10 w-10 text-green-600" /> : <XCircle className="h-10 w-10 text-muted-foreground" />}
          <h1 className="text-lg font-semibold">{wasYes ? 'Top, bedankt voor je interesse!' : 'Bedankt voor je reactie'}</h1>
          <p className="text-sm text-muted-foreground">
            {wasYes
              ? 'We nemen zo snel mogelijk contact met je op om een afspraak in te plannen.'
              : 'Geen probleem — we houden je op de hoogte zodra er een baan voorbijkomt die beter past.'}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {isPreview && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          Voorbeeldweergave — knoppen zijn uitgeschakeld en er wordt niets geregistreerd.
        </div>
      )}
      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">{data.first_name ? `Hoi ${data.first_name},` : 'Hoi,'} we hebben een baan voor je:</p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold">
            <Briefcase className="h-5 w-5 text-muted-foreground" /> {data.vacancy_title ?? 'Nieuwe baan'}
          </h1>
          {data.vacancy_location && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" /> {data.vacancy_location}
            </p>
          )}
        </div>

        <p className="text-sm">Heb je interesse? Laat het hieronder weten — dan nemen we contact met je op.</p>

        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            variant={answer === 'ja' ? 'default' : 'outline'}
            className="h-auto flex-col gap-1 py-3"
            onClick={() => setAnswer('ja')}
            disabled={isPreview || submitting}
          >
            <CheckCircle2 className="h-5 w-5" />
            Ja, ik heb interesse
          </Button>
          <Button
            size="lg"
            variant={answer === 'nee' ? 'default' : 'outline'}
            className="h-auto flex-col gap-1 py-3"
            onClick={() => setAnswer('nee')}
            disabled={isPreview || submitting}
          >
            <XCircle className="h-5 w-5" />
            Nee, niet voor mij
          </Button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button
          className="w-full"
          size="lg"
          disabled={!answer || isPreview || submitting}
          onClick={() => answer && respond(answer)}
        >
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Bevestig mijn reactie
        </Button>

        {(data.org_phone || data.org_email) && (
          <p className="text-center text-xs text-muted-foreground">
            Vragen? {data.org_phone ? `Bel ${data.org_phone}` : ''}{data.org_phone && data.org_email ? ' of ' : ''}
            {data.org_email ? `mail ${data.org_email}` : ''}.
          </p>
        )}
      </div>
    </Shell>
  );
};

export default CandidateInterest;
