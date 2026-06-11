import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ThumbsUp, ThumbsDown, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

type ProposalView = {
  candidate: { first_name: string; last_name: string } | null;
  vacancy: { title: string } | null;
};

const MatchResponse = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ProposalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'interesse' | 'geen_interesse' | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data: res, error: invErr } = await supabase.functions.invoke('match-response', {
        body: { token, action: 'get' },
      });
      if (invErr || !res || res.error || res.status === 'invalid' || res.status === 'expired') {
        setError('Deze link is ongeldig of verlopen.');
      } else if (res.status === 'used') {
        setDone((res.response as any) ?? 'interesse');
      } else {
        setData({ candidate: res.candidate ?? null, vacancy: res.vacancy ?? null });
      }
      setLoading(false);
    })();
  }, [token]);

  const respond = async (response: 'interesse' | 'geen_interesse') => {
    if (!token) return;
    setSubmitting(true);
    try {
      const { data: res, error: invErr } = await supabase.functions.invoke('match-response', {
        body: { token, action: 'respond', response },
      });
      if (invErr || !res || res.error) {
        setError('Er is een fout opgetreden. Probeer het opnieuw.');
      } else if (res.status === 'expired') {
        setError('Deze link is verlopen.');
      } else if (res.status === 'used') {
        // Al eerder beantwoord — toon de vastgelegde reactie.
        setDone((res.response as any) ?? response);
      } else {
        setDone(response);
      }
    } catch {
      setError('Er is een fout opgetreden. Probeer het opnieuw.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Bedankt voor uw reactie!</h2>
            <p className="text-muted-foreground">
              {done === 'interesse'
                ? 'Wij nemen zo spoedig mogelijk contact met u op om de volgende stappen te bespreken.'
                : 'Uw reactie is verwerkt. Wij houden u op de hoogte van andere kandidaten.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const candidate = data?.candidate;
  const vacancy = data?.vacancy;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <CardTitle>Kandidaat voorstel</CardTitle>
          <CardDescription>
            Wij stellen de volgende kandidaat voor
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted rounded-lg p-4 space-y-2">
            <div className="text-sm text-muted-foreground">Kandidaat</div>
            <div className="text-lg font-semibold">{candidate?.first_name} {candidate?.last_name}</div>
            {vacancy && (
              <>
                <div className="text-sm text-muted-foreground mt-3">Voor de functie</div>
                <div className="font-medium">{vacancy.title}</div>
              </>
            )}
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 h-14 border-red-200 hover:bg-red-50 hover:text-red-700"
              onClick={() => respond('geen_interesse')}
              disabled={submitting}
            >
              <ThumbsDown className="h-5 w-5 mr-2" />
              Geen interesse
            </Button>
            <Button
              className="flex-1 h-14 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => respond('interesse')}
              disabled={submitting}
            >
              <ThumbsUp className="h-5 w-5 mr-2" />
              Interesse
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MatchResponse;
