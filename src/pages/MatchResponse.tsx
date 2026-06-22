import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CheckCircle2, XCircle, Loader2, CalendarClock, Play, ThumbsDown, FileText, Mail, MessageCircle,
} from 'lucide-react';

type Report = { summary: string | null; strong_signals: string[]; attention_points: string[] };
type ProposalData = {
  org_logo_url: string | null;
  org_name: string | null;
  candidate: { first_name: string; last_name: string } | null;
  vacancy: { title: string } | null;
  company: { name: string } | null;
  report: Report | null;
  cv_url: string | null;
  rejection_reasons: { id: string; reason: string }[];
  contact: { manager_email: string | null; manager_phone: string | null };
};

type Mode = 'op_gesprek' | 'direct_starten' | 'afwijzen' | null;

const MatchResponse = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>(null);
  const [interviewDate, setInterviewDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data: res, error: invErr } = await supabase.functions.invoke('match-response', {
        body: { token, action: 'get' },
      });
      if (invErr || !res || res.error || res.status === 'invalid' || res.status === 'expired') {
        setError('Deze link is ongeldig of verlopen.');
      } else if (res.status === 'used') {
        setDone(res.response ?? 'verwerkt');
      } else {
        setData(res as ProposalData);
      }
      setLoading(false);
    })();
  }, [token]);

  const submit = async (decision: Exclude<Mode, null>) => {
    if (!token) return;
    if (decision === 'op_gesprek' && !interviewDate) return;
    if (decision === 'direct_starten' && !startDate) return;
    if (decision === 'afwijzen' && !reasonId) return;
    setSubmitting(true);
    try {
      const { data: res, error: invErr } = await supabase.functions.invoke('match-response', {
        body: {
          token,
          action: 'respond',
          decision,
          interview_date: decision === 'op_gesprek' ? new Date(interviewDate).toISOString() : undefined,
          desired_start_date: decision === 'direct_starten' ? startDate : undefined,
          rejection_reason_id: decision === 'afwijzen' ? reasonId : undefined,
          note: note || undefined,
        },
      });
      if (invErr || !res || res.error) setError('Er is een fout opgetreden. Probeer het opnieuw.');
      else if (res.status === 'expired') setError('Deze link is verlopen.');
      else if (res.status === 'used') setDone(res.response ?? decision);
      else setDone(decision);
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
    const positive = done === 'op_gesprek' || done === 'direct_starten' || done === 'interesse';
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Bedankt voor uw reactie!</h2>
            <p className="text-muted-foreground">
              {positive
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
  const report = data?.report;
  const candidateName = `${candidate?.first_name ?? ''} ${candidate?.last_name ?? ''}`.trim();
  const managerEmail = data?.contact?.manager_email;
  const managerPhone = data?.contact?.manager_phone;
  const waPhone = managerPhone ? managerPhone.replace(/[^0-9]/g, '') : null;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {data?.org_logo_url && (
          <div className="flex justify-center">
            <img src={data.org_logo_url} alt={data.org_name ?? ''} className="max-h-12 object-contain" />
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Kandidaatvoorstel</CardTitle>
            <CardDescription>
              {data?.company?.name ? `Voor ${data.company.name}` : 'Wij stellen de volgende kandidaat aan u voor'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted rounded-lg p-4">
              <div className="text-sm text-muted-foreground">Kandidaat</div>
              <div className="text-lg font-semibold">{candidateName}</div>
              {vacancy && (
                <>
                  <div className="text-sm text-muted-foreground mt-3">Voor de functie</div>
                  <div className="font-medium">{vacancy.title}</div>
                </>
              )}
            </div>

            {report && (report.summary || report.strong_signals.length || report.attention_points.length) && (
              <div className="space-y-4">
                {report.summary && (
                  <div>
                    <div className="text-sm font-semibold mb-1">Samenvatting</div>
                    <p className="text-sm text-muted-foreground whitespace-pre-line">{report.summary}</p>
                  </div>
                )}
                {report.strong_signals.length > 0 && (
                  <div>
                    <div className="text-sm font-semibold mb-1">Sterke punten</div>
                    <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                      {report.strong_signals.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
                {report.attention_points.length > 0 && (
                  <div>
                    <div className="text-sm font-semibold mb-1">Aandachtspunten</div>
                    <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                      {report.attention_points.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {data?.cv_url && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> CV</div>
                  <a href={data.cv_url} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm">Downloaden</Button>
                  </a>
                </div>
                <embed src={data.cv_url} type="application/pdf" className="w-full h-80 rounded border" />
              </div>
            )}

            {/* Acties */}
            {mode === null && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Button className="h-14 bg-emerald-600 hover:bg-emerald-700" onClick={() => setMode('direct_starten')} disabled={submitting}>
                  <Play className="h-5 w-5 mr-2" /> Direct starten
                </Button>
                <Button variant="outline" className="h-14" onClick={() => setMode('op_gesprek')} disabled={submitting}>
                  <CalendarClock className="h-5 w-5 mr-2" /> Op gesprek
                </Button>
                <Button variant="outline" className="h-14 border-red-200 hover:bg-red-50 hover:text-red-700" onClick={() => setMode('afwijzen')} disabled={submitting}>
                  <ThumbsDown className="h-5 w-5 mr-2" /> Afwijzen
                </Button>
              </div>
            )}

            {mode === 'direct_starten' && (
              <div className="space-y-3 border rounded-lg p-4">
                <Label htmlFor="startDate">Gewenste startdatum</Label>
                <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <Textarea placeholder="Opmerking (optioneel)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setMode(null)} disabled={submitting}>Terug</Button>
                  <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => submit('direct_starten')} disabled={submitting || !startDate}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Bevestig — direct starten'}
                  </Button>
                </div>
              </div>
            )}

            {mode === 'op_gesprek' && (
              <div className="space-y-3 border rounded-lg p-4">
                <Label htmlFor="interviewDate">Datum &amp; tijd gesprek</Label>
                <Input id="interviewDate" type="datetime-local" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} />
                <Textarea placeholder="Opmerking (optioneel)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setMode(null)} disabled={submitting}>Terug</Button>
                  <Button className="flex-1" onClick={() => submit('op_gesprek')} disabled={submitting || !interviewDate}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Bevestig — op gesprek'}
                  </Button>
                </div>
              </div>
            )}

            {mode === 'afwijzen' && (
              <div className="space-y-3 border rounded-lg p-4">
                <Label>Reden van afwijzing</Label>
                <Select value={reasonId} onValueChange={setReasonId}>
                  <SelectTrigger><SelectValue placeholder="Kies een reden" /></SelectTrigger>
                  <SelectContent>
                    {(data?.rejection_reasons ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.reason}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea placeholder="Toelichting (optioneel)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setMode(null)} disabled={submitting}>Terug</Button>
                  <Button variant="destructive" className="flex-1" onClick={() => submit('afwijzen')} disabled={submitting || !reasonId}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Afwijzen'}
                  </Button>
                </div>
              </div>
            )}

            {/* Vraag stellen */}
            {(managerEmail || waPhone) && (
              <div className="border-t pt-4">
                <div className="text-sm text-muted-foreground mb-2">Een vraag over deze kandidaat?</div>
                <div className="flex gap-2">
                  {managerEmail && (
                    <a href={`mailto:${managerEmail}?subject=${encodeURIComponent(`Vraag over voorstel: ${candidateName}`)}`}>
                      <Button variant="outline" size="sm"><Mail className="h-4 w-4 mr-2" /> Mail</Button>
                    </a>
                  )}
                  {waPhone && (
                    <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(`Vraag over voorstel: ${candidateName}`)}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm"><MessageCircle className="h-4 w-4 mr-2" /> WhatsApp</Button>
                    </a>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default MatchResponse;
