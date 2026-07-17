import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Palette, Users, Mail, MessageSquare, Building2, UserPlus, Briefcase,
  UserCheck, Check, ChevronRight, X, RotateCcw, PartyPopper,
} from 'lucide-react';

interface GettingStartedCardProps {
  /** Opent de rondleiding (OnboardingWizard) opnieuw. */
  onStartTour: () => void;
}

interface ChecklistItem {
  key: string;
  icon: React.ElementType;
  label: string;
  desc: string;
  to: string;
  done: boolean;
}

/** Head-count die bij een RLS- of netwerk-fout op 0 terugvalt (item blijft dan gewoon open staan). */
const safeCount = async (table: string): Promise<number> => {
  try {
    const { count, error } = await supabase
      .from(table as never)
      .select('id', { count: 'exact', head: true });
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
};

const GettingStartedCard = ({ onStartTour }: GettingStartedCardProps) => {
  const { profile, user } = useAuth();
  const storageKey = user ? `sitejob_getting_started_hidden_${user.id}` : null;
  const [hidden, setHidden] = useState(() => !!storageKey && !!localStorage.getItem(storageKey));

  const isAdmin = profile?.role === 'admin';

  const { data: checks } = useQuery({
    queryKey: ['getting-started-checks', profile?.organization_id],
    queryFn: async () => {
      const [org, profiles, mailAccounts, whatsapp, companies, candidates, vacancies, placements] = await Promise.all([
        supabase
          .from('organizations')
          .select('logo_url, settings')
          .eq('id', profile!.organization_id)
          .maybeSingle()
          .then(r => r.data),
        safeCount('profiles'),
        safeCount('mail_accounts'),
        safeCount('whatsapp_config'),
        safeCount('companies'),
        safeCount('candidates'),
        safeCount('vacancies'),
        safeCount('placements'),
      ]);

      const settings = (org?.settings ?? {}) as Record<string, unknown>;
      return {
        branding: !!org?.logo_url || !!settings.accent_color,
        team: profiles > 1,
        mail: mailAccounts > 0,
        whatsapp: whatsapp > 0,
        companies: companies > 0,
        candidates: candidates > 0,
        vacancies: vacancies > 0,
        placements: placements > 0,
      };
    },
    enabled: isAdmin && !!profile?.organization_id && !hidden,
    staleTime: 60_000,
  });

  if (!isAdmin || hidden || !checks) return null;

  const items: ChecklistItem[] = [
    { key: 'branding', icon: Palette, label: 'Huisstijl instellen', desc: 'Upload je logo en kies je kleuren — het hele platform en alle mails volgen', to: '/instellingen?tab=algemeen', done: checks.branding },
    { key: 'team', icon: Users, label: 'Teamleden uitnodigen', desc: 'Nodig collega’s uit met de juiste rol en rechten', to: '/instellingen?tab=gebruikers', done: checks.team },
    { key: 'mail', icon: Mail, label: 'E-mail koppelen', desc: 'Verbind je Microsoft 365-mailbox om vanuit het platform te mailen', to: '/instellingen?tab=koppelingen', done: checks.mail },
    { key: 'whatsapp', icon: MessageSquare, label: 'WhatsApp koppelen', desc: 'Verbind WhatsApp Business voor chat en campagnes', to: '/instellingen?tab=koppelingen', done: checks.whatsapp },
    { key: 'companies', icon: Building2, label: 'Eerste opdrachtgever toevoegen', desc: 'Voeg je eerste klant toe — met KVK-lookup zo gedaan', to: '/opdrachtgevers', done: checks.companies },
    { key: 'candidates', icon: UserPlus, label: 'Eerste kandidaat toevoegen', desc: 'Maak een kandidaat aan of importeer je bestand via Excel/CSV', to: '/kandidaten', done: checks.candidates },
    { key: 'vacancies', icon: Briefcase, label: 'Eerste vacature aanmaken', desc: 'Zet een vacature open en laat AI-matching kandidaten voorstellen', to: '/vacatures', done: checks.vacancies },
    { key: 'placements', icon: UserCheck, label: 'Eerste plaatsing rondmaken', desc: 'Plaats een kandidaat bij een klant — de kern-flow is dan compleet', to: '/plaatsingen', done: checks.placements },
  ];

  const doneCount = items.filter(i => i.done).length;
  const allDone = doneCount === items.length;
  const progress = Math.round((doneCount / items.length) * 100);

  const dismiss = () => {
    if (storageKey) localStorage.setItem(storageKey, '1');
    setHidden(true);
  };

  if (allDone) {
    return (
      <div className="bg-card rounded-lg p-5 shadow-sm border border-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
          <PartyPopper className="h-4 w-4 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Alles ingericht!</p>
          <p className="text-xs text-muted-foreground">Je platform is klaar voor gebruik. Veel succes!</p>
        </div>
        <Button variant="ghost" size="sm" onClick={dismiss}>Verbergen</Button>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Aan de slag</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Richt je platform stap voor stap in — {doneCount} van {items.length} gedaan
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onStartTour} className="text-xs gap-1 text-muted-foreground">
              <RotateCcw className="h-3 w-3" />
              Rondleiding
            </Button>
            <Button variant="ghost" size="icon" onClick={dismiss} className="h-7 w-7 text-muted-foreground" aria-label="Checklist verbergen">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 px-3 pb-3">
        {items.map(item => (
          <Link
            key={item.key}
            to={item.to}
            className={cn(
              'flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/50',
              item.done && 'opacity-60'
            )}
          >
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                item.done
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : 'border-border bg-background text-muted-foreground'
              )}
            >
              {item.done ? <Check className="h-3.5 w-3.5" /> : <item.icon className="h-3.5 w-3.5" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn('text-sm font-medium leading-tight', item.done && 'line-through decoration-muted-foreground/50')}>
                {item.label}
              </p>
              <p className="text-xs text-muted-foreground truncate">{item.desc}</p>
            </div>
            {!item.done && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </Link>
        ))}
      </div>
    </div>
  );
};

export default GettingStartedCard;
