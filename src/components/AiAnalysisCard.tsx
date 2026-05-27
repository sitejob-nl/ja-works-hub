import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AlertTriangle, Briefcase, Target, Clock, MessageSquare, User, TrendingUp, Star, FileText } from 'lucide-react';
import WorkHistoryTimeline from '@/components/candidates/WorkHistoryTimeline';

interface AiAnalysis {
  werkhistorie?: {
    werkgevers?: Array<{ bedrijf: string; functie: string; periode: string; duur_maanden: number; kernactiviteiten?: string[] }>;
    gaten?: Array<{ periode: string; duur_maanden: number; mogelijke_verklaring: string }>;
    patroon?: string;
    totale_werkervaring_jaren?: number;
  };
  competenties?: {
    hard_skills?: string[];
    soft_skills?: string[];
    certificaten?: Array<string | { naam: string; relevant?: boolean; toelichting?: string }>;
    talen?: Array<{ taal: string; niveau: string }>;
  };
  opleidingen?: Array<{ naam: string; instelling: string; periode: string; niveau: string }>;
  eigenschappen?: {
    gemiddelde_dienstverband_maanden?: number;
    type?: string;
    specialisatie?: string;
    groei?: string;
    flexibiliteit?: string;
    toelichting?: string;
  };
  doelgroep?: {
    functies?: string[];
    branches?: string[];
    niveau?: string;
    type_opdrachtgever?: string;
    toelichting?: string;
  };
  plaatsingsadvies?: {
    termijn?: string;
    onderbouwing?: string;
    risicos?: string[];
    interviewvragen?: string[];
  };
  samenvatting?: {
    profiel?: string;
    plaatsbaarheid_score?: number;
    topkwaliteit?: string;
    aandachtspunt?: string;
  };
}

const ScoreBadge = ({ score }: { score: number }) => {
  const color = score >= 7 ? 'bg-stat-green/10 text-stat-green' : score >= 4 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600';
  return <Badge className={`${color} border-0 text-lg px-3 py-1`}>{score}/10</Badge>;
};

const PatroonBadge = ({ patroon }: { patroon: string }) => {
  const colors: Record<string, string> = {
    oplopend: 'bg-stat-green/10 text-stat-green',
    stabiel: 'bg-blue-100 text-blue-700',
    dalend: 'bg-red-100 text-red-600',
    wisselend: 'bg-orange-100 text-orange-600',
  };
  return <Badge className={`${colors[patroon] || 'bg-muted text-muted-foreground'} border-0`}>{patroon}</Badge>;
};

const Section = ({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) => (
  <Card className="p-5 space-y-3">
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="font-medium text-sm">{title}</h3>
    </div>
    {children}
  </Card>
);

const AiAnalysisCard = ({ analysis }: { analysis: AiAnalysis }) => {
  if (!analysis) return null;

  return (
    <div className="space-y-4">
      {/* Samenvatting bovenaan */}
      {analysis.samenvatting && (
        <Card className="p-5 space-y-3 border-l-4 border-l-primary">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-primary" />
              <h3 className="font-medium">AI Samenvatting</h3>
            </div>
            {analysis.samenvatting.plaatsbaarheid_score != null && (
              <ScoreBadge score={analysis.samenvatting.plaatsbaarheid_score} />
            )}
          </div>
          {analysis.samenvatting.profiel && (
            <p className="text-sm leading-relaxed">{analysis.samenvatting.profiel}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {analysis.samenvatting.topkwaliteit && (
              <div className="bg-stat-green/5 rounded-md p-3">
                <p className="text-xs text-muted-foreground mb-1">Topkwaliteit</p>
                <p className="text-sm font-medium text-stat-green">{analysis.samenvatting.topkwaliteit}</p>
              </div>
            )}
            {analysis.samenvatting.aandachtspunt && (
              <div className="bg-orange-50 rounded-md p-3">
                <p className="text-xs text-muted-foreground mb-1">Aandachtspunt</p>
                <p className="text-sm font-medium text-orange-600">{analysis.samenvatting.aandachtspunt}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Classificatie badges */}
      {(analysis.doelgroep?.functies?.length || analysis.eigenschappen) && (
        <div className="flex flex-wrap gap-2">
          {analysis.eigenschappen?.specialisatie && (
            <Badge className={analysis.eigenschappen.specialisatie === 'specialist' ? 'bg-blue-100 text-blue-800 hover:bg-blue-100' : 'bg-green-100 text-green-800 hover:bg-green-100'}>
              {analysis.eigenschappen.specialisatie === 'specialist' ? 'Specialist' : 'Productiekracht'}
            </Badge>
          )}
          {analysis.doelgroep?.functies?.map((f, i) => (
            <Badge key={i} variant="outline">{f}</Badge>
          ))}
          {analysis.doelgroep?.niveau && (
            <Badge variant="secondary">{analysis.doelgroep.niveau}</Badge>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Werkhistorie */}
        {analysis.werkhistorie && (
          <Section icon={Briefcase} title="Werkhistorie">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Totaal:</span>
              <span className="font-medium">{analysis.werkhistorie.totale_werkervaring_jaren} jaar</span>
              {analysis.werkhistorie.patroon && <PatroonBadge patroon={analysis.werkhistorie.patroon} />}
            </div>
            <WorkHistoryTimeline
              werkgevers={analysis.werkhistorie.werkgevers}
              gaten={analysis.werkhistorie.gaten}
              totaleJaren={analysis.werkhistorie.totale_werkervaring_jaren}
            />
            <div className="space-y-2">
              {analysis.werkhistorie.werkgevers?.map((w, i) => (
                <div key={i} className="text-sm border-l-2 border-muted pl-3 py-1">
                  <p className="font-medium">{w.functie}</p>
                  <p className="text-muted-foreground">{w.bedrijf} — {w.periode}</p>
                  <p className="text-xs text-muted-foreground">{w.duur_maanden} maanden</p>
                </div>
              ))}
            </div>
            {analysis.werkhistorie.gaten && analysis.werkhistorie.gaten.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs font-medium text-orange-600 mb-1">Gaten in CV</p>
                {analysis.werkhistorie.gaten.map((g, i) => (
                  <div key={i} className="text-sm text-orange-600 bg-orange-50 rounded px-2 py-1 mb-1">
                    {g.periode} ({g.duur_maanden} mnd) — {g.mogelijke_verklaring}
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Eigenschappen */}
        {analysis.eigenschappen && (
          <Section icon={User} title="Eigenschappen">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{analysis.eigenschappen.type}</Badge>
              <Badge variant="outline">{analysis.eigenschappen.specialisatie}</Badge>
              <Badge variant="outline">{analysis.eigenschappen.groei}</Badge>
              <Badge variant="outline">{analysis.eigenschappen.flexibiliteit}</Badge>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Gem. dienstverband: </span>
              <span className="font-medium">{analysis.eigenschappen.gemiddelde_dienstverband_maanden} maanden</span>
            </div>
            {analysis.eigenschappen.toelichting && (
              <p className="text-sm text-muted-foreground">{analysis.eigenschappen.toelichting}</p>
            )}
          </Section>
        )}

        {/* Competenties */}
        {analysis.competenties && (
          <Section icon={TrendingUp} title="Competenties">
            {analysis.competenties.hard_skills && analysis.competenties.hard_skills.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Hard skills</p>
                <div className="flex flex-wrap gap-1">
                  {analysis.competenties.hard_skills.map((s, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
            {analysis.competenties.soft_skills && analysis.competenties.soft_skills.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Soft skills</p>
                <div className="flex flex-wrap gap-1">
                  {analysis.competenties.soft_skills.map((s, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
            {analysis.competenties.certificaten && analysis.competenties.certificaten.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Certificaten</p>
                {analysis.competenties.certificaten.map((cert, i) => {
                  const c = typeof cert === 'string' ? { naam: cert, relevant: true } : cert;
                  return (
                    <div key={i} className="text-sm flex items-center gap-2">
                      <Badge variant={c.relevant ? 'default' : 'outline'} className={`text-xs ${c.relevant ? 'bg-stat-green/10 text-stat-green border-0' : ''}`}>
                        {c.relevant ? 'Relevant' : 'Beperkt'}
                      </Badge>
                      <span>{c.naam}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {analysis.competenties.talen && analysis.competenties.talen.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Talen</p>
                <div className="flex flex-wrap gap-1">
                  {analysis.competenties.talen.map((t, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {t.taal}{t.niveau ? ` - ${t.niveau}` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {analysis.opleidingen && analysis.opleidingen.length > 0 && (
          <Section icon={FileText} title="Opleidingen">
            <div className="space-y-2">
              {analysis.opleidingen.map((opleiding, i) => (
                <div key={i} className="text-sm border-l-2 border-muted pl-3 py-1">
                  <p className="font-medium">{opleiding.naam}</p>
                  <p className="text-muted-foreground">
                    {[opleiding.instelling, opleiding.niveau, opleiding.periode].filter(Boolean).join(' - ')}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Doelgroep */}
        {analysis.doelgroep && (
          <Section icon={Target} title="Doelgroep">
            <div className="space-y-2 text-sm">
              {analysis.doelgroep.functies && analysis.doelgroep.functies.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Functies: </span>
                  <span>{analysis.doelgroep.functies.join(', ')}</span>
                </div>
              )}
              {analysis.doelgroep.branches && analysis.doelgroep.branches.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Branches: </span>
                  <span>{analysis.doelgroep.branches.join(', ')}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Niveau: </span>
                <Badge variant="outline">{analysis.doelgroep.niveau}</Badge>
              </div>
              {analysis.doelgroep.type_opdrachtgever && (
                <div>
                  <span className="text-muted-foreground">Type opdrachtgever: </span>
                  <span>{analysis.doelgroep.type_opdrachtgever}</span>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Plaatsingsadvies - full width */}
        {analysis.plaatsingsadvies && (
          <div className="md:col-span-2">
            <Section icon={Clock} title="Plaatsingsadvies">
              <div className="flex items-center gap-2">
                <Badge className={`border-0 ${analysis.plaatsingsadvies.termijn === 'lang' ? 'bg-stat-green/10 text-stat-green' : 'bg-orange-100 text-orange-600'}`}>
                  {analysis.plaatsingsadvies.termijn === 'lang' ? 'Lange termijn' : 'Korte termijn'}
                </Badge>
              </div>
              {analysis.plaatsingsadvies.onderbouwing && (
                <p className="text-sm">{analysis.plaatsingsadvies.onderbouwing}</p>
              )}
              {analysis.plaatsingsadvies.risicos && analysis.plaatsingsadvies.risicos.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-orange-600 mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Risico's
                  </p>
                  <div className="space-y-1">
                    {analysis.plaatsingsadvies.risicos.map((r, i) => (
                      <p key={i} className="text-sm text-orange-600 bg-orange-50 rounded px-2 py-1">{r}</p>
                    ))}
                  </div>
                </div>
              )}
              {analysis.plaatsingsadvies.interviewvragen && analysis.plaatsingsadvies.interviewvragen.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1 flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" /> Interviewvragen
                  </p>
                  <ol className="space-y-1 list-decimal list-inside">
                    {analysis.plaatsingsadvies.interviewvragen.map((v, i) => (
                      <li key={i} className="text-sm">{v}</li>
                    ))}
                  </ol>
                </div>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
};

export default AiAnalysisCard;
