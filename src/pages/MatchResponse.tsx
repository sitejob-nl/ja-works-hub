import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { formatDate } from '@/lib/format';
import { toWhatsAppNumber } from '@/lib/phone';
import {
  mergeProposalPageConfig,
  proposalListFromText,
  type ProposalPageConfig,
  type ProposalPageSectionKey,
} from '@/lib/proposal-page';
import {
  Award,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Download,
  FileText,
  Languages,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Play,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  UserRound,
  XCircle,
} from 'lucide-react';

type Report = { summary: string | null; strong_signals: string[]; attention_points: string[] };
type CandidateProfile = {
  summary: string | null;
  function_group: string | null;
  classification: string | null;
  target_functions: string[];
  interview_questions: string[];
  skills: string[];
  certifications: string[];
  languages: string[];
  city: string | null;
  available_from: string | null;
  available_until: string | null;
  arrival_date: string | null;
  availability_notes: string | null;
  most_recent_role: string | null;
  most_recent_role_year: number | null;
  has_drivers_license: boolean;
};
type HistoryItem = {
  id: string;
  role: string | null;
  company_name: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  location: string | null;
};
type CvInfo = { url: string; file_name: string | null; is_pdf: boolean };
type ProposalData = {
  org_logo_url: string | null;
  org_name: string | null;
  candidate: { first_name: string; last_name: string } | null;
  vacancy: { title: string } | null;
  company: { name: string } | null;
  profile: CandidateProfile | null;
  history: HistoryItem[];
  report: Report | null;
  cv_url: string | null;
  cv: CvInfo | null;
  proposal_page?: ProposalPageConfig;
  sections?: Record<string, boolean>;
  rejection_reasons: { id: string; reason: string }[];
  contact: {
    manager_name: string | null;
    manager_email: string | null;
    manager_phone: string | null;
    email_is_personal?: boolean;
    phone_is_personal?: boolean;
  };
};

type Mode = 'op_gesprek' | 'direct_starten' | 'afwijzen' | null;

const compact = (items: Array<string | null | undefined>) => items.filter((item): item is string => Boolean(item));

const initialsFor = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'K';
};

const dateRange = (start: string | null, end: string | null) => {
  if (!start && !end) return 'Periode onbekend';
  if (start && !end) return `${formatDate(start)} - heden`;
  if (!start && end) return `Tot ${formatDate(end)}`;
  return `${formatDate(start)} - ${formatDate(end)}`;
};

const statusLabel = (status: string | null) => {
  const labels: Record<string, string> = {
    actief: 'Actief',
    beeindigd: 'Beeindigd',
    concept: 'Concept',
    ingepland: 'Ingepland',
  };
  return status ? labels[status] ?? status.replaceAll('_', ' ') : null;
};

const joinDutch = (items: string[]) => {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} en ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} en ${items[items.length - 1]}`;
};

const buildSummary = (name: string, profile: CandidateProfile | null | undefined) => {
  if (profile?.summary) return profile.summary;

  const firstName = name.split(/\s+/)[0] || 'Deze kandidaat';
  const sentences: string[] = [];
  const role = profile?.most_recent_role || profile?.function_group || profile?.classification;
  const skills = profile?.skills?.slice(0, 4) ?? [];
  const certs = profile?.certifications?.slice(0, 3) ?? [];
  const languages = profile?.languages?.slice(0, 3) ?? [];

  if (role && skills.length > 0) {
    sentences.push(`${firstName} is een ${role}-profiel met ervaring in ${joinDutch(skills)}.`);
  } else if (role) {
    sentences.push(`${firstName} past binnen het profiel ${role}.`);
  } else if (skills.length > 0) {
    sentences.push(`${firstName} heeft relevante ervaring met ${joinDutch(skills)}.`);
  }

  if (certs.length > 0) sentences.push(`Bekende certificaten: ${joinDutch(certs)}.`);
  if (languages.length > 0) sentences.push(`Talen: ${joinDutch(languages)}.`);
  if (profile?.city || profile?.has_drivers_license) {
    sentences.push(compact([
      profile.city ? `regio ${profile.city}` : null,
      profile.has_drivers_license ? 'rijbewijs aanwezig' : null,
    ]).join('; ') + '.');
  }
  if (profile?.availability_notes) {
    sentences.push(profile.availability_notes.endsWith('.') ? profile.availability_notes : `${profile.availability_notes}.`);
  } else if (profile?.available_from) {
    sentences.push(`Beschikbaar vanaf ${formatDate(profile.available_from)}.`);
  }

  return sentences.join(' ');
};

const TagList = ({ items, empty }: { items: string[]; empty: string }) => {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.slice(0, 10).map((item) => (
        <Badge key={item} variant="secondary" className="rounded-md px-2 py-1 text-xs font-medium">
          {item}
        </Badge>
      ))}
      {items.length > 10 && <Badge variant="outline" className="rounded-md px-2 py-1 text-xs">+{items.length - 10}</Badge>}
    </div>
  );
};

const MatchResponse = () => {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const isPreview = new URLSearchParams(location.search).has('preview');
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
    if (isPreview) return;
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
          interview_proposed_at: decision === 'op_gesprek' ? new Date(interviewDate).toISOString() : undefined,
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
    const doneText = done === 'op_gesprek'
      ? 'Uw afspraakvoorstel is ontvangen. De recruiter bevestigt datum, tijd en locatie persoonlijk; de afspraak is nog niet definitief.'
      : done === 'direct_starten'
        ? 'Uw akkoord is verwerkt. Wij zetten de plaatsing intern klaar en nemen contact op over de definitieve start.'
        : positive
          ? 'Wij nemen zo spoedig mogelijk contact met u op om de volgende stappen te bespreken.'
          : 'Uw reactie is verwerkt. Wij houden u op de hoogte van andere kandidaten.';
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Bedankt voor uw reactie!</h2>
            <p className="text-muted-foreground">
              {doneText}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const candidate = data?.candidate;
  const vacancy = data?.vacancy;
  const report = data?.report;
  const profile = data?.profile;
  const history = data?.history ?? [];
  const cv = data?.cv ?? (data?.cv_url ? { url: data.cv_url, file_name: 'CV', is_pdf: true } : null);
  const candidateName = `${candidate?.first_name ?? ''} ${candidate?.last_name ?? ''}`.trim();
  const managerName = data?.contact?.manager_name;
  const managerEmail = data?.contact?.manager_email;
  const managerPhone = data?.contact?.manager_phone;
  const waPhone = toWhatsAppNumber(managerPhone);
  // Een accountmanager zonder eigen nummer (of mailadres) valt terug op de algemene
  // organisatielijn. Dat kanaal krijgt het label "algemeen", zodat het niet leest als
  // de directe lijn van de hierboven genoemde persoon. Vlaggen ontbreken bij een oude
  // edge-function-versie; dan tonen we het label niet (geen valse belofte, geen ruis).
  const emailIsGeneral = Boolean(managerName) && data?.contact?.email_is_personal === false;
  const phoneIsGeneral = Boolean(managerName) && data?.contact?.phone_is_personal === false;
  const proposalPage = mergeProposalPageConfig(
    data?.proposal_page && Object.keys(data.proposal_page).length > 0
      ? data.proposal_page
      : { sections: data?.sections },
  );
  const pageContent = (key: ProposalPageSectionKey) => proposalPage.content[key];
  const sectionBody = (key: ProposalPageSectionKey) => pageContent(key).body.trim();
  const sectionItems = (key: ProposalPageSectionKey, fallback: string[]) => {
    const edited = proposalListFromText(sectionBody(key));
    return edited.length > 0 ? edited : fallback;
  };
  const showSection = (key: ProposalPageSectionKey) => proposalPage.sections[key] !== false;
  const summary = sectionBody('summary') || report?.summary || buildSummary(candidateName, profile);
  const positiveSignals = sectionItems('positiveSignals', report?.strong_signals ?? []);
  const riskFactors = sectionItems('riskFactors', report?.attention_points ?? []);
  const orgName = data?.org_name || 'JA Werkt';
  const hasReportContent = Boolean(
    (showSection('positiveSignals') && positiveSignals.length > 0) ||
    (showSection('riskFactors') && riskFactors.length > 0)
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-5">
          <div className="flex min-w-0 items-center gap-3">
            {data?.org_logo_url ? (
              <img src={data.org_logo_url} alt={orgName} className="max-h-12 max-w-44 object-contain" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">
                {initialsFor(orgName)}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{orgName}</div>
              <div className="truncate text-xs text-muted-foreground">{proposalPage.title}</div>
            </div>
          </div>
          {data?.company?.name && (
            <div className="hidden text-right text-sm sm:block">
              <div className="text-muted-foreground">Voor opdrachtgever</div>
              <div className="font-medium text-slate-900">{data.company.name}</div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-white">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <CardTitle className="text-2xl">{proposalPage.title}</CardTitle>
                <CardDescription className="mt-1">
                  {proposalPage.intro}
                </CardDescription>
              </div>
              {vacancy && (
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm lg:max-w-xs">
                  <div className="text-xs text-muted-foreground">Functie</div>
                  <div className="font-medium text-slate-900">{vacancy.title}</div>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
              <div className="space-y-8 p-5 sm:p-6">
                <section className="rounded-md border bg-slate-50 p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-white text-xl font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200">
                      {initialsFor(candidateName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-muted-foreground">Kandidaat</div>
                      <h1 className="break-words text-2xl font-semibold text-slate-950">{candidateName}</h1>
                    </div>
                  </div>
                </section>

                {showSection('summary') && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-slate-500" />
                    <h2 className="text-base font-semibold">{pageContent('summary').title}</h2>
                  </div>
                  {summary ? (
                    <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{summary}</p>
                  ) : (
                    <p className="text-sm leading-6 text-muted-foreground">
                      Er is nog geen uitgebreide samenvatting beschikbaar. Bekijk de profielgegevens en werkhistorie hieronder.
                    </p>
                  )}
                </section>
                )}

                <section className="grid gap-5 sm:grid-cols-2">
                  {showSection('skills') && <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <BriefcaseBusiness className="h-4 w-4 text-slate-500" />
                      <h2 className="text-base font-semibold">{pageContent('skills').title}</h2>
                    </div>
                    <TagList items={sectionItems('skills', profile?.skills ?? [])} empty="Nog geen vaardigheden vastgelegd." />
                  </div>}
                  {showSection('certifications') && <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Award className="h-4 w-4 text-slate-500" />
                      <h2 className="text-base font-semibold">{pageContent('certifications').title}</h2>
                    </div>
                    <TagList items={sectionItems('certifications', profile?.certifications ?? [])} empty="Nog geen certificaten vastgelegd." />
                  </div>}
                  {showSection('languages') && <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Languages className="h-4 w-4 text-slate-500" />
                      <h2 className="text-base font-semibold">{pageContent('languages').title}</h2>
                    </div>
                    <TagList items={sectionItems('languages', profile?.languages ?? [])} empty="Nog geen talen vastgelegd." />
                  </div>}
                  {showSection('targetFunctions') && <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <UserRound className="h-4 w-4 text-slate-500" />
                      <h2 className="text-base font-semibold">{pageContent('targetFunctions').title}</h2>
                    </div>
                    <TagList items={sectionItems('targetFunctions', profile?.target_functions ?? [])} empty="Nog geen passende functies vastgelegd." />
                  </div>}
                </section>

                {showSection('availability') && (sectionBody('availability') || profile?.availability_notes || profile?.available_from || profile?.available_until || profile?.arrival_date || profile?.city) && (
                  <section className="rounded-md border p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-slate-500" />
                      <h2 className="text-base font-semibold">{pageContent('availability').title}</h2>
                    </div>
                    {sectionBody('availability') ? (
                      <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{sectionBody('availability')}</p>
                    ) : (
                      <>
                        <div className="grid gap-3 text-sm sm:grid-cols-2">
                          {profile?.city && (
                            <div className="flex items-start gap-2">
                              <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                              <div>
                                <div className="text-muted-foreground">Regio</div>
                                <div className="font-medium">{profile.city}</div>
                              </div>
                            </div>
                          )}
                          {profile?.available_from && (
                            <div>
                              <div className="text-muted-foreground">Beschikbaar vanaf</div>
                              <div className="font-medium">{formatDate(profile.available_from)}</div>
                            </div>
                          )}
                          {profile?.available_until && (
                            <div>
                              <div className="text-muted-foreground">Beschikbaar tot</div>
                              <div className="font-medium">{formatDate(profile.available_until)}</div>
                            </div>
                          )}
                          {profile?.arrival_date && (
                            <div>
                              <div className="text-muted-foreground">Aankomst/check-in</div>
                              <div className="font-medium">{formatDate(profile.arrival_date)}</div>
                            </div>
                          )}
                        </div>
                        {profile?.availability_notes && (
                          <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">{profile.availability_notes}</p>
                        )}
                      </>
                    )}
                  </section>
                )}

                {hasReportContent && (
                  <section className="space-y-4">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-slate-500" />
                      <h2 className="text-base font-semibold">Beoordeling</h2>
                    </div>
                    {showSection('positiveSignals') && positiveSignals.length > 0 && (
                      <div>
                        <div className="mb-1 text-sm font-semibold">{pageContent('positiveSignals').title}</div>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                          {positiveSignals.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {showSection('riskFactors') && riskFactors.length > 0 && (
                      <div>
                        <div className="mb-1 text-sm font-semibold">{pageContent('riskFactors').title}</div>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                          {riskFactors.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                  </section>
                )}

                {showSection('history') && <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <BriefcaseBusiness className="h-4 w-4 text-slate-500" />
                    <h2 className="text-base font-semibold">{pageContent('history').title}</h2>
                  </div>
                  {sectionBody('history') && <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{sectionBody('history')}</p>}
                  {history.length > 0 ? (
                    <div className="divide-y rounded-md border">
                      {history.map((item) => (
                        <div key={item.id} className="p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="font-medium text-slate-900">{item.role || 'Functie onbekend'}</div>
                              <div className="text-sm text-muted-foreground">
                                {compact([item.company_name, item.location]).join(' · ') || 'Opdrachtgever onbekend'}
                              </div>
                            </div>
                            <div className="text-sm text-muted-foreground sm:text-right">
                              <div>{dateRange(item.start_date, item.end_date)}</div>
                              {statusLabel(item.status) && <div>{statusLabel(item.status)}</div>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : profile?.most_recent_role ? (
                    <div className="rounded-md border p-4 text-sm">
                      <div className="font-medium">{profile.most_recent_role}</div>
                      {profile.most_recent_role_year && <div className="text-muted-foreground">{profile.most_recent_role_year}</div>}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Er is nog geen werkhistorie beschikbaar.</p>
                  )}
                </section>}

                {showSection('cv') && <section className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-slate-500" />
                      <h2 className="text-base font-semibold">{pageContent('cv').title}</h2>
                    </div>
                    {cv?.url && (
                      <a href={cv.url} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="gap-2">
                          <Download className="h-4 w-4" /> Downloaden
                        </Button>
                      </a>
                    )}
                  </div>
                  {sectionBody('cv') && <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{sectionBody('cv')}</p>}
                  {cv?.url ? (
                    cv.is_pdf ? (
                      <embed src={cv.url} type="application/pdf" className="h-[560px] w-full rounded-md border bg-white" />
                    ) : (
                      <div className="rounded-md border p-4 text-sm text-muted-foreground">
                        Het CV is beschikbaar als download, maar kan niet inline worden getoond omdat het geen PDF is.
                      </div>
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">Er is geen openbaar CV-bestand beschikbaar voor dit voorstel.</p>
                  )}
                </section>}
              </div>

              <aside className="border-t bg-white p-5 sm:p-6 lg:border-l lg:border-t-0">
                <div className="lg:sticky lg:top-6">
                  {isPreview && (
                    <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
                      <strong className="block">Voorbeeldmodus</strong>
                      U kunt de reactiestappen bekijken, maar niets bevestigen of versturen.
                    </div>
                  )}
                  <div className="mb-4">
                    <div className="text-sm font-semibold text-slate-900">Reactie opdrachtgever</div>
                    <p className="mt-1 text-sm text-muted-foreground">Kies de gewenste vervolgstap voor deze kandidaat.</p>
                  </div>

                  {mode === null && (
                    <div className="grid grid-cols-1 gap-3">
                      <Button className="h-12 bg-emerald-600 hover:bg-emerald-700" onClick={() => setMode('direct_starten')} disabled={submitting}>
                        <Play className="h-5 w-5 mr-2" /> Goedkeuren / direct starten
                      </Button>
                      <Button variant="outline" className="h-12" onClick={() => setMode('op_gesprek')} disabled={submitting}>
                        <CalendarClock className="h-5 w-5 mr-2" /> Afspraak voorstellen
                      </Button>
                      <Button variant="outline" className="h-12 border-red-200 hover:bg-red-50 hover:text-red-700" onClick={() => setMode('afwijzen')} disabled={submitting}>
                        <ThumbsDown className="h-5 w-5 mr-2" /> Afwijzen
                      </Button>
                    </div>
                  )}

                  {mode === 'direct_starten' && (
                    <div className="space-y-3 rounded-md border p-4">
                      <Label htmlFor="startDate">Gewenste startdatum</Label>
                      <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                      <Textarea placeholder="Opmerking (optioneel)" value={note} onChange={(e) => setNote(e.target.value)} />
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setMode(null)} disabled={submitting}>Terug</Button>
                        <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => submit('direct_starten')} disabled={submitting || !startDate || isPreview}>
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Bevestig'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {mode === 'op_gesprek' && (
                    <div className="space-y-3 rounded-md border p-4">
                      <div>
                        <Label htmlFor="interviewDate">Voorgestelde datum &amp; tijd</Label>
                        <Input id="interviewDate" type="datetime-local" step={900} value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} />
                        <p className="mt-1 text-xs text-muted-foreground">Dit is een voorstel. De recruiter bevestigt de definitieve afspraak met u en de kandidaat.</p>
                      </div>
                      <Textarea placeholder="Opmerking of voorkeurslocatie (optioneel)" value={note} onChange={(e) => setNote(e.target.value)} />
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setMode(null)} disabled={submitting}>Terug</Button>
                        <Button className="flex-1" onClick={() => submit('op_gesprek')} disabled={submitting || !interviewDate || isPreview}>
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Datum voorstellen'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {mode === 'afwijzen' && (
                    <div className="space-y-3 rounded-md border p-4">
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
                        <Button variant="destructive" className="flex-1" onClick={() => submit('afwijzen')} disabled={submitting || !reasonId || isPreview}>
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Afwijzen'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {showSection('contact') && (managerEmail || waPhone) && (
                    <>
                      <Separator className="my-5" />
                      <div>
                        <div className="mb-1 text-sm font-medium text-slate-900">{pageContent('contact').title}</div>
                        {managerName && (
                          <p className="mb-2 text-sm text-slate-700">
                            Uw contactpersoon voor dit voorstel is <span className="font-medium text-slate-900">{managerName}</span>.
                          </p>
                        )}
                        {sectionBody('contact') && <p className="mb-3 whitespace-pre-line text-xs leading-5 text-muted-foreground">{sectionBody('contact')}</p>}
                        <div className="flex flex-wrap gap-2">
                          {managerEmail && !isPreview && (
                            <a href={`mailto:${managerEmail}?subject=${encodeURIComponent(`Vraag over voorstel: ${candidateName}`)}`}>
                              <Button variant="outline" size="sm"><Mail className="h-4 w-4 mr-2" /> {emailIsGeneral ? 'Mail (algemeen)' : 'Mail'}</Button>
                            </a>
                          )}
                          {waPhone && !isPreview && (
                            <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(`Vraag over voorstel: ${candidateName}`)}`} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm"><MessageCircle className="h-4 w-4 mr-2" /> {phoneIsGeneral ? 'WhatsApp (algemeen)' : 'WhatsApp'}</Button>
                            </a>
                          )}
                          {isPreview && <Button variant="outline" size="sm" disabled>Contactknoppen uitgeschakeld</Button>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </aside>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default MatchResponse;
