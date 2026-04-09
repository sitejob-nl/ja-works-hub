import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ThumbsUp, ThumbsDown, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

type TokenData = {
  id: string;
  match_id: string;
  response: string | null;
  used_at: string | null;
  expires_at: string;
  matches: {
    candidates: { first_name: string; last_name: string } | null;
    vacancies: { title: string } | null;
  } | null;
};

const MatchResponse = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'interesse' | 'geen_interesse' | null>(null);

  useEffect(() => {
    if (!token) return;
    supabase
      .from('match_proposal_tokens')
      .select('*, matches!match_proposal_tokens_match_id_fkey(candidates!matches_candidate_id_fkey(first_name, last_name), vacancies!matches_vacancy_id_fkey(title))')
      .eq('token', token)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setError('Deze link is ongeldig of verlopen.');
        } else if (data.used_at) {
          setDone(data.response as any);
        } else if (new Date(data.expires_at) < new Date()) {
          setError('Deze link is verlopen.');
        } else {
          setData(data as any);
        }
        setLoading(false);
      });
  }, [token]);

  const respond = async (response: 'interesse' | 'geen_interesse') => {
    if (!data) return;
    setSubmitting(true);
    try {
      // Update token
      await supabase
        .from('match_proposal_tokens')
        .update({ response, used_at: new Date().toISOString() })
        .eq('id', data.id);

      // Update match status
      const newStatus = response === 'interesse' ? 'geaccepteerd' : 'afgewezen';
      await supabase
        .from('matches')
        .update({ status: newStatus as any, status_changed_at: new Date().toISOString() })
        .eq('id', data.match_id);

      setDone(response);
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

  const candidate = (data?.matches as any)?.candidates;
  const vacancy = (data?.matches as any)?.vacancies;

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
