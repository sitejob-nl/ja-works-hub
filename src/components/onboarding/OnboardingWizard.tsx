import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Users, Briefcase, Building2, Home, Clock, Truck,
  MessageSquare, BookOpen, Search, FileSpreadsheet,
  LayoutDashboard, ClipboardList, Rocket, ChevronRight, ChevronLeft, Check,
} from 'lucide-react';

interface OnboardingWizardProps {
  open: boolean;
  onComplete: () => void;
  userName: string;
}

const STEPS = [
  {
    title: 'Welkom bij SiteJob! 🎉',
    subtitle: 'Alles wat je nodig hebt om je uitzendbureau te runnen — op één plek.',
    description: 'We laten je in een paar stappen zien wat je allemaal kunt doen. Klaar?',
    icon: Rocket,
    color: 'text-stat-blue',
    bgColor: 'bg-primary/10',
    features: [],
  },
  {
    title: 'Kandidaten & Medewerkers',
    subtitle: 'Beheer het hele traject van kandidaat tot medewerker.',
    icon: Users,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    features: [
      { icon: Search, label: 'Kandidaten zoeken', desc: 'Vind nieuwe kandidaten via LinkedIn en andere bronnen' },
      { icon: Users, label: 'Kandidatenbeheer', desc: 'Profiel, documenten, skills en beschikbaarheid bijhouden' },
      { icon: ClipboardList, label: 'Onboarding', desc: 'Digitale onboarding met automatische checklists en documentverificatie' },
    ],
  },
  {
    title: 'Vacatures & Matching',
    subtitle: 'Van vacature tot plaatsing in een paar klikken.',
    icon: Briefcase,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    features: [
      { icon: Briefcase, label: 'Vacaturebeheer', desc: 'Maak vacatures aan en koppel ze aan opdrachtgevers' },
      { icon: ClipboardList, label: 'AI Matching', desc: 'Automatische matching van kandidaten op basis van skills en beschikbaarheid' },
      { icon: FileSpreadsheet, label: 'Vacaturebank', desc: 'Importeer vacatures automatisch vanuit externe bronnen' },
    ],
  },
  {
    title: 'Opdrachtgevers & Planning',
    subtitle: 'Houd grip op je klanten en planning.',
    icon: Building2,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    features: [
      { icon: Building2, label: 'Opdrachtgevers', desc: 'Bedrijfsgegevens, contactpersonen, SLA\'s en tariefafspraken' },
      { icon: LayoutDashboard, label: 'Planning', desc: 'Visueel overzicht van wie waar en wanneer werkt' },
      { icon: Clock, label: 'Urenregistratie', desc: 'Uren invoeren, importeren en valideren met automatische controles' },
    ],
  },
  {
    title: 'Huisvesting & Transport',
    subtitle: 'Regel huisvesting en vervoer voor je medewerkers.',
    icon: Home,
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/10',
    features: [
      { icon: Home, label: 'Huisvesting', desc: 'Panden, kamers, bezetting, inspecties en sleutelregistratie' },
      { icon: Truck, label: 'Wagenpark', desc: 'Voertuigen, toewijzingen, kilometers en boetes bijhouden' },
    ],
  },
  {
    title: 'Communicatie & Integraties',
    subtitle: 'Bereik je kandidaten en koppel met je boekhouding.',
    icon: MessageSquare,
    color: 'text-pink-500',
    bgColor: 'bg-pink-500/10',
    features: [
      { icon: MessageSquare, label: 'WhatsApp & E-mail', desc: 'Communiceer direct vanuit het platform, inclusief bulk-campagnes' },
      { icon: BookOpen, label: 'Kennisbank', desc: 'Interne artikelen en handleidingen voor je team' },
      { icon: FileSpreadsheet, label: 'Exact Online', desc: 'Synchroniseer medewerkers, uren en facturen met je boekhouding' },
    ],
  },
  {
    title: 'Je bent er klaar voor!',
    subtitle: 'Begin met het toevoegen van je eerste opdrachtgever of kandidaat.',
    icon: Check,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    features: [
      { icon: FileSpreadsheet, label: 'Data importeren', desc: 'Importeer bestaande data uit Excel of CSV-bestanden' },
      { icon: Building2, label: 'Opdrachtgever toevoegen', desc: 'Voeg je eerste klant toe via Opdrachtgevers' },
      { icon: Users, label: 'Kandidaten toevoegen', desc: 'Begin met het registreren van beschikbare kandidaten' },
    ],
  },
];

const OnboardingWizard = ({ open, onComplete, userName }: OnboardingWizardProps) => {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden [&>button]:hidden" onInteractOutside={e => e.preventDefault()}>
        <DialogTitle className="sr-only">Welkom bij SiteJob</DialogTitle>
        {/* Progress bar */}
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-6 sm:p-8">
          {/* Icon + title */}
          <div className="flex items-center gap-3 mb-4">
            <div className={`h-12 w-12 rounded-xl ${current.bgColor} flex items-center justify-center`}>
              <current.icon className={`h-6 w-6 ${current.color}`} />
            </div>
            <div>
              <h2 className="text-lg font-semibold leading-tight">
                {isFirst ? `Welkom, ${userName}! 🎉` : current.title}
              </h2>
              <p className="text-sm text-muted-foreground">{current.subtitle}</p>
            </div>
          </div>

          {/* Description for first step */}
          {isFirst && current.description && (
            <p className="text-sm text-muted-foreground mb-6 pl-[60px]">{current.description}</p>
          )}

          {/* Feature list */}
          {current.features.length > 0 && (
            <div className="space-y-3 mb-6">
              {current.features.map((feat, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="h-8 w-8 rounded-lg bg-background flex items-center justify-center shrink-0 shadow-sm">
                    <feat.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium leading-tight">{feat.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{feat.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-1.5">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    i === step ? 'w-6 bg-primary' : i < step ? 'w-1.5 bg-primary/40' : 'w-1.5 bg-muted-foreground/20'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              {!isFirst && (
                <Button variant="ghost" size="sm" onClick={() => setStep(s => s - 1)}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Vorige
                </Button>
              )}
              {isFirst && (
                <Button variant="ghost" size="sm" onClick={onComplete} className="text-muted-foreground">
                  Overslaan
                </Button>
              )}
              <Button size="sm" onClick={() => isLast ? onComplete() : setStep(s => s + 1)}>
                {isLast ? 'Aan de slag!' : isFirst ? 'Rondleiding starten' : 'Volgende'}
                {!isLast && <ChevronRight className="h-4 w-4 ml-1" />}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingWizard;
