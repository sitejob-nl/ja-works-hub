import { useState, useEffect, useCallback } from 'react';
import { Search, Menu } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import NotificationBell from './NotificationBell';

interface TopBarProps {
  onMenuClick?: () => void;
}

// Accent-insensitief zoeken: strip diacrieten + lowercase ("José" -> "jose"). Spiegelt de
// DB-kolom candidates.search_unaccent zodat client- en serverzoek consistent zijn.
const foldAccents = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const TopBar = ({ onMenuClick }: TopBarProps) => {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const orgId = profile?.organization_id;
  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ candidates: any[]; employees: any[]; companies: any[]; vacancies: any[]; placements: any[] }>({
    candidates: [], employees: [], companies: [], vacancies: [], placements: [],
  });

  // Cmd+K shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Debounced search
  useEffect(() => {
    const searchTerm = query.trim();
    if (!searchTerm || searchTerm.length < 2) {
      setResults({ candidates: [], employees: [], companies: [], vacancies: [], placements: [] });
      return;
    }
    const timer = setTimeout(async () => {
      const q = `%${searchTerm}%`;
      // Kandidaten/medewerkers via de accent-ongevoelige search_unaccent-kolom ("Jose" vindt
      // "José"); employee_number erbij omdat dat niet in search_unaccent zit.
      const folded = `%${foldAccents(searchTerm)}%`;
      const [candRes, empRes, compRes, vacRes, placRes] = await Promise.all([
        supabase
          .from('candidates')
          .select('id, first_name, last_name, email, phone')
          .ilike('search_unaccent', folded)
          .order('last_name', { ascending: true, nullsFirst: false })
          .order('first_name', { ascending: true, nullsFirst: false })
          .limit(20),
        supabase
          .from('candidates')
          .select('id, first_name, last_name, employee_number')
          .not('employee_status', 'is', null)
          .or(`search_unaccent.ilike.${folded},employee_number.ilike.${q}`)
          .order('last_name', { ascending: true, nullsFirst: false })
          .order('first_name', { ascending: true, nullsFirst: false })
          .limit(20),
        supabase
          .from('companies')
          .select('id, name, email')
          .or(`name.ilike.${q},email.ilike.${q}`)
          .order('name', { ascending: true })
          .limit(10),
        supabase
          .from('vacancies')
          .select('id, title, status, companies!vacancies_company_id_fkey(name)')
          .ilike('title', q)
          .order('created_at', { ascending: false })
          .limit(8),
        // v_active_placements: expliciet op org filteren (view-RLS niet vertrouwen) + zoek
        // op medewerker- of opdrachtgevernaam.
        orgId
          ? supabase
              .from('v_active_placements')
              .select('placement_id, employee_name, company_name, function_name')
              .eq('organization_id', orgId)
              .or(`employee_name.ilike.${q},company_name.ilike.${q}`)
              .limit(8)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      setResults({
        candidates: candRes.data ?? [],
        employees: empRes.data ?? [],
        companies: compRes.data ?? [],
        vacancies: vacRes.data ?? [],
        placements: placRes.data ?? [],
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, orgId]);

  const hasResults = results.candidates.length > 0 || results.employees.length > 0
    || results.companies.length > 0 || results.vacancies.length > 0 || results.placements.length > 0;

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-3 sm:px-6 shrink-0">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden shrink-0"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Search trigger */}
        <button
          onClick={() => setOpen(true)}
          className="relative max-w-md w-full hidden sm:flex items-center h-9 pl-9 pr-4 rounded-md bg-secondary text-sm text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <span>Zoeken...</span>
          <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {/* Mobile search icon */}
        <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setOpen(true)}>
          <Search className="h-5 w-5" />
        </Button>

        <NotificationBell />

        <div className="flex items-center gap-2 cursor-pointer" onClick={signOut}>
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-stat-blue">
            {firstName.charAt(0).toUpperCase()}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium leading-tight">{profile?.full_name}</p>
            <p className="text-[11px] text-muted-foreground capitalize">{profile?.role}</p>
          </div>
        </div>
      </div>

      {/* Command palette */}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Zoek kandidaten, vacatures, opdrachtgevers..." value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>Geen resultaten gevonden.</CommandEmpty>
          {results.candidates.length > 0 && (
            <CommandGroup heading="Kandidaten">
              {results.candidates.map((c) => (
                <CommandItem key={c.id} onSelect={() => { navigate(`/kandidaten/${c.id}`); setOpen(false); setQuery(''); }}>
                  <span>{c.first_name} {c.last_name}</span>
                  {c.email && <span className="ml-auto text-xs text-muted-foreground">{c.email}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.employees.length > 0 && (
            <CommandGroup heading="In dienst">
              {results.employees.map((e: any) => (
                <CommandItem key={e.id} onSelect={() => { navigate(`/kandidaten/${e.id}`); setOpen(false); setQuery(''); }}>
                  <span>{e.first_name} {e.last_name}</span>
                  {e.employee_number && <span className="ml-auto text-xs text-muted-foreground">#{e.employee_number}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.companies.length > 0 && (
            <CommandGroup heading="Opdrachtgevers">
              {results.companies.map((c) => (
                <CommandItem key={c.id} onSelect={() => { navigate(`/opdrachtgevers/${c.id}`); setOpen(false); setQuery(''); }}>
                  <span>{c.name}</span>
                  {c.email && <span className="ml-auto text-xs text-muted-foreground">{c.email}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.vacancies.length > 0 && (
            <CommandGroup heading="Vacatures">
              {results.vacancies.map((v: any) => (
                <CommandItem key={v.id} onSelect={() => { navigate(`/vacatures/${v.id}`); setOpen(false); setQuery(''); }}>
                  <span>{v.title}</span>
                  {(v.companies as any)?.name && <span className="ml-auto text-xs text-muted-foreground">{(v.companies as any).name}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.placements.length > 0 && (
            <CommandGroup heading="Plaatsingen">
              {results.placements.map((p: any) => (
                <CommandItem key={p.placement_id} onSelect={() => { navigate(`/plaatsingen/${p.placement_id}`); setOpen(false); setQuery(''); }}>
                  <span>{p.employee_name ?? '—'}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{[p.function_name, p.company_name].filter(Boolean).join(' · ')}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </header>
  );
};

export default TopBar;
