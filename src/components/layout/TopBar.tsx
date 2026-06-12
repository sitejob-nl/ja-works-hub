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

const TopBar = ({ onMenuClick }: TopBarProps) => {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ candidates: any[]; employees: any[]; companies: any[] }>({
    candidates: [], employees: [], companies: [],
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
      setResults({ candidates: [], employees: [], companies: [] });
      return;
    }
    const timer = setTimeout(async () => {
      const q = `%${searchTerm}%`;
      const [candRes, empRes, compRes] = await Promise.all([
        supabase
          .from('candidates')
          .select('id, first_name, last_name, email, phone')
          .or(`first_name.ilike.${q},last_name.ilike.${q},email.ilike.${q},phone.ilike.${q}`)
          .order('last_name', { ascending: true, nullsFirst: false })
          .order('first_name', { ascending: true, nullsFirst: false })
          .limit(20),
        supabase
          .from('candidates')
          .select('id, first_name, last_name, employee_number')
          .not('employee_status', 'is', null)
          .or(`first_name.ilike.${q},last_name.ilike.${q},employee_number.ilike.${q}`)
          .order('last_name', { ascending: true, nullsFirst: false })
          .order('first_name', { ascending: true, nullsFirst: false })
          .limit(20),
        supabase
          .from('companies')
          .select('id, name, email')
          .or(`name.ilike.${q},email.ilike.${q}`)
          .order('name', { ascending: true })
          .limit(10),
      ]);

      setResults({
        candidates: candRes.data ?? [],
        employees: empRes.data ?? [],
        companies: compRes.data ?? [],
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const hasResults = results.candidates.length > 0 || results.employees.length > 0 || results.companies.length > 0;

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
        <CommandInput placeholder="Zoek kandidaten, opdrachtgevers..." value={query} onValueChange={setQuery} />
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
        </CommandList>
      </CommandDialog>
    </header>
  );
};

export default TopBar;
