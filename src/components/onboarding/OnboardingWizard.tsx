import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Users, Briefcase, Building2, Home, Clock, Car, Calendar,
  MessageSquare, BookOpen, FileText, Mail, Palette, Upload, Globe,
  LayoutDashboard, ClipboardList, CheckSquare, BarChart2, Rocket,
  ChevronRight, ChevronLeft, Check, Sparkles, FolderHeart, Link2,
  UserRound, GitCompareArrows, Target, Send, UserCheck, Calculator,
  Fuel, TrendingUp, KeyRound, Gauge, Megaphone, Smartphone, Puzzle,
  Settings, Flag, ArrowRight,
} from 'lucide-react';

interface OnboardingWizardProps {
  open: boolean;
  onComplete: () => void;
  userName: string;
}

interface StepFeature {
  icon: React.ElementType;
  label: string;
  desc: string;
}

interface Step {
  /** Korte naam in de zijbalk van de wizard */
  navLabel: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  features: StepFeature[];
  /** Optionele deep-link: sluit de tour en navigeert direct naar de module */
  link?: { label: string; to: string };
}

/** Module-overzicht op de welkomststap: de plattegrond van het platform. */
const MODULE_MAP = [
  { icon: Users, label: 'Kandidaten' },
  { icon: Building2, label: 'Opdrachtgevers' },
  { icon: Briefcase, label: 'Vacatures & matching' },
  { icon: UserCheck, label: 'Plaatsingen & uren' },
  { icon: FileText, label: 'Facturatie' },
  { icon: Home, label: 'Huisvesting & transport' },
  { icon: MessageSquare, label: 'Communicatie' },
  { icon: Smartphone, label: 'Portalen' },
];

const STEPS: Step[] = [
  {
    navLabel: 'Welkom',
    title: 'Welkom! 🎉',
    subtitle: 'Alles wat je nodig hebt om je uitzendbureau te runnen — op één plek.',
    icon: Rocket,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    features: [],
  },
  {
    navLabel: 'Dashboard & taken',
    title: 'Dashboard & werkorganisatie',
    subtitle: 'Begin elke dag met overzicht: wat vraagt vandaag aandacht?',
    icon: LayoutDashboard,
    color: 'text-sky-500',
    bgColor: 'bg-sky-500/10',
    features: [
      { icon: LayoutDashboard, label: 'Dashboard', desc: 'Signaleringen en kerncijfers — verlopen documenten, achterstallige huur en afwijkende uren komen vanzelf bovendrijven' },
      { icon: ClipboardList, label: 'Workbench', desc: 'Dagstart voor intercedenten: prioriteiten en openstaande acties op één plek' },
      { icon: CheckSquare, label: 'Taken', desc: 'Taken met deadline en bijlagen, gekoppeld aan een kandidaat, bedrijf, pand of voertuig' },
      { icon: BarChart2, label: 'Dashboards', desc: 'KPI-dashboards en rapportages voor management' },
    ],
    link: { label: 'Naar de Workbench', to: '/workbench' },
  },
  {
    navLabel: 'Kandidaten',
    title: 'Kandidaten',
    subtitle: 'Het hele traject van kandidaat tot medewerker, in één dossier.',
    icon: Users,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    features: [
      { icon: Users, label: 'Kandidatendossier', desc: 'Profiel, documenten, skills, werkervaring, notities en communicatie in één overzicht' },
      { icon: Sparkles, label: 'AI-dossieranalyse', desc: 'Upload een CV en krijg functiegroep, doelfuncties, sterke punten en aandachtspunten terug' },
      { icon: FolderHeart, label: 'Talentpools', desc: 'Groepeer kandidaten handmatig of dynamisch op basis van filters die zichzelf verversen' },
      { icon: Link2, label: 'Self-service onboarding', desc: 'Stuur een onboarding-link; de kandidaat vult zelf gegevens en documenten aan — jij controleert alleen nog' },
    ],
    link: { label: 'Bekijk kandidaten', to: '/kandidaten' },
  },
  {
    navLabel: 'Opdrachtgevers',
    title: 'Opdrachtgevers & contacten',
    subtitle: 'Alles over je klanten: afspraken, contacten en communicatie.',
    icon: Building2,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    features: [
      { icon: Building2, label: 'Bedrijfsdossier', desc: 'Bedrijfsgegevens (met KVK-lookup), functies, SLA’s en tariefafspraken per klant' },
      { icon: UserRound, label: 'Contactpersonen', desc: 'Alle contactpersonen centraal, met hun rol en communicatievoorkeuren' },
      { icon: MessageSquare, label: 'Communicatie-inbox', desc: 'E-mail en WhatsApp per opdrachtgever op één tijdlijn, realtime bijgewerkt' },
      { icon: Globe, label: 'Klantportaal', desc: 'Opdrachtgevers zien hun eigen plaatsingen en accorderen uren zelf online' },
    ],
    link: { label: 'Bekijk opdrachtgevers', to: '/opdrachtgevers' },
  },
  {
    navLabel: 'Vacatures & matching',
    title: 'Vacatures & AI-matching',
    subtitle: 'Van vacature tot voorstel bij de klant — met uitlegbare matchscores.',
    icon: Briefcase,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    features: [
      { icon: Briefcase, label: 'Vacaturebeheer', desc: 'Vacatures met skills en urgentie; AI vult de benodigde skills aan uit de vacaturetekst' },
      { icon: Target, label: 'AI-matchscore', desc: 'Scoort de hele kandidatenpool op skills, afstand, certificaten en recente ervaring — met uitleg per onderdeel via "Waarom?"' },
      { icon: GitCompareArrows, label: 'Match Pipeline', desc: 'Volg elke match per fase: van nieuwe match en screening tot voorstel en plaatsing' },
      { icon: Send, label: 'Voorstel + reactiepagina', desc: 'Stuur een voorstelmail; de klant plant een gesprek, laat direct starten of wijst af via een beveiligde pagina' },
    ],
    link: { label: 'Bekijk vacatures', to: '/vacatures' },
  },
  {
    navLabel: 'Plaatsingen & uren',
    title: 'Plaatsingen, planning & uren',
    subtitle: 'Plaats met zekerheid en houd grip op gewerkte uren.',
    icon: UserCheck,
    color: 'text-teal-500',
    bgColor: 'bg-teal-500/10',
    features: [
      { icon: UserCheck, label: 'Plaatsen met compliance-check', desc: 'Documenten, contract, BSN en rijbewijs worden gecontroleerd vóór de plaatsing rondgaat' },
      { icon: Calendar, label: 'Planning', desc: 'Visueel overzicht van wie waar en wanneer werkt' },
      { icon: Clock, label: 'Urenregistratie', desc: 'Handmatig invoeren of CSV-import, met automatische AI-validatie op afwijkingen' },
      { icon: CheckSquare, label: 'Accordering', desc: 'Keur uren individueel of in bulk goed; de klant accordeert via het klantportaal' },
    ],
    link: { label: 'Bekijk plaatsingen', to: '/plaatsingen' },
  },
  {
    navLabel: 'Facturatie',
    title: 'Facturatie & financieel',
    subtitle: 'Van goedgekeurde uren naar factuur — gekoppeld aan je boekhouding.',
    icon: FileText,
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-500/10',
    features: [
      { icon: FileText, label: 'Facturatie', desc: 'Facturen met regels per plaatsing, inclusief toeslagen en reiskosten, als PDF' },
      { icon: Calculator, label: 'Exact Online', desc: 'Synchroniseer facturen en relaties automatisch met je boekhouding' },
      { icon: Fuel, label: 'Tankpas & kilometers', desc: 'Analyseer tankpas-transacties en kilometerregistraties per voertuig en medewerker' },
      { icon: TrendingUp, label: 'Omzet', desc: 'Omzetinzicht voor de directie, rechtstreeks uit Exact' },
    ],
    link: { label: 'Naar facturatie', to: '/facturatie' },
  },
  {
    navLabel: 'Huisvesting & transport',
    title: 'Huisvesting & transport',
    subtitle: 'Regel wonen en vervoer voor je medewerkers, zonder losse lijstjes.',
    icon: Home,
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/10',
    features: [
      { icon: Home, label: 'Panden & kamers', desc: 'Bezetting per kamer, in- en uitchecken via een wizard — dubbel boeken kan niet' },
      { icon: KeyRound, label: 'Inspecties & sleutels', desc: 'Inspecties met foto’s en sleutelregistratie per pand' },
      { icon: Car, label: 'Wagenpark', desc: 'Voertuigen toewijzen (met rijbewijscheck), schade en boetes bijhouden' },
      { icon: Gauge, label: 'APK-signalering', desc: 'Automatische alerts wanneer een APK bijna verloopt' },
    ],
    link: { label: 'Bekijk huisvesting', to: '/huisvesting' },
  },
  {
    navLabel: 'Communicatie',
    title: 'Communicatie',
    subtitle: 'Bereik kandidaten en klanten vanuit het platform — alles komt in het dossier.',
    icon: MessageSquare,
    color: 'text-pink-500',
    bgColor: 'bg-pink-500/10',
    features: [
      { icon: MessageSquare, label: 'WhatsApp Business', desc: 'Chat rechtstreeks vanuit het platform; gesprekken worden aan het dossier gekoppeld' },
      { icon: Mail, label: 'E-mail via Outlook', desc: 'Verstuur en ontvang via je eigen Microsoft 365-mailbox, met templates' },
      { icon: Palette, label: 'Huisstijl-mails', desc: 'Alle automatische mails gaan in jouw logo en kleuren de deur uit' },
      { icon: Megaphone, label: 'Bulkcampagnes', desc: 'WhatsApp- of e-mailcampagnes naar gefilterde groepen, met automatische opt-out' },
    ],
    link: { label: 'Naar communicatie', to: '/communicatie' },
  },
  {
    navLabel: 'Portalen',
    title: 'Portalen & self-service',
    subtitle: 'Laat medewerkers en klanten zelf regelen wat ze zelf kunnen.',
    icon: Smartphone,
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-500/10',
    features: [
      { icon: Smartphone, label: 'Medewerkersportaal', desc: 'Medewerkers zien uren, loonstroken en documenten, en melden zich ziek via hun telefoon' },
      { icon: Globe, label: 'Klantportaal', desc: 'Klanten volgen hun plaatsingen en keuren uren goed zonder mailverkeer' },
      { icon: Link2, label: 'Publieke links', desc: 'Onboarding, contract tekenen en matchreacties werken zonder inlog, via beveiligde eenmalige links' },
      { icon: BookOpen, label: 'Kennisbank', desc: 'Interne handleidingen en artikelen voor je eigen team' },
    ],
  },
  {
    navLabel: 'Instellingen',
    title: 'Maak het je eigen',
    subtitle: 'Richt het platform in zoals jouw bureau werkt.',
    icon: Settings,
    color: 'text-slate-500',
    bgColor: 'bg-slate-500/10',
    features: [
      { icon: Palette, label: 'Huisstijl', desc: 'Stel je logo en kleuren in; het hele platform en alle mails volgen automatisch' },
      { icon: Users, label: 'Gebruikers & rechten', desc: 'Nodig collega’s uit met rollen en fijnmazige rechten per onderdeel' },
      { icon: Puzzle, label: 'Modules', desc: 'Zet modules aan of uit; het menu past zich vanzelf aan' },
      { icon: Upload, label: 'Data-import', desc: 'Importeer kandidaten en bedrijven uit Excel/CSV of rechtstreeks uit Carerix' },
    ],
    link: { label: 'Naar instellingen', to: '/instellingen' },
  },
  {
    navLabel: 'Aan de slag',
    title: 'Je bent er klaar voor!',
    subtitle: 'Op het dashboard staat een checklist die je stap voor stap door de inrichting leidt.',
    icon: Flag,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    features: [
      { icon: CheckSquare, label: 'Aan de slag-checklist', desc: 'De checklist op je dashboard vinkt vanzelf af wat je al hebt ingericht' },
      { icon: Building2, label: 'Eerste opdrachtgever', desc: 'Voeg je eerste klant toe — met KVK-lookup ben je in een minuut klaar' },
      { icon: Users, label: 'Eerste kandidaat', desc: 'Maak een kandidaat aan of importeer je bestand uit Excel/CSV' },
    ],
  },
];

const OnboardingWizard = ({ open, onComplete, userName }: OnboardingWizardProps) => {
  const [step, setStep] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const navigate = useNavigate();

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  const goTo = (i: number) => {
    setStep(i);
    setMaxVisited(m => Math.max(m, i));
  };

  const handleDeepLink = (to: string) => {
    onComplete();
    navigate(to);
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden sm:max-w-4xl [&>button]:hidden"
        onInteractOutside={e => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Rondleiding door het platform</DialogTitle>

        <div className="flex max-h-[85vh] md:h-[560px]">
          {/* Stappen-navigatie (desktop) — klikbaar, zodat je zelf door de modules kunt bladeren */}
          <nav className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-muted/40 p-3 overflow-y-auto">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Rondleiding
            </p>
            {STEPS.map((s, i) => {
              const visited = i <= maxVisited;
              const active = i === step;
              return (
                <button
                  key={s.navLabel}
                  onClick={() => goTo(i)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    active
                      ? 'bg-background font-medium shadow-sm'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  )}
                >
                  <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', active && s.bgColor)}>
                    {visited && !active
                      ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                      : <s.icon className={cn('h-3.5 w-3.5', active && s.color)} />}
                  </span>
                  <span className="truncate">{s.navLabel}</span>
                </button>
              );
            })}
          </nav>

          {/* Inhoud */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Voortgangsbalk */}
            <div className="h-1 shrink-0 bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>

            <div className="flex-1 overflow-y-auto p-6 sm:p-8">
              {/* Icoon + titel */}
              <div className="mb-5 flex items-center gap-3">
                <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', current.bgColor)}>
                  <current.icon className={cn('h-6 w-6', current.color)} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold leading-tight">
                    {isFirst ? `Welkom${userName ? `, ${userName}` : ''}! 🎉` : current.title}
                  </h2>
                  <p className="text-sm text-muted-foreground">{current.subtitle}</p>
                </div>
              </div>

              {/* Welkomststap: plattegrond van alle modules */}
              {isFirst && (
                <>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Dit platform vervangt je losse systemen en lijstjes. Dit zijn de bouwstenen — we lopen ze
                    stap voor stap met je door. Liever zelf rondkijken? Klik links een module aan of sla de
                    rondleiding over.
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {MODULE_MAP.map(m => (
                      <div key={m.label} className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-center">
                        <m.icon className="h-5 w-5 text-muted-foreground" />
                        <span className="text-xs font-medium leading-tight">{m.label}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Feature-kaarten */}
              {current.features.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {current.features.map((feat, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background shadow-sm">
                        <feat.icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium leading-tight">{feat.label}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{feat.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Deep-link: zelf gaan kijken */}
              {current.link && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => handleDeepLink(current.link!.to)}
                >
                  {current.link.label}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {/* Navigatie */}
            <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-4">
              {/* Voortgangsstippen (mobiel, waar de zijbalk verborgen is) */}
              <div className="flex items-center gap-1.5 md:hidden">
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-200',
                      i === step ? 'w-6 bg-primary' : i < step ? 'w-1.5 bg-primary/40' : 'w-1.5 bg-muted-foreground/20'
                    )}
                  />
                ))}
              </div>
              <span className="hidden text-xs text-muted-foreground md:inline">
                Stap {step + 1} van {STEPS.length}
              </span>

              <div className="flex items-center gap-2">
                {!isLast && (
                  <Button variant="ghost" size="sm" onClick={onComplete} className="text-muted-foreground">
                    Overslaan
                  </Button>
                )}
                {!isFirst && (
                  <Button variant="ghost" size="sm" onClick={() => goTo(step - 1)}>
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Vorige
                  </Button>
                )}
                <Button size="sm" onClick={() => (isLast ? onComplete() : goTo(step + 1))}>
                  {isLast ? 'Aan de slag!' : isFirst ? 'Rondleiding starten' : 'Volgende'}
                  {!isLast && <ChevronRight className="ml-1 h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingWizard;
